// International women's basketball: normalization, standings, bracket, crosswalk, freshness, server HTML and
// sitemap — against real ESPN FIBA payloads captured on 2026-09-13 (tests/fixtures/international/).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { COMPETITIONS, competitionById, competitionStatus, currentEdition } from '../workers/wnba-international/src/registry.js';
import { normalizeGame, normalizeSummary, normalizeStatus, parseStage, teamSlug } from '../workers/wnba-international/src/normalize.js';
import { groupStandings, bracket, playerAndTeamStats, leaders, dedupeGames, teamRecords } from '../workers/wnba-international/src/aggregate.js';
import { linkInternationalPlayers } from '../workers/wnba-international/src/crosswalk.js';
import { loadScoreboard, freshness } from '../workers/wnba-international/src/index.js';
import { renderRoute, composeDocument } from '../workers/wnba-web/src/render.js';
import { sitemapXml } from '../src/seo/feeds.js';
import { routeMeta } from '../src/seo/meta.js';
import { relevance, INTERNATIONAL } from '../workers/wnba-news/src/editorial.js';

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/international/${n}`, import.meta.url), 'utf8'));
const SB = fx('espn-scoreboard-20260913.json');
const FINAL = fx('espn-summary-401917257-final.json');
const LIVE = fx('espn-summary-401917259-live.json');
const COMP = COMPETITIONS[0];
const games = dedupeGames(SB.events.map((e) => normalizeGame(e, { competitionId: COMP.competition_id, fetchedAt: '2026-09-13T14:50:00Z' })));
const byEspn = (id) => games.find((g) => g.provider_ids.espn === id);
const SHELL = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// ------------------------------------------------------------ registry

test('competition registry: generic identity, aliases and date-derived status', () => {
  assert.equal(COMP.competition_type, 'world_cup');
  assert.equal(competitionById('world-cup'), COMP);
  assert.equal(competitionById('fiba-womens-world-cup-2026'), COMP);
  assert.equal(competitionById('world-cup-2026'), COMP);
  assert.equal(competitionById('nope'), null);
  assert.equal(competitionStatus(COMP, Date.parse('2026-09-01T00:00:00Z')), 'upcoming');
  assert.equal(competitionStatus(COMP, Date.parse('2026-09-13T18:00:00Z')), 'active');
  assert.equal(competitionStatus(COMP, Date.parse('2026-09-25T00:00:00Z')), 'recent');
  assert.equal(competitionStatus(COMP, Date.parse('2027-03-01T00:00:00Z')), 'historical');
  assert.equal(currentEdition('world_cup', Date.parse('2026-09-13T12:00:00Z')).slug, 'world-cup-2026');
});

// ------------------------------------------------------------ games

test('schedule normalization: 36 unique games with round, group, venue and teams', () => {
  assert.equal(games.length, 36);
  assert.equal(new Set(games.map((g) => g.game_id)).size, 36, 'no duplicate games');
  assert.equal(dedupeGames([...games, ...games]).length, 36, 'duplicates collapse');
  const rounds = games.reduce((m, g) => ((m[g.round] = (m[g.round] || 0) + 1), m), {});
  assert.deepEqual(rounds, { GROUP: 24, QQF: 4, QF: 4, SF: 2, BRONZE: 1, FINAL: 1 });
  const g = byEspn('401907392');
  assert.equal(g.group, 'C');
  assert.equal(g.venue.name, 'Max-Schmeling-Halle');
  assert.equal(g.home_team.country_code, 'PUR');
  assert.equal(parseStage('FIBA Women’s World Cup – Final').round_name, 'Final · Gold Medal Game');
});

test('team identity: readable national-team slugs, codes and self-hosted flags that exist', () => {
  const teams = new Map(games.flatMap((g) => [g.home_team, g.away_team]).map((t) => [t.team_id, t]));
  assert.equal(teams.size, 16);
  assert.equal(teamSlug({ location: 'United States' }), 'usa');
  assert.ok([...teams.values()].some((t) => t.slug === 'france' && t.country_code === 'FRA'));
  for (const t of teams.values()) assert.ok(fs.existsSync(new URL(`../public${t.flag}`, import.meta.url)), `flag ${t.flag}`);
  const manifest = JSON.parse(fs.readFileSync(new URL('../data/flags.json', import.meta.url), 'utf8'));
  for (const t of teams.values()) assert.equal(manifest.flags[t.country_code].license, 'Public domain', t.country_code);
});

test('live state: period, clock and scores; scheduled has no scores; final has a winner and no clock', () => {
  const live = byEspn('401917259');
  assert.equal(live.status, 'live');
  assert.equal(live.period_label, 'Q2');
  assert.equal(live.clock, '7:32');
  assert.equal(live.away_team.country_code, 'ESP');
  assert.equal(live.away_score, 25);
  assert.equal(live.home_score, 19);
  assert.equal(live.winner, null);
  const sched = byEspn('401917260');
  assert.equal(sched.status, 'scheduled');
  assert.equal(sched.home_score, null);
  assert.equal(sched.period, null);
  assert.equal(sched.clock, null);
  const fin = byEspn('401917257');
  assert.equal(fin.status, 'final');
  assert.equal(fin.clock, null);
  assert.equal(fin.winner, 'nt-usa');
  assert.equal(normalizeStatus({ type: { state: 'in', name: 'STATUS_HALFTIME' }, period: 2, displayClock: '0:00' }).halftime, true);
  assert.equal(normalizeStatus({ type: { state: 'pre', name: 'STATUS_POSTPONED' } }).status, 'postponed');
});

test('box score: player lines are numeric and team points equal the final score', () => {
  const d = normalizeSummary(FINAL, { competitionId: COMP.competition_id, eventId: '401917257' });
  assert.equal(d.game.status, 'final');
  const usa = d.boxscore.teams.find((t) => t.team.country_code === 'USA');
  const esp = d.boxscore.teams.find((t) => t.team.country_code === 'ESP');
  assert.equal(usa.totals.pts, d.game.home_score);
  assert.equal(esp.totals.pts, d.game.away_score);
  assert.equal(usa.totals.fgm, usa.players.reduce((s, p) => s + p.fgm, 0));
  const fam = esp.players.find((p) => p.name === 'Awa Fam');
  assert.deepEqual([fam.player_id, fam.jersey, fam.min, fam.pts, fam.reb, fam.fgm, fam.fga], ['p-5345325', '11', 29, 9, 7, 4, 8]);
  assert.ok(d.plays.length > 300);
  assert.ok(d.plays.filter((p) => p.coordinate).every((p) => Number.isFinite(p.coordinate.x)), 'coordinates only as published');
  const lv = normalizeSummary(LIVE, { competitionId: COMP.competition_id, eventId: '401917259' });
  assert.equal(lv.game.status, 'live');
  assert.equal(lv.plays.length, 0, 'no invented play-by-play while the provider publishes none');
});

// ------------------------------------------------------------ aggregates

test('group standings match FIBA final order, including head-to-head tiebreaks', () => {
  const st = groupStandings(games);
  const order = Object.fromEntries(st.map((s) => [s.group, s.entries.map((e) => e.team.country_code)]));
  assert.deepEqual(order, { A: ['ESP', 'GER', 'JPN', 'MLI'], B: ['FRA', 'HUN', 'KOR', 'NGR'], C: ['BEL', 'AUS', 'PUR', 'TUR'], D: ['USA', 'CHN', 'ITA', 'CZE'] });
  const a = st.find((s) => s.group === 'A');
  assert.ok(a.entries[3].diff > a.entries[2].diff, 'MLI has the better differential but loses the tie on head-to-head');
  assert.ok(st.every((s) => s.entries.every((e) => e.played === 3)));
});

test('knockout bracket: rounds in order, winners advance, medals only once the final is final', () => {
  const b = bracket(games);
  assert.deepEqual(b.rounds.map((r) => r.round), ['QQF', 'QF', 'SF', 'FINAL']);
  assert.deepEqual(b.rounds.map((r) => r.games.length), [4, 4, 2, 1]);
  const sf = b.rounds.find((r) => r.round === 'SF').games;
  assert.ok(sf.every((g) => g.next_game_id === 'g-401917260'));
  assert.equal(b.bronze_game.provider_ids.espn, '401917259');
  assert.equal(b.medals, null, 'no medal is claimed before the final ends');
  const done = games.map((g) => (g.round === 'FINAL' ? { ...g, status: 'final', home_score: 80, away_score: 70, winner: g.home_team_id } : g.round === 'BRONZE' ? { ...g, status: 'final', home_score: 60, away_score: 70, winner: g.away_team_id } : g));
  const medals = bracket(done).medals;
  assert.deepEqual([medals.gold.country_code, medals.silver.country_code, medals.bronze.country_code], ['FRA', 'USA', 'ESP']);
});

test('players, leaders and the WNBA crosswalk: no duplicates, ID join only with identical names', () => {
  const d = normalizeSummary(FINAL, { competitionId: COMP.competition_id, eventId: '401917257' });
  const stats = playerAndTeamStats([{ game: byEspn('401917257'), boxscore: d.boxscore }, { game: byEspn('401917257'), boxscore: d.boxscore }]);
  assert.equal(new Set(stats.players.map((p) => p.player_id)).size, stats.players.length, 'no duplicate players');
  const clark = stats.players.find((p) => p.name === 'Caitlin Clark');
  assert.equal(clark.games, 2);
  const roster = [
    { athlete_id: '4433403', name: 'Caitlin Clark', dob: '2002-01-22', team: { team_id: '5', abbr: 'IND', name: 'Indiana Fever' } },
    { athlete_id: '5345325', name: 'Awa Fam', dob: '2006-06-17', team: { team_id: '14', abbr: 'SEA', name: 'Seattle Storm' } },
    { athlete_id: '3917450', name: 'Somebody Else', dob: '1990-01-01', team: null }
  ];
  const n = linkInternationalPlayers(stats.players, roster, { capturedAt: '2026-09-13T15:00:00Z' });
  assert.equal(n, 2);
  assert.equal(clark.wnba.wnba_team.abbr, 'IND');
  assert.equal(clark.wnba.mapping_method, 'provider_athlete_id');
  assert.equal(stats.players.find((p) => p.name === 'Napheesa Collier').wnba, undefined, 'an id collision with a different name never links');
  const top = leaders(stats.players, { minGames: 1 });
  assert.deepEqual(top.map((l) => l.stat), ['pts', 'reb', 'ast', 'stl', 'blk', 'eff']);
  assert.ok(top.every((l) => l.rows.every((r, i, xs) => i === 0 || xs[i - 1].value >= r.value)));
  assert.deepEqual(teamRecords(games).get('nt-usa'), { wins: 5, losses: 0 });
});

// ------------------------------------------------------------ provider failure and freshness

test('provider timeout serves KV last-good as stale; freshness never claims current when stale', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); };
  try {
    const kv = new Map([[`sb:${COMP.competition_id}`, JSON.stringify({ fetched_at: '2026-09-13T14:00:00Z', games: games.slice(0, 3) })]]);
    const env = { INTL_KV: { get: async (k, t) => (kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => kv.set(k, v) } };
    const sb = await loadScoreboard(env, COMP, null, { ttlS: 10 });
    assert.equal(sb.cache, 'kv-stale');
    assert.equal(sb.games.length, 3);
    assert.match(String(sb.error), /timeout/);
    const f = freshness(sb.fetched_at, [{ status: 'live' }], sb.cache);
    assert.equal(f.stale, true);
    assert.equal(f.state, 'STALE');
    const none = await loadScoreboard({ INTL_KV: { get: async () => null, put: async () => {} } }, COMP, null, { ttlS: 10 });
    assert.equal(none.games.length, 0);
    assert.equal(freshness(null, [], 'none').state, 'ERROR');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ------------------------------------------------------------ publishing

const agg = (() => {
  const d = normalizeSummary(FINAL, { competitionId: COMP.competition_id, eventId: '401917257' });
  const stats = playerAndTeamStats([{ game: byEspn('401917257'), boxscore: d.boxscore }]);
  linkInternationalPlayers(stats.players, [{ athlete_id: '4433403', name: 'Caitlin Clark', team: { team_id: '5', abbr: 'IND', name: 'Indiana Fever' } }]);
  return { d, stats };
})();
const compSummary = { competition_id: COMP.competition_id, slug: COMP.slug, name: COMP.name, short_name: COMP.short_name, competition_type: 'world_cup', governing_body: 'FIBA', region: 'World', season: 2026, host: COMP.host, start_date: COMP.start_date, end_date: COMP.end_date, coverage: 'full', status: 'active' };
const ok = (data) => ({ ok: true, status: 200, data, meta: { fetched_at: new Date().toISOString(), source: { name: 'ESPN' }, freshness: 'CURRENT' } });
const clark = agg.stats.players.find((p) => p.name === 'Caitlin Clark');
const intlApi = {
  intl: async () => ok({ competitions: [compSummary], live: [byEspn('401917259')], recent: [byEspn('401917257')], wnba_players: [clark] }),
  intlCompetition: async (slug, view) => (slug === 'world-cup-2026' ? ok(view === 'schedule' ? { competition: compSummary, games } : view === 'players' ? { competition: compSummary, players: agg.stats.players } : view === 'teams' ? { competition: compSummary, teams: [] } : { competition: compSummary, scoreboard: { live: [byEspn('401917259')], today: [byEspn('401917259'), byEspn('401917260')], next: [byEspn('401917260')], recent: [byEspn('401917257')] }, bracket: bracket(games), standings: groupStandings(games), leaders: leaders(agg.stats.players, { minGames: 1 }), wnba_players: [clark], teams: [], counts: { games: 36, finals: 34, teams: 16, wnba_mapped: 51 } }) : { ok: false, status: 404, error: { code: 'competition_not_found' } }),
  intlGame: async (id) => (id === '401917257' ? ok({ competition: compSummary, game: byEspn('401917257'), records: {}, boxscore: agg.d.boxscore, plays: agg.d.plays.slice(-20), wnba_players: [clark] }) : { ok: false, status: 404, error: { code: 'game_not_found' } }),
  intlTeam: async (slug) => (slug === 'usa' ? ok({ team: byEspn('401917257').home_team, competitions: [{ competition: compSummary, record: { wins: 5, losses: 0 }, averages: { pts: 90 }, games: games.filter((g) => [g.home_team_id, g.away_team_id].includes('nt-usa')), roster: [{ ...clark, averages: clark.averages }], standing: null, medal: null }], wnba_players: [clark] }) : { ok: false, status: 404, error: { code: 'team_not_found' } }),
  intlPlayer: async (id) => (id === '4433403' ? ok({ player: { ...clark, bio: { dob: '2002-01-22', height: '6\' 0"' } }, competitions: [{ competition: compSummary, team: clark.team, games: clark.games, averages: clark.averages, highs: clark.highs, log: clark.log }] }) : { ok: false, status: 404, error: { code: 'player_not_found' } }),
  player: async () => ({ ok: false, status: 404 }),
  news: async () => ok({ items: [{ id: 'x', headline: 'USA and France meet for gold', url: 'https://example.com/a', source: { name: 'ESPN' }, published_at: new Date().toISOString() }] })
};
const page = async (path) => { const p = await renderRoute(path, intlApi); return { ...p, doc: p.meta ? composeDocument(SHELL, p) : null }; };
const ld = (doc) => JSON.parse(doc.match(/data-ld="page">([\s\S]*?)<\/script>/)[1])['@graph'];

test('international routes render server-visible HTML with canonical, title and structured data', async () => {
  const wc = await page('/international/world-cup-2026');
  assert.equal(wc.status, 200);
  assert.match(wc.doc, /<title>FIBA Women’s Basketball World Cup 2026 Live Scores, Schedule &amp; Stats \| PropBetEdge<\/title>/);
  assert.match(wc.doc, /rel="canonical" href="https:\/\/wnba\.propbetedge\.ai\/international\/world-cup-2026"/);
  assert.match(wc.doc, /<h1 class="ihero-title">FIBA Women’s Basketball World Cup 2026<\/h1>/);
  assert.match(wc.doc, /class="istate istate--live"/);
  assert.match(wc.doc, /href="\/players\/4433403"/, 'WNBA crosslink in the first response');
  assert.ok(ld(wc.doc).some((x) => x['@type'] === 'SportsEvent' && x.startDate === '2026-09-04'));

  const gm = await page('/international/games/401917257');
  assert.match(gm.doc, /<title>Spain vs United States — World Cup 2026 Semi-Finals: Final Score &amp; Box Score \| PropBetEdge<\/title>/);
  const ev = ld(gm.doc).find((x) => x['@type'] === 'SportsEvent');
  assert.equal(ev.homeTeam.name, 'United States women’s national basketball team');
  assert.equal(ev.superEvent.url, 'https://wnba.propbetedge.ai/international/world-cup-2026');
  assert.match(gm.doc, /Awa Fam/);
  assert.match(gm.doc, /property="og:image" content="https:\/\/wnba\.propbetedge\.ai\/og\/intl-games\/401917257\.png"/);

  const tm = await page('/international/teams/usa');
  assert.match(tm.doc, /<title>USA Women’s Basketball: Roster, Schedule &amp; Results \| PropBetEdge<\/title>/);
  assert.ok(ld(tm.doc).some((x) => x['@type'] === 'SportsTeam'));

  const pl = await page('/international/players/4433403-caitlin-clark');
  assert.equal(pl.status, 200);
  assert.match(pl.doc, /<title>Caitlin Clark International Basketball Stats &amp; WNBA Profile \| PropBetEdge<\/title>/);
  const person = ld(pl.doc).find((x) => x['@type'] === 'Person');
  assert.deepEqual(person.sameAs, ['https://wnba.propbetedge.ai/players/4433403']);
  assert.equal(person.birthDate, '2002-01-22');
  assert.match(pl.doc, /WNBA connection/);
});

test('one canonical URL: aliases and bare player ids 301; unknown international entities 404', async () => {
  assert.deepEqual(await renderRoute('/world-cup', intlApi).then((p) => [p.status, p.redirect]), [301, '/international/world-cup-2026']);
  assert.deepEqual(await renderRoute('/international/world-cup/bracket', intlApi).then((p) => [p.status, p.redirect]), [301, '/international/world-cup-2026/bracket']);
  assert.deepEqual(await renderRoute('/international/players/4433403', intlApi).then((p) => [p.status, p.redirect]), [301, '/international/players/4433403-caitlin-clark']);
  assert.equal((await renderRoute('/international/teams/atlantis', intlApi)).status, 404);
  assert.equal((await renderRoute('/international/games/401999999', intlApi)).status, 404);
  assert.equal((await renderRoute('/international/players/1234567', intlApi)).status, 404);
});

test('thin international player pages are noindex and absent from the sitemap', () => {
  const thin = { player: { player_id: 'p-1', name: 'One Game', team: { name: 'Mali', slug: 'mali' }, wnba: null }, competitions: [{ competition: compSummary, games: 1, averages: { pts: 2, reb: 1, ast: 0 } }] };
  assert.equal(routeMeta('intl-player', { path: '/international/players/1-one-game', data: thin }).robots, 'noindex, follow');
  const xml = sitemapXml({ teams: [], international: { competitions: [compSummary], games: games.slice(0, 2), teams: [{ slug: 'usa' }], players: [{ player_id: 'p-4433403', name: 'Caitlin Clark', games: 5, wnba: {} }, { player_id: 'p-1', name: 'One Game', games: 1, wnba: null }] } });
  for (const u of ['/international', '/international/world-cup-2026', '/international/world-cup-2026/bracket', '/international/games/401907392', '/international/teams/usa', '/international/players/4433403-caitlin-clark']) assert.ok(xml.includes(`<loc>https://wnba.propbetedge.ai${u}</loc>`), u);
  assert.ok(!xml.includes('one-game'));
});

