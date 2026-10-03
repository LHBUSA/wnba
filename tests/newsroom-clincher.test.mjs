// A series-clinching playoff result is the story of the team that advanced (2026 first round: the Valkyries
// beat the Wings 77–73 in Game 3 while Arike Ogunbowale scored 30). Regressions:
//   * a 28+ line on the ELIMINATED side made the story a "performance" about her, named no winning player,
//     and the deck credited the win "behind" her points;
//   * forward-looking prop/caution lines were written about a player whose season was over;
//   * the next opponent was missing whenever the next game's tip time was TBD, though the bracket had it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { playoffContext, seriesGames, advanceOf } from '../workers/wnba-news/src/playoff-context.js';
import { attachNewsroomVisuals } from '../workers/wnba-news/src/newsroom-visuals.js';

const T = (id, abbr, short, seed) => ({ team_id: id, team_name: `${short} Team`, abbreviation: abbr, short_name: short, seed });
const GS = T('129689', 'GS', 'Valkyries', 2); const DAL = T('3', 'DAL', 'Wings', 7); const LV = T('17', 'LV', 'Aces', 3); const IND = T('5', 'IND', 'Fever', 6);
const game = (id, n, home, away, hs, as, start, extra = {}) => ({ game_id: id, game_number: n, start_utc: start, status: hs === null ? 'SCHEDULED' : 'FINAL', home_team: home, away_team: away, home_score: hs, away_score: as, winner_team_id: hs === null ? null : hs > as ? home.team_id : away.team_id, if_necessary: false, ...extra });
const playoffs = {
  season: 2026, phase: 'POSTSEASON',
  rounds: [
    { name: 'First Round', round_id: 'first-round', series: [
      { series_id: 'fr-gs-dal', best_of: 3, wins_needed: 2, higher_seed: GS, lower_seed: DAL, winner_team_id: '129689', games: [
        game('g1', 1, GS, DAL, 104, 80, '2026-09-28T01:00Z'),
        game('g2', 2, DAL, GS, 108, 100, '2026-10-01T01:00Z'),
        game('g3', 3, GS, DAL, 77, 73, '2026-10-03T01:00Z')
      ] },
      { series_id: 'fr-lv-ind', best_of: 3, wins_needed: 2, higher_seed: LV, lower_seed: IND, winner_team_id: '17', games: [] }
    ] },
    { name: 'Semifinals', round_id: 'semifinals', series: [
      { series_id: 'sf-gs-lv', best_of: 5, wins_needed: 3, higher_seed: GS, lower_seed: LV, games: [
        game('s1', 1, GS, LV, null, null, '2026-10-04T04:00Z', { time_tbd: true, venue: { name: 'Chase Center' } })
      ] }
    ] }
  ]
};

test('bracket facts: series games through the clincher, and where the winner goes next', () => {
  const sg = seriesGames(playoffs, 'fr-gs-dal', { throughGameId: 'g3' });
  assert.deepEqual(sg.map((x) => [x.game_number, x.home_abbr, x.home_score, x.away_score, x.winner_team_id]), [[1, 'GS', 104, 80, '129689'], [2, 'DAL', 108, 100, '3'], [3, 'GS', 77, 73, '129689']]);
  assert.equal(seriesGames(playoffs, 'fr-gs-dal', { throughGameId: 'g2' }).length, 2, 'a Game 2 story never sees Game 3');
  const adv = advanceOf(playoffs, '129689', 'fr-gs-dal');
  assert.equal(adv.round, 'Semifinals');
  assert.equal(adv.best_of, 5);
  assert.deepEqual([adv.seed, adv.opponent.abbr, adv.opponent.seed], [2, 'LV', 3]);
  assert.deepEqual([adv.game1.venue, adv.game1.time_tbd, adv.game1.home_team_id], ['Chase Center', true, '129689']);
  assert.equal(advanceOf(playoffs, '3', 'fr-gs-dal'), null, 'the eliminated team goes nowhere');
  const pc = playoffContext(playoffs, 'g3');
  assert.equal(pc.decided_by_this_game, true);
  assert.equal(pc.stakes['129689'], 'decider');
});

test('series strip: one strip from the winner side, W/L and margins from bracket scores', () => {
  const a = {
    id: 'x', kind: 'result', updated_at: '2026-10-03T03:30:00.000Z', sections: [{ title: 'Game story', first: 0, count: 1 }, { title: 'How it happened', first: 1, count: 1 }, { title: 'What it means', first: 2, count: 1 }], body: ['a', 'b', 'c'],
    context: { game: { game_id: 'g3', start_utc: '2026-10-03T01:00Z', home: { team_id: '129689', abbr: 'GS', short_name: 'Valkyries', score: 77, winner: true }, away: { team_id: '3', abbr: 'DAL', short_name: 'Wings', score: 73 } } },
    facts: { playoff: { ...playoffContext(playoffs, 'g3') }, series_games: seriesGames(playoffs, 'fr-gs-dal', { throughGameId: 'g3' }) }
  };
  const essential = attachNewsroomVisuals(a);
  assert.deepEqual(essential, []);
  const strip = a.visuals.find((v) => v.id === 'series-strip');
  assert.ok(strip, JSON.stringify(a.visual_failures));
  assert.equal(strip.subtitle, 'Valkyries win the series 2–1');
  assert.deepEqual(strip.strips[0].items.map((i) => [i.label, i.result, i.value, i.meta]), [['Game 1 vs DAL', 'W', 24, '104–80'], ['Game 2 at DAL', 'L', -8, '108–100'], ['Game 3 vs DAL', 'W', 4, '77–73']]);
  assert.ok(a.sections.find((s) => s.title === 'What it means').visuals.includes('series-strip'));
});

test('resultDeep: a clincher leads with the advancing team, never the eliminated side', () => {
  const src = readFileSync(new URL('../workers/wnba-news/src/deep.js', import.meta.url), 'utf8');
  assert.match(src, /const stars = clincher \? allStars\.filter\(\(r\) => r\.team_id === winner\.team_id\) : allStars;/);
  assert.match(src, /advance to the \$\{advance \? roundLabel\(advance\.round\) : 'next round'\}/);
  assert.match(src, /\$\{topTeam === winner \? 'behind' : 'despite'\} \$\{poss\(top\.name\)\}/, 'the deck never credits a win "behind" the losing side');
  assert.match(src, /series_games: series\.length \? series : null, advance,/);
});
