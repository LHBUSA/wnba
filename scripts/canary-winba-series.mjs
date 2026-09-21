#!/usr/bin/env node
// Series-wide canary for the four published WinBA Index editions.
// Read-only. Verifies the historical publication contract, series order and
// navigation, the current-edition promotion, frozen-value hashes, discovery
// surfaces and the corrected September ranks.

import fs from 'node:fs';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const SITE = opt('site', 'https://wnba.propbetedge.ai').replace(/\/$/, '');
const WEB = opt('web', 'https://wnba-web.sales-fd3.workers.dev').replace(/\/$/, '');
const NEWS = opt('news', 'https://wnba-news.sales-fd3.workers.dev').replace(/\/$/, '');
const HASHES = opt('hashes', '');

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

console.log('WinBA series canary');
console.log('='.repeat(72));

const list = await get(`${NEWS}/v1/articles?limit=400`);
const cards = (list.body?.data?.items || []).filter((c) => c.kind === 'winba_index')
  .sort((a, b) => String(a.period).localeCompare(String(b.period)));

ok('exactly four public editions', cards.length === 4, cards.map((c) => c.period).join(', '));
ok('periods are June through September', JSON.stringify(cards.map((c) => c.period)) === JSON.stringify(['2026-06', '2026-07', '2026-08', '2026-09']));
ok('May is not a public edition', !cards.some((c) => c.period === '2026-05'));

// ---- per-edition contract and canonicals
const expected = HASHES ? Object.fromEntries(HASHES.split(',').map((x) => x.split(':'))) : {};
const articles = {};
for (const c of cards) {
  const res = await get(`${NEWS}/v1/articles/${encodeURIComponent(c.slug)}`);
  const a = res.body?.data?.article;
  articles[c.period] = a;
  const P = c.period;
  if (!ok(`${P} article resolves`, Boolean(a))) continue;

  const page = await get(`${WEB}/news/${c.slug}`, 'text');
  ok(`${P} canonical returns 200`, page.status === 200);
  ok(`${P} canonical URL is its own slug`, page.body.includes(`<link rel="canonical" href="${SITE}/news/${c.slug}"`));

  const backfill = P !== '2026-09';
  ok(`${P} historical_backfill is ${backfill}`, Boolean(a.historical_backfill) === backfill);
  ok(`${P} snapshot_as_of is the period cutoff`, String(a.snapshot_as_of || '').startsWith(P === '2026-06' ? '2026-07-01' : P === '2026-07' ? '2026-08-01' : P === '2026-08' ? '2026-09-01' : '2026-09'));
  // A same-period edition is legitimately published inside its own month; only
  // a BACKFILL must never be dated into the period it covers.
  const pub = Date.parse(a.published_at);
  ok(`${P} published_at is a real instant`, Number.isFinite(pub), a.published_at);
  ok(`${P} published_at is not before its period began`, pub >= Date.parse(`${P}-01T00:00:00.000Z`));
  if (backfill) ok(`${P} is not dated into the period it covers`, !a.published_at.startsWith(P), a.published_at);
  if (backfill) {
    ok(`${P} published_at is after the period cutoff`, pub > Date.parse(a.snapshot_as_of));
    ok(`${P} says it was reconstructed`, /reconstructed from PropBetEdge/.test((a.body || []).join(' ')));
    ok(`${P} page shows the reconstruction notice`, /reconstructed from PropBetEdge/.test(page.body));
  }
  // Qualification language.
  const text = (a.body || []).join(' ');
  ok(`${P} states qualification as OR`, /at least 10 appearances or 250 minutes/.test(text));
  ok(`${P} does not state it as AND`, !/10 games and 250 minutes/.test(text));

  // Frozen board integrity.
  const rows = a.winba_board?.rows || [];
  ok(`${P} board is complete and ordered`, rows.length >= 21 && rows.every((r, i) => r.rank === i + 1) && rows.every((r, i) => i === 0 || rows[i - 1].score >= r.score), `${rows.length} rows`);
  ok(`${P} every row has a named player id`, rows.every((r) => /^\d+$/.test(String(r.player_id)) && r.player_name));
  ok(`${P} all four components present`, rows.every((r) => ['production_percentile', 'win_rate', 'winning_output_share', 'court_share'].every((k) => Number.isFinite(Number(r.components?.[k])))));
  if (expected[P]) ok(`${P} frozen values match the readiness hash`, boardHash(rows) === expected[P], `${boardHash(rows)} vs ${expected[P]}`);

  // Rendering.
  ok(`${P} renders the visual board`, page.body.includes('wb-board') && page.body.includes('wb-podium'));
  ok(`${P} renders team depth`, page.body.includes('wb-depth-card'));
  const players = [...new Set([...page.body.matchAll(/href="\/players\/(\d+)"/g)].map((m) => m[1]))];
  ok(`${P} links its ranked players`, players.length >= 10 && players.every((id) => rows.some((r) => String(r.player_id) === id)), `${players.length} distinct`);
  // Social + schema.
  const meta = (n) => (page.body.match(new RegExp(`(?:property|name)="${n}" content="([^"]*)"`)) || [])[1];
  ok(`${P} og:image is its own card`, (meta('og:image') || '').includes(c.slug));
  ok(`${P} twitter card is summary_large_image`, meta('twitter:card') === 'summary_large_image');
  ok(`${P} article:published_time is the real date`, meta('article:published_time') === a.published_at);
  const ld = page.body.match(/<script type="application\/ld\+json" data-ld="page">([\s\S]*?)<\/script>/);
  if (ld) {
    const art = (JSON.parse(ld[1])['@graph'] || []).find((n) => n['@type'] === 'NewsArticle');
    ok(`${P} schema datePublished is the real date`, art?.datePublished === a.published_at, art?.datePublished);
    if (backfill) ok(`${P} schema does not claim a period date`, !String(art?.datePublished || '').startsWith(P));
    ok(`${P} schema has the WinBA DefinedTerm`, (art?.about || []).some((x) => x['@type'] === 'DefinedTerm'));
    ok(`${P} schema section is the series`, art?.articleSection === 'The WinBA Index');
  }
  // The share card must render, not fall back.
  const ogUrl = (meta('og:image') || '').replace(SITE, WEB);
  const card = await fetch(`${ogUrl}${ogUrl.includes('?') ? '&' : '?'}canary=1`);
  const buf = Buffer.from(await card.arrayBuffer());
  const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  ok(`${P} share card renders as PNG`, card.status === 200 && isPng, `${buf.length} bytes`);
  if (isPng) ok(`${P} share card is 1200x630`, buf.readUInt32BE(16) === 1200 && buf.readUInt32BE(20) === 630);
}