test('the WNBA news relevance guard is unchanged: international-only items stay out of the WNBA feed', () => {
  const dict = { players: [], teams: [] };
  const r = relevance({ headline: 'Spain edges Germany for World Cup bronze', summary: 'FIBA Women’s World Cup third-place game' }, [], { wnba_scope: 'mixed' }, dict);
  assert.equal(r.accept, false);
  assert.ok(INTERNATIONAL.test('FIBA Women’s World Cup final'));
});

// ------------------------------------------------------------ international desk (wnba-news)

import { internationalArticles, materialInternationalGames, INTL_VERSION } from '../workers/wnba-news/src/international.js';
import { reconcileArticle } from '../workers/wnba-news/src/reconcile.js';
import { mergeArticles } from '../workers/wnba-news/src/lifecycle.js';
import { cardOf } from '../workers/wnba-news/src/articles.js';

const medalFixture = () => {
  // Test fixture: the real semi-final box score relabeled as the gold-medal game.
  const d = normalizeSummary(FINAL, { competitionId: COMP.competition_id, eventId: '401917257' });
  const game = { ...byEspn('401917257'), round: 'FINAL', round_name: 'Final · Gold Medal Game' };
  const stats = playerAndTeamStats([{ game, boxscore: d.boxscore }]);
  linkInternationalPlayers(stats.players, [{ athlete_id: '4433403', name: 'Caitlin Clark', team: { team_id: '5', abbr: 'IND', name: 'Indiana Fever' } }, { athlete_id: '5345325', name: 'Awa Fam', team: { team_id: '14', abbr: 'SEA', name: 'Seattle Storm' } }]);
  const byPlayer = new Map(stats.players.map((p) => [p.player_id, p]));
  const boxscore = { teams: d.boxscore.teams.map((t) => ({ ...t, players: t.players.map((p) => ({ ...p, wnba: byPlayer.get(p.player_id)?.wnba || null })) })) };
  const overview = { competition: compSummary, bracket: { rounds: [{ round: 'FINAL', games: [game] }], bronze_game: null, medals: null } };
  // The desk reads the competition schedule (tournament path) and the play-by-play, as production does.
  const detail = { game, boxscore, plays: d.plays || [], plays_available: Boolean(d.plays?.length), fetched_at: '2026-09-12T20:40:00Z' };
  const intlGet = async (path) => (path.endsWith('/schedule') ? { games } : path.includes('/competitions/') ? overview : path.includes('/games/401917257') ? detail : null);
  return { game, intlGet };
};

