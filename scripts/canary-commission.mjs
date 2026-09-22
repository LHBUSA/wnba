#!/usr/bin/env node
// Live canary for the commissioned features and the editorial chart architecture.
// Read-only. Verifies that every plotted value on the page came from the frozen
// board it names, that the figures are server-rendered and verifiable, and that
// the entity graph, social card and listings are real.

import crypto from 'node:crypto';
import { valuesHash, visualIntact } from '../src/lib/visuals.js';
import { COMMISSION_MIN_WORDS } from '../workers/wnba-news/src/commission.js';

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const SITE = opt('site', 'https://wnba.propbetedge.ai').replace(/\/$/, '');
const WEB = opt('web', 'https://wnba-web.sales-fd3.workers.dev').replace(/\/$/, '');
const NEWS = opt('news', 'https://wnba-news.sales-fd3.workers.dev').replace(/\/$/, '');

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); } else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
  return Boolean(cond);
};
const get = async (url, as = 'json') => {
  const r = await fetch(url, { redirect: 'follow' });
  return { status: r.status, body: as === 'json' ? await r.json().catch(() => null) : await r.text() };
};
const boardHash = (rows) => crypto.createHash('sha256')
  .update(JSON.stringify((rows || []).map((r) => [r.rank, r.player_id, r.score, r.team_id, r.components])))
  .digest('hex').slice(0, 16);
const f1 = (v) => (Math.round(Number(v) * 10) / 10).toFixed(1);

console.log('Commissioned features canary');
console.log('='.repeat(72));

// ---- the frozen boards every feature cites, by period
const index = (await get(`${NEWS}/v1/articles?limit=400`)).body?.data?.items || [];
const editions = new Map();
for (const c of index.filter((x) => x.kind === 'winba_index')) {
  const a = (await get(`${NEWS}/v1/articles/${encodeURIComponent(c.slug)}`)).body?.data?.article;
  if (a?.winba_board) editions.set(a.period, { board: a.winba_board, hash: boardHash(a.winba_board.rows), slug: a.slug });
}
ok('all four Index editions are public and hashable', editions.size === 4, [...editions.keys()].sort().join(', '));

const features = index.filter((c) => c.kind === 'commissioned_feature');
ok('both commissioned features are listed', features.length === 2, features.map((f) => f.slug).join(', '));

