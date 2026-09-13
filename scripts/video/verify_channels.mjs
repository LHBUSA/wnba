// Verify the official-video channel allowlist (data/video-channels.json) against live evidence.
//
//   node scripts/video/verify_channels.mjs          re-prove every channel, write the evidence back
//   node scripts/video/verify_channels.mjs --check  re-prove without writing (exit 1 on any failure)
//
// A channel is identified by its exact YouTube channel ID. Handles are recorded as evidence, never as identity.
// Required proof for `enabled: true` (all must hold, re-proven on every run):
//   1. official_site_link — the organization's own website links to a YouTube URL that resolves to this channel ID;
//   2. canonical          — the channel page's canonical URL is /channel/<channel_id>;
//   3. feed_title         — the channel's public upload feed carries the expected channel title.
// The verified badge is recorded when the server-rendered page exposes it; it is supporting evidence only.
// A channel that fails any required check is written enabled=false with the failure; it is never deleted.
import fs from 'node:fs';

const FILE = new URL('../../data/video-channels.json', import.meta.url);
const CHECK_ONLY = process.argv.includes('--check');
const UA = 'Mozilla/5.0 (PropBetEdge WNBA channel verification; +https://wnba.propbetedge.ai)';

async function get(url, tries = 2) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en-US' }, redirect: 'follow', signal: ctl.signal });
    return { status: r.status, url: r.url, text: await r.text() };
  } catch (e) {
    if (tries > 1) return get(url, tries - 1);
    return { status: 0, url, text: '', error: e.message };
  } finally {
    clearTimeout(t);
  }
}

const externalId = (html) => html.match(/"externalId":"(UC[\w-]{22})"/)?.[1] || null;

async function verify(ch) {
  const checks = {};
  const site = await get(ch.official_site);
  // Channel links only (user/, channel/, c/, @handle or a legacy custom path) — never watch/embed/shorts/playlist URLs.
  const links = [...new Set((site.text.match(/https?:\/\/(?:www\.)?youtube\.com\/(?:user\/|channel\/|c\/|@)?[\w.-]+/g) || []).filter((l) => !/youtube\.com\/(watch|embed|shorts|playlist|results|feed|live|redirect|iframe_api|player_api|s)\b/.test(l)))];
  let siteLink = null;
  for (const l of links.slice(0, 6)) {
    const page = await get(l);
    if (externalId(page.text) === ch.channel_id) { siteLink = l; break; }
  }
  checks.official_site_link = { pass: Boolean(siteLink), site: ch.official_site, site_status: site.status, link: siteLink, links_seen: links.slice(0, 6) };
  const page = await get(`https://www.youtube.com/channel/${ch.channel_id}`);
  const canonical = page.text.match(/<link rel="canonical" href="([^"]+)"/)?.[1] || null;
  checks.canonical = { pass: canonical === `https://www.youtube.com/channel/${ch.channel_id}` && externalId(page.text) === ch.channel_id, canonical, vanity: page.text.match(/"vanityChannelUrl":"([^"]+)"/)?.[1] || null };
  const feed = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.channel_id}`);
  const feedTitle = feed.text.match(/<title>([^<]*)<\/title>/)?.[1] || null;
  checks.feed_title = { pass: feed.status === 200 && feedTitle === ch.expected_feed_title, status: feed.status, title: feedTitle, entries: (feed.text.match(/<entry>/g) || []).length };
  checks.verified_badge_in_html = { observed: /"tooltip":"Verified"|BADGE_STYLE_TYPE_VERIFIED/.test(page.text), note: 'Supporting evidence only; YouTube does not always server-render the badge.' };
  const pass = checks.official_site_link.pass && checks.canonical.pass && checks.feed_title.pass;
  return { pass, verification: { method: 'official_site_link+canonical+feed_title', checks, checked_at: new Date().toISOString() } };
}

const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
let failures = 0;
for (const ch of doc.channels) {
  const { pass, verification } = await verify(ch);
  console.log(`${pass ? 'PASS' : 'FAIL'} ${ch.name} ${ch.channel_id} site_link=${verification.checks.official_site_link.link} canonical=${verification.checks.canonical.pass} feed="${verification.checks.feed_title.title}" badge=${verification.checks.verified_badge_in_html.observed}`);
  if (!pass) failures++;
  ch.verified = pass;
  if (!pass) ch.enabled = false;
  ch.verification = verification;
}
if (!CHECK_ONLY) fs.writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`);
process.exit(CHECK_ONLY && failures ? 1 : 0);