test('international desk: a medal game that just ended becomes one gated story; old or non-medal games never do', async () => {
  const { game, intlGet } = medalFixture();
  const justAfter = Date.parse(game.scheduled_at) + 3 * 3600e3;
  const [story, ...rest] = await internationalArticles({ intlGet, now: justAfter });
  assert.equal(rest.length, 0);
  assert.equal(story.status, 'published', story.gate.failures.join('\n'));
  assert.equal(story.kind, 'international');
  // wnba-game-story/1.0.0: national-team names take their article ("The United States").
  assert.equal(story.headline, 'The United States beat Spain 76–66 to win gold at the FIBA Women’s Basketball World Cup 2026');
  assert.ok(story.entities.some((e) => e.type === 'player' && e.id === '4433403'), 'WNBA player linked to her WNBA profile');
  assert.ok(story.entities.some((e) => e.type === 'intl_team' && e.id === 'usa'));
  assert.match(story.body.join(' '), /Caitlin Clark \(Indiana Fever\)[^.]*for the United States/);
  const rec = reconcileArticle(story, { season: 2026, injuries: [] });
  assert.equal(rec.ok, true, rec.failures.join('\n'));

  assert.deepEqual(await internationalArticles({ intlGet, now: Date.parse(game.scheduled_at) + 20 * 3600e3 }), [], 'a game that ended more than 12 hours ago is not promoted into a new story');
  // Desk 2.0.0: every knockout game (qualification round → final) is material; group-stage games are not.
  assert.equal(materialInternationalGames({ bracket: { rounds: [{ games: [{ ...game, round: 'GROUP' }] }] } }, justAfter).length, 0, 'group-stage games are not promoted');
  assert.equal(materialInternationalGames({ bracket: { rounds: [{ games: [{ ...game, round: 'SF' }] }] } }, justAfter).length, 1, 'a semifinal is an elimination game story');
  assert.equal(materialInternationalGames({ bracket: { rounds: [{ games: [{ ...game, status: 'live', winner: null }] }] } }, justAfter).length, 0, 'no result story before the game is final');

  // Same game, later pass with a box-score correction: same story id, a revision that keeps its origin.
  const [again] = await internationalArticles({ intlGet, now: justAfter + 600e3 });
  assert.equal(again.id, story.id);
  const items = new Map();
  const first = await mergeArticles({ index: [], articles: [story], started: new Date(justAfter).toISOString(), now: justAfter, feed: null, getItem: async () => null, putItem: async (a) => items.set(a.id, a), versionOf: () => INTL_VERSION, cardOf });
  const corrected = { ...again, input_hash: `${again.input_hash}|corrected` };
  const second = await mergeArticles({ index: first.index, articles: [corrected], started: new Date(justAfter + 600e3).toISOString(), now: justAfter + 600e3, feed: null, getItem: async () => null, putItem: async (a) => items.set(a.id, a), versionOf: () => INTL_VERSION, cardOf });
  assert.equal(second.index.length, 1);
  assert.equal(second.index[0].first_published_at, new Date(justAfter).toISOString());
  assert.equal(second.index[0].revised_at, new Date(justAfter + 600e3).toISOString());
});