// ---- September's corrected ranks
const sep = articles['2026-09'];
if (sep) {
  const at21 = (sep.winba_board?.rows || []).find((r) => r.rank === 21);
  const at22 = (sep.winba_board?.rows || []).find((r) => r.rank === 22);
  ok('September No. 21 is Madina Okot', at21?.player_name === 'Madina Okot', at21?.player_name);
  ok('September No. 22 is Cheyenne Parker-Tyus', at22?.player_name === 'Cheyenne Parker-Tyus', at22?.player_name);
  ok('September published_at is unchanged', sep.published_at === '2026-09-21T20:48:01.908Z', sep.published_at);
  const corr = (sep.revisions || []).filter((r) => r.kind === 'integrity_correction');
  ok('September ledger records the tie-break correction', corr.some((r) => /tie-break corrected/.test(r.note)));
  ok('September ledger records the qualification correction', corr.some((r) => /qualification rule corrected/.test(r.note)));
  ok('September keeps its earlier revision history', (sep.revisions || []).some((r) => r.kind === 'integrity_restoration'));
}

// ---- series order, navigation and current edition
const archive = await get(`${WEB}/news/winba-index`, 'text');
ok('series archive returns 200', archive.status === 200);
for (const c of cards) ok(`archive lists ${c.period}`, archive.body.includes(`/news/${c.slug}`));
ok('archive does not expose May', !/May 2026/.test(archive.body));
const order = cards.map((c) => c.slug).map((s) => archive.body.indexOf(`/news/${s}`));
ok('archive orders newest period first', order[3] < order[2] && order[2] < order[1] && order[1] < order[0], JSON.stringify(order));

const junePage = await get(`${WEB}/news/${cards[0].slug}`, 'text');
ok('June has no previous edition', !junePage.body.includes('winba-series-prev'));
ok('June links forward to July', junePage.body.includes(`/news/${cards[1].slug}`));
const sepPage = await get(`${WEB}/news/${cards[3].slug}`, 'text');
ok('September links back to August', sepPage.body.includes(`/news/${cards[2].slug}`));
ok('September has no next edition', !sepPage.body.includes('winba-series-next'));

const { currentWinbaEdition } = await import('../src/views/winba-index.js');
const current = currentWinbaEdition({ data: { items: cards } });
ok('September is still the current edition', current?.period === '2026-09', current?.period);
const board = await get(`${WEB}/winba-score`, 'text');
ok('live leaderboard promotes September', board.body.includes(`/news/${cards[3].slug}`));
ok('live leaderboard does not promote a backfill', !cards.slice(0, 3).some((c) => board.body.includes(`/news/${c.slug}`)));
const front = await get(`${WEB}/news`, 'text');
ok('newsroom promotes September as current', front.body.includes(`/news/${cards[3].slug}`));

// ---- discovery
const sitemap = await get(`${WEB}/news-sitemap.xml`, 'text');
for (const c of cards) ok(`${c.period} is in the news sitemap`, sitemap.body.includes(c.slug));
const rss = await get(`${WEB}/rss.xml`, 'text');
ok('editions appear in RSS', cards.filter((c) => rss.body.includes(c.slug)).length >= 1, `${cards.filter((c) => rss.body.includes(c.slug)).length}/4`);
ok('May is not in the news sitemap', !sitemap.body.includes('for-may-2026'));

console.log('\n' + '='.repeat(72));
console.log(fails.length ? `SERIES CANARY FAIL — ${pass} passed, ${fails.length} failed:\n  ${fails.join('\n  ')}` : `SERIES CANARY PASS — ${pass} checks`);
process.exit(fails.length ? 1 : 0);
