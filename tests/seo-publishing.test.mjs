// Search-native publishing: server-visible HTML, canonical/robots/OG, JSON-LD, sitemaps, RSS and lifecycle
// safety. Everything runs offline against fixtures through the same renderer the wnba-web Worker deploys.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { renderRoute, composeDocument } from '../workers/wnba-web/src/render.js';
import { newsSitemapXml, newsSitemapEntries, sitemapXml, rssXml, canonicalArticles } from '../src/seo/feeds.js';
import { routeMeta } from '../src/seo/meta.js';
import { mergeArticles } from '../workers/wnba-news/src/lifecycle.js';
import { cardOf } from '../workers/wnba-news/src/articles.js';
import { cardModel } from '../workers/wnba-web/src/og-model.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const SHELL = read('../index.html');
const NOW = Date.now();
const ago = (m) => new Date(NOW - m * 60e3).toISOString();
const SITE = 'https://wnba.propbetedge.ai';

// ------------------------------------------------------------ fixtures

const satouArticle = {
  id: 'dfe9a7abed53', slug: 'satou-sabally-out-for-the-season-per-espns-injury-feed-dfe9a7', kind: 'injury', category: 'Injuries',
  headline: 'Satou Sabally out for the season, per ESPN’s injury feed — the Liberty have already played 23 games without her',
  deck: 'Her last game in the ESPN game log was June 23; the New York Liberty are 13-10 since.',
  body: ['The listing: ESPN’s WNBA injury feed carries Satou Sabally as Out, marked out for the rest of the season.', 'What the records do not show is why she had not played since June 23.'],
  sections: [{ title: 'The listing', first: 0, count: 1 }, { title: 'What the records do not show', first: 1, count: 1 }],
  lead_team_id: '9', lead_player_id: '4281929', status: 'published',
  published_at: ago(5), first_published_at: ago(4 * 24 * 60), revised_at: ago(5),
  entities: [{ type: 'player', id: '4281929', name: 'Satou Sabally' }, { type: 'team', id: '9', name: 'New York Liberty' }, { type: 'team', id: '8', name: 'Minnesota Lynx' }, { type: 'game', id: '401857196', name: 'NY @ MIN', start_utc: '2026-09-18T23:30Z' }],
  evidence: [{ kind: 'record', source: 'ESPN WNBA injury feed', url: 'https://www.espn.com/wnba/injuries', captured_at: ago(5) }, { kind: 'publisher_report', publisher: 'CBS Sports', headline: 'Liberty lose Sabally for season', url: 'https://www.cbssports.com/wnba/news/x', published_at: ago(10 * 24 * 60) }],
  bettor_angle: { summary: 'The listing formalizes an absence the Liberty have played through.', supporting: [], against: ['a'], unknown: ['b'], markets: ['spread'] },
  market_watch: { text: ['A market line.'], market: null, game_id: '401857196' },
  generator: { version: 'wnba-articles/1.2.0' },
  media: { layout: 'single', subjects: [{ player_id: '4281929', name: 'Satou Sabally', team_id: '9', wide: [{ src: '/media/news/players/4281929/wide-640.webp', w: 640, h: 360 }, { src: '/media/news/players/4281929/wide-1280.webp', w: 1280, h: 720 }], half: [], og: '/media/news/players/4281929/og.jpg', square: '/media/players/4281929/square.webp', credit: { author: 'Danazar', license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0', source_page: 'https://commons.wikimedia.org/wiki/File:x.jpg' } }], teams: ['9'], caption: 'Pictured: Satou Sabally', og: '/media/news/players/4281929/og.jpg' }
};
const carlaCard = { id: 'e22194684c40', slug: 'carla-leite-in-focus-e22194', kind: 'brief', category: 'News Briefs', headline: 'Carla Leite in focus for the Portland Fire: the report and her season in numbers', deck: 'Swish Appeal published “Carla Leite is the special talent firing up the relaunched Portland Fire”.', status: 'published', published_at: ago(120), first_published_at: ago(60), revised_at: null, lead_player_id: '5208982', lead_team_id: '132052', entities: [{ type: 'player', id: '5208982', name: 'Carla Leite' }], has_market: false, market: null, sources: ['Swish Appeal'] };
const satouCard = { ...satouArticle, body: undefined, evidence: undefined, has_market: true, market: { spread: -6.5, total: 178.5, books: 9, captured_at: ago(90), home_abbr: 'MIN', away_abbr: 'NY' }, sources: ['ESPN WNBA injury feed'] };
const collapsedDuplicate = { ...satouCard, id: 'ee5db21862b4', slug: 'satou-sabally-out-for-the-season-ee5db2', first_published_at: ago(30), revised_at: null, duplicate_of: 'dfe9a7abed53', superseded_by: 'dfe9a7abed53' };
const oldTrend = { id: 'd1db2714b963', slug: 'valkyries-ats-d1db27', kind: 'trend', headline: 'The Valkyries are 7-3 against the spread in their last 10', deck: 'Deck', status: 'published', published_at: ago(20 * 24 * 60), first_published_at: ago(3 * 24 * 60), revised_at: ago(10), entities: [] };

const player = {
  player: { athlete_id: '4281929', name: 'Satou Sabally', first_name: 'Satou', last_name: 'Sabally', position_name: 'Forward', dob: '1998-04-25T07:00Z', college: 'Oregon', team: { team_id: '9', name: 'New York Liberty', abbr: 'NY', color: '#86cebc' } },
  photo: { portrait: '/media/players/4281929/portrait.webp', square: '/media/players/4281929/square.webp', width: 600, height: 750, attribution: 'Photo: Danazar / CC BY-SA 4.0 via Wikimedia Commons (cropped)', license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0', source_page: 'https://commons.wikimedia.org/wiki/File:x.jpg', identity: 'high', verified_at: '2026-09-11T17:55:15Z' },
  gamelog: { seasons: [{ name: '2026 Regular Season', games: [{ game_id: '401', date: '2026-06-23T23:00Z', opponent: { team_id: '8', abbr: 'MIN' }, at_vs: '@', result: 'L', score: '70-80', min: 30, pts: 12, reb: 4, ast: 2 }, { game_id: '400', date: '2026-06-20T23:00Z', opponent: { team_id: '3', abbr: 'DAL' }, at_vs: 'vs', result: 'W', score: '90-80', min: 28, pts: 9, reb: 2, ast: 1 }] }, { name: '2025 Regular Season', games: [{ min: 30, pts: 30, reb: 10, ast: 5 }] }] },
  recent: { method: 'Simple averages.', season: { games: 99, pts: 99, reb: 99, ast: 99, min: 99 }, last10: null, last5: null, minutes_trend: [] },
  career: { categories: [{ name: 'general', names: ['gamesPlayed', 'minutes', 'points', 'rebounds', 'assists', 'steals', 'blocks'], totals: [100, 3000, 1800, 700, 400, 120, 80], seasons: [{ season: 2026, season_label: '2026 Regular Season', team_id: '9', team: 'NY', stats: [40, 1200, 760, 280, 180, 50, 30] }, { season: 2025, season_label: '2025 Regular Season', team_id: '3', team: 'DAL', stats: [60, 1800, 1040, 420, 220, 70, 50] }] }] },
  winba: { score: 81.2, qualified: true, rank: 4, sample: { games: 40 } },
  availability: [{ status: 'Out', body_part: 'Concussion', source_updated_at: ago(60) }]
};
const team = {
  team: { team_id: '9', abbr: 'NY', name: 'New York Liberty', short_name: 'Liberty', color: '#86cebc' },
  season: { label: '2026 Regular Season' }, coach: ['Chris DeMarco'],
  standing: { wins: 24, losses: 16, seed: 3, games_behind: 2, conference_name: 'Eastern Conference', last_ten: '6-4', streak: 'W2', differential: 3.1 },
  roster: [{ athlete_id: '4281929', name: 'Satou Sabally', position: 'F' }], schedule: [], rotation: { rows: [], sample: 0, method: 'm' }, season_stats: {}, availability: []
};
const game = { game_id: '401857190', start_utc: '2026-09-17T23:30Z', season: { label: '2026 Regular Season' }, status: { state: 'pre', name: 'STATUS_SCHEDULED' }, home: { team_id: '20', abbr: 'ATL', name: 'Atlanta Dream', short_name: 'Dream' }, away: { team_id: '18', abbr: 'CON', name: 'Connecticut Sun', short_name: 'Sun' }, venue: { name: 'Gateway Center', city: 'College Park', state: 'GA' } };
const side = (t) => ({ team: t, standing: null, form: { last10: [], record_last10: '5-5', avg_margin_last10: 1, sample: 10 }, schedule_context: { rest_days: 2, back_to_back: false, games_last_7_days: 1, method: 'm' }, pace: null, season_stats: {}, availability: [], rotation: { rows: [], sample: 5, method: 'm' } });
const matchup = { game, teams: [side(game.away), side(game.home)], market_summary: null, market_history: [] };

const ok = (data, extra = {}) => ({ ok: true, status: 200, data, meta: { fetched_at: ago(1) }, ...extra });
const miss = (status = 404) => ({ ok: false, status, data: null, error: { code: status === 404 ? 'not_found' : 'unavailable' } });
const liveCards = [carlaCard, satouCard, oldTrend];
const api = {
  article: async (slug) => (slug === satouArticle.slug ? ok({ article: satouArticle, related: [] }) : slug === collapsedDuplicate.slug ? ok({ article: satouArticle, related: [] }) : { ok: false, status: 404, error: 'not_found' }),
  articles: async (p = {}) => ok({ items: p.kind ? liveCards.filter((c) => c.kind === p.kind) : liveCards, total: liveCards.length }, { meta: { last_run_at: ago(3) } }),
  news: async () => ok({ items: [] }),
  player: async (id) => (id === '4281929' ? ok(player) : miss(404)),
  props: async () => ok({ games: [] }),
  team: async (id) => (id === '9' ? ok(team) : miss(502)),
  teams: async () => ok({ teams: [team.team] }),
  matchup: async (id) => (id === '401857190' ? ok(matchup) : miss(502)),
  game: async (id) => (id === '401857190' ? ok({ game }) : miss(502)),
  schedule: async () => ok({ games: [game] }),
  injuries: async () => ok({ items: [], changes: [], authority: 'ESPN.', change_ledger: 'none' }),
  standings: async () => ok({ groups: [], is_current: true, label: '2026' }),
  players: async () => ok({ players: [player.player], teams: 1, photo_coverage: { approved: 1 } }),
  statsWinba: async () => ok({ version: 'winba/1.0.0', season: 2026, generated_at: ago(1), games_used: 40, qualified_count: 1, provisional_count: 0, formula: { interpretation: 'Transparent winning-impact index.' }, rows: [] }),
  statsPlayers: async () => ok({ rows: [], season: { year: 2026 }, is_current: true }),
  statsTeams: async () => ok({ rows: [], pace_method: 'm' }),
  today: async () => ok({ slate: { kind: 'NEXT', date: '20260917', games: [game], summary: { live: 0 } }, today_et: '20260913' })
};

const page = async (path) => {
  const p = await renderRoute(path, api);
  return { ...p, doc: p.meta ? composeDocument(SHELL, p) : null };
};
const ldOf = (doc) => JSON.parse(doc.match(/<script type="application\/ld\+json" data-ld="page">([\s\S]*?)<\/script>/)[1]);
const all = (doc, re) => [...doc.matchAll(re)].map((m) => m[1]);
const textOf = (doc) => doc.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ');

// ------------------------------------------------------------ article pages

test('article HTML carries the story without JavaScript: headline, deck, copy, dates, evidence, links', async () => {
  const { status, doc } = await page(`/news/${satouArticle.slug}`);
  assert.equal(status, 200);
  const text = textOf(doc);
  assert.match(doc, /<h1>Satou Sabally out for the season/);
  assert.ok(text.includes('Her last game in the ESPN game log was June 23'));
  assert.ok(text.includes('What the records do not show is why she had not played since June 23.'));
  assert.ok(doc.includes(`Published <time datetime="${satouArticle.first_published_at}">`));
  assert.ok(doc.includes(`Updated <time datetime="${satouArticle.revised_at}">`));
  assert.ok(doc.includes('href="https://www.cbssports.com/wnba/news/x"'), 'publisher evidence link');
  for (const href of ['/players/4281929', '/teams/9', '/teams/8', '/matchups/401857196', '/cast/401857196', '/injuries', '/editorial-policy', '/corrections']) assert.ok(doc.includes(`href="${href}"`), href);
  assert.match(doc, /<p><a class="entity-link" href="\/players\/4281929">Satou Sabally<\/a> as Out/);
  assert.match(doc, /<a class="entity-link" href="\/teams\/9">New York Liberty<\/a>/);
  assert.ok(doc.includes('src="/media/news/players/4281929/wide-1280.webp"') || doc.includes('/media/news/players/4281929/wide-1280.webp 1280w'), 'approved story photo is served');
  assert.ok(doc.includes('data-ssr-path="/news/satou-sabally-out-for-the-season-per-espns-injury-feed-dfe9a7"'));
  assert.doesNotMatch(doc, /PropBetEdge model:\s*not published/i);
});

test('article head: unique title, canonical, robots, article OG image and times', async () => {
  const { doc } = await page(`/news/${satouArticle.slug}`);
  assert.equal(all(doc, /<title>([^<]*)<\/title>/g).length, 1);
  assert.equal(all(doc, /rel="canonical" href="([^"]*)"/g).length, 1);
  assert.deepEqual(all(doc, /rel="canonical" href="([^"]*)"/g), [`${SITE}/news/${satouArticle.slug}`]);
  assert.match(doc, /<title>Satou Sabally out for the season[^<]*\| PropBetEdge WNBA<\/title>/);
  assert.match(doc, /<meta name="robots" content="index, follow, max-image-preview:large/);
  const og = doc.match(/property="og:image" content="([^"]*)"/)[1];
  assert.match(og, new RegExp(`^${SITE}/og/news/${satouArticle.slug}\\.png\\?v=`));
  assert.match(doc, /property="og:image:width" content="1200"/);
  assert.match(doc, /property="og:image:alt" content="Satou Sabally out for the season/);
  assert.match(doc, /property="og:type" content="article"/);
  assert.ok(doc.includes(`property="article:published_time" content="${satouArticle.first_published_at}"`));
  assert.ok(doc.includes(`property="article:modified_time" content="${satouArticle.revised_at}"`));
  assert.match(doc, /rel="alternate" type="application\/rss\+xml"[^>]*href="https:\/\/wnba\.propbetedge\.ai\/rss\.xml"/);
});

test('NewsArticle JSON-LD: immutable datePublished, revision dateModified, publisher graph, about/mentions', async () => {
  const { doc } = await page(`/news/${satouArticle.slug}`);
  const ld = ldOf(doc);
  assert.equal(ld['@context'], 'https://schema.org');
  const g = ld['@graph'];
  const byType = (t) => g.filter((x) => x['@type'] === t);
  for (const t of ['Organization', 'NewsMediaOrganization', 'WebSite', 'WebPage', 'NewsArticle', 'BreadcrumbList']) assert.equal(byType(t).length, 1, t);
  const art = byType('NewsArticle')[0];
  assert.equal(art.datePublished, satouArticle.first_published_at);
  assert.equal(art.dateModified, satouArticle.revised_at);
  assert.equal(art.mainEntityOfPage['@id'], `${SITE}/news/${satouArticle.slug}`);
  assert.equal(art.publisher['@id'], byType('NewsMediaOrganization')[0]['@id']);
  assert.equal(art.author['@id'], byType('NewsMediaOrganization')[0]['@id']);
  assert.equal(art.articleSection, 'Injury Desk');
  assert.ok(art.wordCount > 20);
  assert.ok(art.headline.length <= 110);
  assert.deepEqual(art.about.map((x) => x.url).sort(), [`${SITE}/players/4281929`, `${SITE}/teams/9`]);
  assert.deepEqual(art.mentions.map((x) => x.url).sort(), [`${SITE}/matchups/401857196`, `${SITE}/teams/8`]);
  assert.ok(art.image.some((i) => i.url.includes('/og/news/')));
  assert.ok(art.image.some((i) => i.url === `${SITE}/media/news/players/4281929/wide-1280.webp` && i.license));
  assert.ok(art.citation.some((c) => c.url === 'https://www.cbssports.com/wnba/news/x'));
  assert.doesNotMatch(JSON.stringify(ld), /null|undefined/);
});

test('an unrevised article has dateModified equal to datePublished and no Updated line', async () => {
  const fresh = { ...satouArticle, revised_at: null, first_published_at: ago(30) };
  const p = await renderRoute(`/news/${satouArticle.slug}`, { ...api, article: async () => ok({ article: fresh, related: [] }) });
  const doc = composeDocument(SHELL, p);
  const art = ldOf(doc)['@graph'].find((x) => x['@type'] === 'NewsArticle');
  assert.equal(art.dateModified, fresh.first_published_at);
  assert.ok(!doc.includes('article:modified_time'));
  assert.ok(!doc.includes('Updated <time'));
});

test('a collapsed duplicate article URL permanently redirects to the canonical story; unknown articles 404', async () => {
  const dup = await renderRoute(`/news/${collapsedDuplicate.slug}`, api);
  assert.equal(dup.status, 301);
  assert.equal(dup.redirect, `/news/${satouArticle.slug}`);
  const nf = await page('/news/not-a-story-abcdef');
  assert.equal(nf.status, 404);
  assert.match(nf.doc, /<meta name="robots" content="noindex, follow"/);
  assert.ok(!nf.doc.includes('data-ssr-path'));
});

// ------------------------------------------------------------ entity pages

test('player, team and matchup pages have unique, descriptive metadata and the right schema', async () => {
  const pl = await page('/players/4281929');
  const tm = await page('/teams/9');
  const mu = await page('/matchups/401857190');
  for (const p of [pl, tm, mu]) assert.equal(p.status, 200);
  assert.match(pl.doc, /<title>Satou Sabally WNBA Career Stats, Game Log, WinBA &amp; News \| PropBetEdge<\/title>/);
  assert.match(tm.doc, /<title>New York Liberty Roster, Player Stats, Schedule, Injuries &amp; News \| PropBetEdge<\/title>/);
  assert.match(mu.doc, /<title>Connecticut Sun vs Atlanta Dream WNBA Matchup, Injuries &amp; Analysis \| PropBetEdge<\/title>/);
  // Player description uses the year-labelled regular season from the game log, never year-less recent.season.
  assert.match(pl.doc, /2026 regular season: 10\.5 points, 3\.0 rebounds and 1\.5 assists per game in 2 games\./);
  assert.ok(!pl.doc.match(/<meta name="description" content="([^"]*)"/)[1].includes('99.0'));
  const titles = [pl, tm, mu].map((p) => p.doc.match(/<title>([^<]*)/)[1]);
  assert.equal(new Set(titles).size, 3);
  const person = ldOf(pl.doc)['@graph'].find((x) => x['@type'] === 'Person');
  assert.equal(person.name, 'Satou Sabally');
  assert.equal(person.birthDate, '1998-04-25');
  assert.equal(person.memberOf.url, `${SITE}/teams/9`);
  assert.match(person.description, /Career totals: 100 games, 1,800 points, 700 rebounds, 400 assists\./);
  assert.match(pl.doc, /<h1 class="p-name"[^>]*>Satou Sabally<\/h1>/);
  assert.match(pl.doc, /Career totals/);
  assert.match(pl.doc, /1,800 PTS/);
  assert.match(pl.doc, /2026[\s\S]*href="\/teams\/9"[\s\S]*19\.0/);
  const st = ldOf(tm.doc)['@graph'].find((x) => x['@type'] === 'SportsTeam');
  assert.equal(st.sport, 'Basketball');
  assert.equal(st.athlete[0].url, `${SITE}/players/4281929`);
  const ev = ldOf(mu.doc)['@graph'].find((x) => x['@type'] === 'SportsEvent');
  assert.equal(ev.startDate, game.start_utc);
  assert.equal(ev.eventStatus, 'https://schema.org/EventScheduled');
  assert.equal(ev.homeTeam.name, 'Atlanta Dream');
  assert.equal(ev.location.name, 'Gateway Center');
  assert.match(mu.doc, /<h1 class="sr">Connecticut Sun at Atlanta Dream/);
  for (const href of ['/teams/18', '/teams/20', '/cast/401857190', '/injuries']) assert.ok(mu.doc.includes(`href="${href}"`), href);
});

test('missing entities are real 404s (not soft 404s); an upstream outage is a 503 that is not indexed', async () => {
  assert.equal((await page('/players/999999999')).status, 404);
  assert.equal((await page('/teams/999')).status, 404);
  assert.equal((await page('/matchups/401999999')).status, 404);
  assert.equal((await page('/news/c/bogus')).status, 404);
  assert.equal((await page('/nonsense')).status, 404);
  const down = await renderRoute('/players/4281929', { ...api, player: async () => miss(502) });
  assert.equal(down.status, 503);
  assert.equal(down.meta.robots, 'noindex, follow');
});

test('no duplicate canonical URLs across indexable routes; canonicals never carry query strings or trailing slashes', async () => {
  const paths = ['/', '/news', '/news/c/injury', `/news/${satouArticle.slug}`, '/players/4281929', '/teams/9', '/matchups', '/matchups/401857190', '/injuries', '/standings', '/stats', '/teams', '/players', '/props', '/cast', '/about', '/editorial-policy', '/corrections', '/methodology', '/sources'];
  const canon = [];
  for (const p of paths) {
    const { doc, status } = await page(p);
    assert.equal(status, 200, p);
    const c = doc.match(/rel="canonical" href="([^"]*)"/)[1];
    assert.equal(c, `${SITE}${p === '/' ? '/' : p}`, p);
    assert.doesNotMatch(c, /\?|\/$(?<!propbetedge\.ai\/)/);
    canon.push(c);
  }
  assert.equal(new Set(canon).size, canon.length);
  assert.equal(routeMeta('news', { path: '/news/?utm_source=x' }).url, `${SITE}/news`);
});

test('search-intent titles for the top-of-funnel routes', () => {
  assert.equal(routeMeta('news', { path: '/news' }).title, 'WNBA News Today, Injuries, Transactions & Analysis | PropBetEdge');
  assert.equal(routeMeta('injuries', { path: '/injuries' }).title, 'WNBA Injuries Today & Player Availability | PropBetEdge');
  assert.equal(routeMeta('props', { path: '/props' }).title, 'WNBA Player Props & Best Sportsbook Lines | PropBetEdge');
  assert.equal(routeMeta('standings', { path: '/standings' }).title, 'WNBA Standings & Playoff Race | PropBetEdge');
});

test('an empty newsroom desk is noindex rather than a thin indexed page', async () => {
  const { doc } = await page('/news/c/props');
  assert.match(doc, /<meta name="robots" content="noindex, follow"/);
});

test('editorial cards on the server-rendered front page carry no sportsbook chips; Market Watch stays', async () => {
  const { doc } = await page('/news');
  assert.doesNotMatch(doc, /class="badge market"/);
  assert.match(doc, /Market Watch/);
  assert.match(doc, /class="mw-row"/);
  // The hero is the genuinely newest story (Carla), not the revised old injury.
  const lead = doc.match(/<div class="front-lead">([\s\S]*?)<\/article>/)[1];
  assert.match(lead, /Carla Leite in focus/);
});

// ------------------------------------------------------------ sitemaps, RSS, robots

test('news sitemap: canonical stories first published within 48h only, dated by first_published_at', () => {
  const items = [carlaCard, satouCard, collapsedDuplicate, oldTrend];
  const xml = newsSitemapXml(items, { now: NOW });
  assert.deepEqual(newsSitemapEntries(items, { now: NOW }).map((c) => c.id), ['e22194684c40']);
  assert.ok(xml.includes(`<loc>${SITE}/news/carla-leite-in-focus-e22194</loc>`));
  assert.ok(xml.includes(`<news:publication_date>${new Date(carlaCard.first_published_at).toISOString()}</news:publication_date>`));
  assert.ok(xml.includes('<news:name>PropBetEdge WNBA</news:name>'));
  assert.ok(xml.includes('<news:language>en</news:language>'));
  // Revised 5 minutes ago but first published four days ago: not eligible.
  assert.ok(!xml.includes(satouCard.slug));
  // Collapsed duplicate injury URL is never listed, even though its (poisoned) origin is recent.
  assert.ok(!xml.includes(collapsedDuplicate.slug));
  assert.ok(!xml.includes(oldTrend.slug));
});

test('a revision does not refresh news-sitemap eligibility: lifecycle merge + sitemap end to end', async () => {
  const origin = ago(5 * 24 * 60);
  const stored = { ...cardOf({ ...satouArticle, facts: { injury: { status: 'Out' } } }), input_hash: 'v|x', first_published_at: origin, revised_at: null, episode: '4281929|out' };
  const refresh = { ...satouArticle, id: 'freshhash001', slug: 'satou-refresh-freshh', deck: 'A new deck from a feed refresh.', published_at: ago(2), facts: { injury: { injury_id: '51391', status: 'Out' } } };
  const items = new Map();
  const { index } = await mergeArticles({ index: [stored], articles: [refresh], started: ago(1), now: NOW, feed: [{ athlete_id: '4281929', status: 'Out' }], getItem: async () => null, putItem: async (a) => items.set(a.id, a), versionOf: () => 'v', cardOf });
  assert.equal(index.length, 1);
  assert.equal(index[0].first_published_at, origin);
  assert.equal(index[0].revised_at, ago(1));
  assert.deepEqual(newsSitemapEntries(index, { now: NOW }), []);
  const rss = rssXml(index, { now: NOW });
  assert.ok(rss.includes(`<pubDate>${new Date(origin).toUTCString()}</pubDate>`));
  assert.ok(rss.includes(`<atom:updated>${new Date(ago(1)).toISOString()}</atom:updated>`));
});

test('general sitemap: canonical URLs only, real lastmod, no duplicates, no query strings', () => {
  const xml = sitemapXml({ articles: [carlaCard, satouCard, collapsedDuplicate], players: [{ athlete_id: '4281929' }], teams: [{ team_id: '9' }], games: [{ game_id: '401857190' }], desks: ['brief', 'injury'] });
  const locs = all(xml, /<loc>([^<]*)<\/loc>/g);
  assert.equal(new Set(locs).size, locs.length);
  for (const must of ['/', '/news', '/news/c/brief', '/news/c/injury', `/news/${carlaCard.slug}`, `/news/${satouCard.slug}`, '/players/4281929', '/teams/9', '/matchups/401857190', '/injuries', '/standings', '/stats', '/about', '/editorial-policy', '/corrections', '/methodology', '/sources']) assert.ok(locs.includes(`${SITE}${must}`), must);
  assert.ok(!locs.some((l) => l.includes(collapsedDuplicate.slug)));
  assert.ok(!locs.some((l) => /[?#]/.test(l)));
  assert.ok(xml.includes(`<loc>${SITE}/news/${satouCard.slug}</loc><lastmod>${new Date(satouCard.revised_at).toISOString()}</lastmod>`));
  assert.ok(xml.includes(`<loc>${SITE}/players/4281929</loc></url>`), 'no invented lastmod for entity pages');
});

test('RSS: canonical PBE articles only, immutable pubDate, PBE deck as description', () => {
  const rss = rssXml([carlaCard, satouCard, collapsedDuplicate], { now: NOW });
  const links = all(rss, /<item>[\s\S]*?<link>([^<]*)<\/link>/g);
  assert.deepEqual(links, [`${SITE}/news/${carlaCard.slug}`, `${SITE}/news/${satouCard.slug}`]);
  assert.ok(rss.includes(`<pubDate>${new Date(satouCard.first_published_at).toUTCString()}</pubDate>`));
  assert.ok(rss.includes('<atom:link href="https://wnba.propbetedge.ai/rss.xml" rel="self" type="application/rss+xml" />'));
  assert.ok(rss.includes('<description>Swish Appeal published “Carla Leite is the special talent firing up the relaunched Portland Fire”.</description>'));
  assert.deepEqual(canonicalArticles([collapsedDuplicate]), []);
});

test('robots.txt allows indexable surfaces and declares both sitemaps', () => {
  const robots = read('../public/robots.txt');
  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/wnba\.propbetedge\.ai\/sitemap\.xml$/m);
  assert.match(robots, /^Sitemap: https:\/\/wnba\.propbetedge\.ai\/news-sitemap\.xml$/m);
  for (const p of ['/news', '/players', '/teams', '/matchups', '/injuries', '/standings', '/og']) assert.doesNotMatch(robots, new RegExp(`^Disallow: ${p}`, 'm'));
});

test('Vercel routes HTML, feeds and share cards to the Cloudflare publishing Worker, never to Vercel Functions', () => {
  const vj = JSON.parse(read('../vercel.json'));
  assert.equal(vj.functions, undefined);
  assert.equal(vj.trailingSlash, false);
  assert.ok(vj.rewrites.some((r) => r.source === '/:path*' && r.destination === 'https://wnba-web.sales-fd3.workers.dev/:path*'));
  assert.ok(!vj.rewrites.some((r) => r.destination === '/index.html'));
});

// ------------------------------------------------------------ share cards

test('share cards state only page facts: no odds, a labelled season line, approved photo only', async () => {
  const article = await cardModel('news', satouArticle.slug, api);
  assert.equal(article.title, satouArticle.headline);
  assert.equal(article.photoPath, '/media/news/players/4281929/og.jpg');
  assert.equal(article.kicker, 'Injury Desk');
  const pl = await cardModel('players', '4281929', api);
  assert.equal(pl.detail, '2026 season · 10.5 PTS · 3.0 REB · 1.5 AST · 2 GP');
  const noPhoto = await cardModel('players', '4281929', { ...api, player: async () => ok({ ...player, photo: null }) });
  assert.equal(noPhoto, null, 'no approved photo → no player card (the default share image is used)');
  const mu = await cardModel('matchups', '401857190', api);
  assert.equal(mu.title, 'Sun at Dream');
  const text = JSON.stringify([article, pl, mu]);
  assert.doesNotMatch(text, /[+-]\d{3}\b|\bO\/U\b|spread|moneyline|probability|model/i);
});