test('a registry-only competition page never promises scores or stats in its title and is noindex', () => {
  const reg = COMPETITIONS.find((c) => c.coverage === 'registry_only');
  const meta = routeMeta('intl-competition', { path: `/international/${reg.slug}`, params: { competition: reg.slug }, data: { competition: { ...reg, status: 'upcoming' } } });
  assert.equal(meta.title, `${reg.name} | PropBetEdge`);
  assert.equal(meta.robots, 'noindex, follow');
  assert.ok(COMPETITIONS.filter((c) => c.coverage === 'registry_only').every((c) => !c.start_date && !c.qualification_relationships.length), 'no unverified dates or qualification links');
});

test('international desk: a box score without minutes publishes without printing "null" (bronze game, 2026-09-13)', async () => {
  const { game, intlGet } = medalFixture();
  const noMinutes = async (path) => {
    const r = await intlGet(path);
    if (!r?.boxscore) return r;
    // ESPN's FIBA feed omitted minutes (and some rebounds/assists) for players in the real bronze-medal box score.
    return { ...r, boxscore: { teams: r.boxscore.teams.map((t) => ({ ...t, players: t.players.map((p, i) => ({ ...p, min: p.wnba ? p.min : null, ...(i === 1 ? { reb: null } : {}) })) })) } };
  };
  const [story] = await internationalArticles({ intlGet: noMinutes, now: Date.parse(game.scheduled_at) + 3 * 3600e3 });
  assert.doesNotMatch(story.body.join(' '), /null/);
  assert.equal(story.status, 'published', story.gate.failures.join('\n'));
  const rec = reconcileArticle(story, { season: 2026, injuries: [] });
  assert.equal(rec.ok, true, rec.failures.join('\n'));
});
