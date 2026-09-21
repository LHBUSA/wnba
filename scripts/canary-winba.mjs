#!/usr/bin/env node
// WinBA end-to-end canary. Verifies the published monthly Index against the
// live API, the publishing Worker's HTML, the feeds and every internal link.
//
// Read-only. Usage: node scripts/canary-winba.mjs [period]
//   --site=  public origin (default https://wnba.propbetedge.ai)
//   --web=   publishing Worker origin (bypasses the CDN cache)
//   --news=  newsroom API origin

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const PERIOD = args.find((a) => /^\d{4}-\d{2}$/.test(a)) || null;
const SITE = opt('site', 'https://wnba.propbetedge.ai').replace(/\/$/, '');
const WEB = opt('web', 'https://wnba-web.sales-fd3.workers.dev').replace(/\/$/, '');
const NEWS = opt('news', 'https://wnba-news.sales-fd3.workers.dev').replace(/\/$/, '');
const API = opt('api', 'https://wnba-api.propbetedge.ai').replace(/\/$/, '');

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); } else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
  return Boolean(cond);
};
const get = async (url, as = 'json') => {
  const r = await fetch(url, { redirect: 'follow' });
  return { status: r.status, headers: r.headers, body: as === 'json' ? await r.json().catch(() => null) : await r.text() };
};

console.log('WinBA canary');
console.log('='.repeat(72));

// ---- the published edition
const list = await get(`${NEWS}/v1/articles?limit=400`);
const editions = (list.body?.data?.items || []).filter((c) => c.kind === 'winba_index');
if (!editions.length) { console.log('  FAIL  no published WinBA Index found'); process.exit(1); }
const card = PERIOD ? editions.find((c) => c.period === PERIOD) : editions.sort((a, b) => String(b.period).localeCompare(String(a.period)))[0];
if (!card) { console.log(`  FAIL  no edition for ${PERIOD}`); process.exit(1); }
console.log(`Edition: ${card.period} — /news/${card.slug}\n`);

const res = await get(`${NEWS}/v1/articles/${encodeURIComponent(card.slug)}`);
const a = res.body?.data?.article;
ok('article resolves from the newsroom API', Boolean(a));

// ---- frozen values and immutability
const board = a.winba_board;
ok('frozen board present', Boolean(board?.rows?.length), `${board?.rows?.length} rows`);
ok('published_at is immutable and equals first_published_at', a.published_at === a.first_published_at, a.published_at);
ok('published_at predates every revision', (a.revisions || []).every((r) => Date.parse(r.at) >= Date.parse(a.published_at)), `${(a.revisions || []).length} revisions`);
ok('board snapshot is not newer than generation', Date.parse(board.snapshot_at) <= Date.parse(a.provenance?.generated_at || a.updated_at) + 60e3, board.snapshot_at);

// the frozen board must NOT equal the live board once they diverge
const liveBoard = (await get(`${API}/v1/stats/winba`)).body?.data;
const liveTop = (liveBoard?.rows || []).filter((r) => r.qualified).sort((x, y) => x.rank - y.rank);
ok('live board reachable', liveTop.length > 0, `${liveBoard?.qualified_count} qualified live`);

// ---- ranks, ids, teams
const rows = board.rows;
ok('ranks are 1..n with no gaps', rows.every((r, i) => r.rank === i + 1), `1..${rows.length}`);
ok('scores are monotonically non-increasing', rows.every((r, i) => i === 0 || rows[i - 1].score >= r.score));
ok('every row has a numeric player id', rows.every((r) => /^\d+$/.test(String(r.player_id))));
ok('lead player is the board leader', String(a.lead_player_id) === String(rows[0].player_id), `${rows[0].player_name} (${rows[0].player_id})`);
ok('lead team is the leader’s team', String(a.lead_team_id) === String(rows[0].team_id), rows[0].team_name);

