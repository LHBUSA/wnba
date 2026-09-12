#!/usr/bin/env node
// Re-prove data/video-channels.json against the live web.
//
// For every enabled row, two independent facts must still hold:
//   1. the first-party site (wnba.com, or the team's own site on the wnba.com
//      domain) still links the recorded channel URL, and that URL still
//      canonicalises to the recorded channel_id;
//   2. the channel's public Atom feed still answers 200 with the recorded title.
//
// A display name, a handle or a verified badge is never sufficient on its own:
// handles get re-pointed and badges are not in the server-rendered HTML.
//
// Usage: node scripts/videos/verify-channels.mjs [--json]
// Exit 1 on any drift, so this can gate a deploy.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..');
const FILE = path.join(ROOT, 'data', 'video-channels.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const asJson = process.argv.includes('--json');

async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' }, redirect: 'follow' });
  return { status: r.status, body: await r.text() };
}

const CHANNEL_URL = /https?:\/\/(?:www\.)?youtube\.com\/(?:user|c|channel|@)?[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)?/g;

/** externalId is the only channel identity we accept from a channel page. */
function externalId(html) {
  return (html.match(/"externalId":"(UC[\w-]{22})"/) || [])[1] || null;
}

function feedTitle(xml) {
  const head = String(xml).split(/<entry[\s>]/i)[0];
  const m = head.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : null;
}

const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const rows = [];
let failed = 0;

for (const c of doc.channels) {
  const row = { channel_id: c.channel_id, name: c.name, class: c.channel_class, checks: {}, notes: [] };
  const v = c.verification || {};
  try {
    // 1a. the first-party site still links the recorded channel URL
    const site = await get(v.first_party_url);
    const links = [...new Set((site.body.match(CHANNEL_URL) || []))];
    const want = String(v.linked_as || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    row.checks.first_party_link = site.status === 200 && links.some((l) => l.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') === want);
    if (!row.checks.first_party_link) row.notes.push(`site ${site.status}; youtube links found: ${links.slice(0, 4).join(' , ') || 'none'}`);

    // 1b. that URL still canonicalises to the recorded channel_id
    const page = await get(v.linked_as);
    const got = externalId(page.body);
    row.checks.resolves_to_channel_id = got === c.channel_id;
    if (!row.checks.resolves_to_channel_id) row.notes.push(`linked url resolves to ${got || 'nothing'}`);

    // 2. the channel's own feed still answers with the recorded title
    const feed = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(c.channel_id)}`);
    const title = feedTitle(feed.body);
    row.checks.feed_ok = feed.status === 200;
    row.checks.feed_title = title === c.feed_title;
    row.uploads_in_feed = (feed.body.match(/<entry[\s>]/gi) || []).length;
    if (!row.checks.feed_title) row.notes.push(`feed title '${title}' != '${c.feed_title}'`);
  } catch (e) {
    row.notes.push(`error: ${e.message}`);
  }
  row.pass = Object.values(row.checks).length === 4 && Object.values(row.checks).every(Boolean);
  if (c.enabled && !row.pass) failed += 1;
  rows.push(row);
  if (!asJson) console.log(`${row.pass ? 'PASS' : 'FAIL'} ${c.channel_id} ${c.name}${row.notes.length ? ` — ${row.notes.join('; ')}` : ''}`);
}

if (asJson) console.log(JSON.stringify({ at: new Date().toISOString(), failed, rows }, null, 2));
else console.log(`\nverify-channels: ${failed ? `${failed} FAIL` : `ALL PASS (${rows.length} channels)`} · pending (not ingested): ${doc.pending.length}`);
process.exit(failed ? 1 : 0);