for (const card of features) {
  const P = card.slug.split('-')[0];
  const a = (await get(`${NEWS}/v1/articles/${encodeURIComponent(card.slug)}`)).body?.data?.article;
  if (!ok(`${P}: article resolves`, Boolean(a))) continue;
  const page = await get(`${WEB}/news/${card.slug}`, 'text');
  const h = page.body;

  ok(`${P}: canonical returns 200`, page.status === 200);
  ok(`${P}: canonical URL is its own slug`, h.includes(`<link rel="canonical" href="${SITE}/news/${card.slug}"`));
  ok(`${P}: the record says a human ordered it`, a.commission?.autopilot === false && Boolean(a.commission?.note));
  ok(`${P}: page shows the commissioned chip and the reason`, /commission-chip/.test(h) && /Why we commissioned this/.test(h));
  ok(`${P}: listed as a feature, not as autopilot desk output`, card.series === 'PropBetEdge Features' && card.kind === 'commissioned_feature');
  ok(`${P}: quality state is current`, card.quality_state === 'current_quality', card.quality_state);
  ok(`${P}: word count is feature length`, a.words >= COMMISSION_MIN_WORDS, `${a.words} words (min ${COMMISSION_MIN_WORDS})`);

  // ---- the visual contract
  ok(`${P}: carries visuals`, (a.visuals || []).length >= 2, `${(a.visuals || []).length}`);
  for (const v of a.visuals || []) {
    ok(`${P}/${v.id}: payload is intact`, visualIntact(v), `${v.values_hash} vs ${valuesHash(v)}`);
    ok(`${P}/${v.id}: declares its renderer and observation time`, v.provenance?.renderer === 'pbe-visual/1.0.0' && Number.isFinite(Date.parse(v.provenance?.observed_at || '')));
    ok(`${P}/${v.id}: is server-rendered on the page`, h.includes(`data-visual="${v.id}"`));
    ok(`${P}/${v.id}: its payload hash is printed`, h.includes(v.values_hash));
    // Every plotted value is visible in the first response.
    const vals = [
      ...(v.series || []).map((x) => x.value),
      ...(v.rows || []).map((x) => x.value),
      ...(v.cards || []).map((x) => x.value)
    ].filter((x) => x !== null && x !== undefined);
    const missing = vals.filter((x) => !h.includes(f1(x)));
    ok(`${P}/${v.id}: every plotted value is in the HTML`, missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : `${vals.length} values`);
    // A trend point must name the frozen board it came from, and that hash must
    // be the hash of a published edition.
    for (const pt of v.series || []) {
      const ed = editions.get(pt.key);
      ok(`${P}/${v.id}: ${pt.key} matches the published frozen board`, Boolean(ed) && ed.hash === pt.source.source_hash, `${pt.source.source_hash} vs ${ed?.hash}`);
      const row = (ed?.board?.rows || []).find((r) => String(r.player_id) === String(v.entity.id));
      ok(`${P}/${v.id}: ${pt.key} value is that board's own row`, Boolean(row) && Number(row.score) === Number(pt.value) && Number(row.rank) === Number(pt.rank), `${pt.value}/${pt.rank} vs ${row?.score}/${row?.rank}`);
    }
    // Components must equal the current edition's frozen row exactly.
    if (v.type === 'component_bars') {
      const ed = editions.get(a.winba_reference.period);
      const row = (ed?.board?.rows || []).find((r) => String(r.player_id) === String(v.entity.id));
      const same = (v.rows || []).every((r) => Number(row?.components?.[r.key]) === Number(r.value));
      ok(`${P}/${v.id}: components equal the frozen row`, same && Number(row?.score) === Number(v.total));
    }
    if (v.type === 'line_series') {
      ok(`${P}/${v.id}: the axis is not truncated`, v.axis.max - v.axis.min >= 8
        && (Math.max(...v.series.map((x) => x.value)) - Math.min(...v.series.map((x) => x.value))) / (v.axis.max - v.axis.min) <= 0.5,
      `span ${v.axis.max - v.axis.min}`);
    }
  }
  ok(`${P}: no figure failed verification on the page`, !/could not be verified/.test(h));
  ok(`${P}: every figure is addressed by a section`, (a.visuals || []).every((v) => (a.sections || []).some((s) => s.visual === v.id)));

  // ---- the numbers the prose asserts about the metric
  const text = (a.body || []).join(' ');
  const ref = a.winba_reference;
  ok(`${P}: the rating in the prose is the frozen rating`, text.includes(f1(ref.score)) && text.includes(`No. ${ref.rank}`));
  ok(`${P}: the reference is marked frozen and hashed`, ref.frozen === true && ref.source_hash === editions.get(ref.period)?.hash);
  ok(`${P}: does not claim the archive is the official record`, /close to but not identical with the official regular-season record/.test(text));

  // ---- entity graph and internal links
  const links = [...new Set([...h.matchAll(/href="(\/(?:players|teams)\/\d+|\/winba-score|\/news\/winba-index)"/g)].map((m) => m[1]))];
  for (const href of ['/winba-score', '/news/winba-index', `/players/${a.lead_player_id}`, `/teams/${a.lead_team_id}`]) {
    ok(`${P}: links ${href}`, links.includes(href));
  }
  for (const href of links) {
    const r = await fetch(`${WEB}${href}`, { redirect: 'follow' });
    ok(`${P}: ${href} resolves`, r.status === 200, String(r.status));
  }

  // ---- schema
  const ld = h.match(/<script type="application\/ld\+json" data-ld="page">([\s\S]*?)<\/script>/);
  if (ok(`${P}: page schema present`, Boolean(ld))) {
    const g = JSON.parse(ld[1])['@graph'] || [];
    const art = g.find((n) => n['@type'] === 'NewsArticle');
    ok(`${P}: schema subject is the player`, (art.about || []).some((x) => x['@type'] === 'Person' && x.name === a.primary_subject));
    ok(`${P}: schema carries the team and the metric`, (art.about || []).some((x) => x['@type'] === 'SportsTeam') && (art.about || []).some((x) => x['@type'] === 'DefinedTerm'));
    ok(`${P}: other players are mentions, not co-subjects`, (art.mentions || []).length >= 1 && !(art.about || []).some((x) => x['@type'] === 'Person' && x.name !== a.primary_subject));
    ok(`${P}: schema section is the feature series`, art.articleSection === 'PropBetEdge Features');
    ok(`${P}: schema datePublished is the real instant`, art.datePublished === a.published_at);
    ok(`${P}: cited sources are in the graph`, (art.citation || []).length >= 1);
    ok(`${P}: breadcrumbs present`, g.some((n) => n['@type'] === 'BreadcrumbList'));
  }

  // ---- social card
  const meta = (n) => (h.match(new RegExp(`(?:property|name)="${n}" content="([^"]*)"`)) || [])[1];
  ok(`${P}: og:image is its own card`, (meta('og:image') || '').includes(card.slug));
  ok(`${P}: twitter card is summary_large_image`, meta('twitter:card') === 'summary_large_image');
  const ogUrl = (meta('og:image') || '').replace(SITE, WEB);
  const img = await fetch(`${ogUrl}${ogUrl.includes('?') ? '&' : '?'}canary=1`);
  const buf = Buffer.from(await img.arrayBuffer());
  const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  ok(`${P}: share card renders as PNG`, img.status === 200 && isPng, `${buf.length} bytes`);
  if (isPng) ok(`${P}: share card is 1200x630`, buf.readUInt32BE(16) === 1200 && buf.readUInt32BE(20) === 630);

  // ---- evidence: internal snapshots plus cited external pages
  const ev = a.evidence || [];
  ok(`${P}: cites all four frozen boards`, ev.filter((e) => e.kind === 'internal_snapshot').length === 4);
  ok(`${P}: every external fact names its page and capture time`, ev.filter((e) => e.kind === 'publisher_report').every((e) => /^https:\/\//.test(e.url || '') && Number.isFinite(Date.parse(e.captured_at))));
  ok(`${P}: nothing was observed after the article was generated`, ev.every((e) => Date.parse(e.captured_at) <= Date.parse(a.provenance.generated_at) + 60e3));
}

// ---- the features must not disturb the series
const winba = await get(`${WEB}/winba-score`, 'text');
ok('the live leaderboard still promotes the September edition', winba.body.includes(`/news/${editions.get('2026-09').slug}`));
const archive = await get(`${WEB}/news/winba-index`, 'text');
ok('the Index archive still lists four editions', [...editions.values()].every((e) => archive.body.includes(`/news/${e.slug}`)));
const front = await get(`${WEB}/news`, 'text');
ok('the newsroom front page lists both features', features.every((f) => front.body.includes(`/news/${f.slug}`)));
const sitemap = await get(`${WEB}/news-sitemap.xml`, 'text');
ok('both features are in the news sitemap', features.every((f) => sitemap.body.includes(f.slug)));

console.log('\n' + '='.repeat(72));
console.log(fails.length ? `COMMISSION CANARY FAIL — ${pass} passed, ${fails.length} failed:\n  ${fails.join('\n  ')}` : `COMMISSION CANARY PASS — ${pass} checks`);
process.exit(fails.length ? 1 : 0);