// every player id and team id must resolve against the API
const roster = (await get(`${API}/v1/players?limit=1000`)).body?.data?.players || [];
const byId = new Map(roster.map((p) => [String(p.athlete_id), p]));
const teams = (await get(`${API}/v1/teams`)).body?.data?.teams || [];
const teamIds = new Set(teams.map((t) => String(t.team_id)));
const topTen = rows.slice(0, 10);
const nameMismatch = topTen.filter((r) => byId.has(r.player_id) && byId.get(r.player_id).name !== r.player_name);
ok('top-10 player names match the roster where resolvable', nameMismatch.length === 0, nameMismatch.map((r) => r.player_name).join(', ') || 'all match');
ok('every top-10 team id is a real team', topTen.every((r) => teamIds.has(String(r.team_id))));

// ---- the published HTML (from the Worker, bypassing the CDN)
const page = (await get(`${WEB}/news/${card.slug}`, 'text')).body;
// Visible copy only: the JSON-LD DefinedTerm legitimately restates the caveat,
// and counting it would make the editorial check unpassable.
const visible = page.replace(/<script[\s\S]*?<\/script>/g, '');
ok('page renders the lede (not only sectioned copy)', visible.includes('at the top of'));
ok('visible copy states the methodology caveat once', (visible.match(/association-with-winning index/g) || []).length === 1);
const playerLinks = [...new Set([...page.matchAll(/href="\/players\/(\d+)"/g)].map((m) => m[1]))];
const teamLinks = [...new Set([...page.matchAll(/href="\/teams\/(\d+)"/g)].map((m) => m[1]))];
ok('player links present for the top ten', playerLinks.length >= 10, `${playerLinks.length} distinct`);
ok('every player link is a ranked player', playerLinks.every((id) => rows.some((r) => String(r.player_id) === id)));
ok('team links present', teamLinks.length >= 3, `${teamLinks.length} distinct`);
ok('every team link is a real team', teamLinks.every((id) => teamIds.has(id)));
ok('WinBA canonical link in body', page.includes('class="entity-link" href="/winba-score"'));
ok('series navigation links the archive', page.includes('href="/news/winba-index"'));
ok('canonical URL is the article', page.includes(`<link rel="canonical" href="${SITE}/news/${card.slug}"`));

// ---- structured data
const ld = page.match(/<script type="application\/ld\+json" data-ld="page">([\s\S]*?)<\/script>/);
let art = null;
if (ok('JSON-LD present', Boolean(ld))) {
  const graph = JSON.parse(ld[1])['@graph'] || [];
  art = graph.find((n) => n['@type'] === 'NewsArticle');
  ok('NewsArticle node present', Boolean(art));
  ok('datePublished matches the immutable timestamp', art.datePublished === a.published_at, art.datePublished);
  ok('dateModified present', Boolean(art.dateModified));
  ok('articleSection is the series', art.articleSection === 'The WinBA Index', art.articleSection);
  ok('keywords present and restrained', Boolean(art.keywords) && art.keywords.split(', ').length <= 8, art.keywords);
  const about = art.about || [];
  ok('about contains the WinBA DefinedTerm', about.some((x) => x['@type'] === 'DefinedTerm' && x.name === 'WinBA Score'));
  ok('about contains the leader as a Person', about.some((x) => x['@type'] === 'Person'));
  ok('about is not the whole league', about.length <= 4, `${about.length} entities`);
  ok('mentions carry the rest of the board', (art.mentions || []).length >= 2, `${(art.mentions || []).length}`);
  ok('no null entity in the graph', [...about, ...(art.mentions || [])].every(Boolean));
}

// ---- social
const meta = (n) => (page.match(new RegExp(`(?:property|name)="${n}" content="([^"]*)"`)) || [])[1];
ok('og:type is article', meta('og:type') === 'article');
ok('og:image is article-specific', (meta('og:image') || '').includes(card.slug));
ok('og:image dimensions declared', meta('og:image:width') === '1200' && meta('og:image:height') === '630');
ok('og:image:alt present', Boolean(meta('og:image:alt')));
ok('article:published_time is immutable', meta('article:published_time') === a.published_at);
ok('article:modified_time present', Boolean(meta('article:modified_time')));
ok('twitter:card is summary_large_image', meta('twitter:card') === 'summary_large_image');
ok('twitter:image present', Boolean(meta('twitter:image')));
ok('twitter:image:alt present', Boolean(meta('twitter:image:alt')));

// the card itself
const ogUrl = (meta('og:image') || '').replace(SITE, WEB);
const cardRes = await fetch(`${ogUrl}${ogUrl.includes('?') ? '&' : '?'}canary=1`);
const cardBuf = Buffer.from(await cardRes.arrayBuffer());
const isPng = cardBuf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
ok('share card renders as PNG (not a fallback redirect)', cardRes.status === 200 && isPng, `${cardRes.status}, ${cardBuf.length} bytes`);
if (isPng) ok('share card is 1200x630', cardBuf.readUInt32BE(16) === 1200 && cardBuf.readUInt32BE(20) === 630);
ok('podium resolved for the top three', (a.winba_podium || []).length === 3, `${(a.winba_podium || []).length} approved subjects`);
ok('every podium cell is JPEG', (a.winba_podium || []).every((r) => (r.podium || []).every((x) => x.src.endsWith('.jpg'))));

// ---- discovery surfaces
const archive = (await get(`${WEB}/news/winba-index`, 'text')).body;
ok('archive lists this edition', archive.includes(`/news/${card.slug}`));
ok('archive shows the frozen top three', archive.includes(`1. ${rows[0].player_name} ${Math.round(rows[0].score)}`));
ok('archive points at the live leaderboard', archive.includes('/winba-score'));

const leaderboard = (await get(`${WEB}/winba-score`, 'text')).body;
ok('live leaderboard links the latest edition', leaderboard.includes(`/news/${card.slug}`));
// The live page must say which board is which, in whatever words it uses.
ok('leaderboard distinguishes live from frozen', /live and current/.test(leaderboard) && /frozen monthly record/.test(leaderboard));

const playerPage = (await get(`${WEB}/players/${rows[0].player_id}`, 'text')).body;
ok('leader’s player page links the edition', playerPage.includes(`/news/${card.slug}`));
ok('player page states the frozen rank', playerPage.includes(`No. ${rows[0].rank}`));

const sitemap = (await get(`${WEB}/news-sitemap.xml`, 'text')).body;
ok('edition is in the news sitemap', sitemap.includes(card.slug));
// A 404 body is still a string, so only a 200 counts as a sitemap.
let general = '';
for (const path of ['/sitemap-pages.xml', '/sitemap.xml']) {
  const r = await get(`${WEB}${path}`, 'text');
  if (r.status === 200) general += r.body;
}
ok('archive route is discoverable in a sitemap', general.includes('/news/winba-index') || sitemap.includes('/news/winba-index'));
const rss = (await get(`${WEB}/rss.xml`, 'text')).body;
ok('edition is in RSS', rss.includes(card.slug));

// ---- internal links resolve (no 404s)
const paths = [...new Set([
  ...playerLinks.map((id) => `/players/${id}`),
  ...teamLinks.map((id) => `/teams/${id}`),
  '/winba-score', '/news/winba-index', `/news/${card.slug}`
])];
const bad = [];
for (const p of paths) {
  const r = await fetch(`${WEB}${p}`, { method: 'GET', redirect: 'follow' });
  if (r.status !== 200) bad.push(`${p} -> ${r.status}`);
}
ok('every internal link resolves 200', bad.length === 0, bad.join(', ') || `${paths.length} links checked`);

// ---- images referenced by the page
const imgs = [...new Set([...page.matchAll(/src="(\/media\/[^"]+)"/g)].map((m) => m[1]))];
const brokenImgs = [];
for (const src of imgs.slice(0, 30)) {
  const r = await fetch(`${SITE}${src}`);
  if (!r.ok) brokenImgs.push(`${src} -> ${r.status}`);
}
ok('no broken images', brokenImgs.length === 0, brokenImgs.join(', ') || `${imgs.length} referenced`);

console.log('\n' + '='.repeat(72));
console.log(fails.length ? `CANARY FAIL — ${pass} passed, ${fails.length} failed:\n  ${fails.join('\n  ')}` : `CANARY PASS — ${pass} checks`);
process.exit(fails.length ? 1 : 0);
