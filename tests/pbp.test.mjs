// Play-by-play semantics (pbe-pbp/1.0.0) on real provider payloads:
//   tests/fixtures/international/espn-summary-401917260-final.json — USA 97–79 France, FIBA Women's World Cup final
//   tests/fixtures/espn-summary-401857189.json                     — a WNBA regular-season game
// The rule under test: a user understands what happened on the court from the text alone, and nothing is stated that
// the provider did not publish.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { semanticPlays, semanticPlay, resolversFromSummary, pbpQuality, describePlay, GENERIC_SHOT_TEXT } from '../workers/shared/pbp.js';
import { normalizePlays, normalizeSummary as normalizeIntlSummary } from '../workers/wnba-international/src/normalize.js';
import { normalizeSummary } from '../workers/shared/espn.js';
import { pbpFeed, pbpEmphasis } from '../src/ui/pbp.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const FINAL = read('./fixtures/international/espn-summary-401917260-final.json');
const WNBA = read('./fixtures/espn-summary-401857189.json');
const usa = semanticPlays(FINAL.plays, resolversFromSummary(FINAL));
const wnba = semanticPlays(WNBA.plays, resolversFromSummary(WNBA));
const at = (plays, q, clock) => plays.filter((p) => p.period === q && p.clock === clock);

test('USA–France Q4 7:16: the foul and both Caitlin Clark free throws, in source order, described from structured fields', () => {
  const seq = at(usa, 4, '7:16');
  assert.deepEqual(seq.map((p) => p.text_raw), ['Foul on Migna Toure.', 'Caitlin Clark makes', 'Caitlin Clark makes']);
  assert.deepEqual(seq.map((p) => p.description), ['Migna Toure personal foul.', 'Caitlin Clark makes a free throw.', 'Caitlin Clark makes a free throw.']);
  assert.deepEqual(seq.map((p) => p.family), ['foul', 'free_throw', 'free_throw']);
  assert.ok(seq[0].seq < seq[1].seq && seq[1].seq < seq[2].seq, 'sequence order, not clock text');
  assert.deepEqual(seq.map((p) => `${p.away_score}–${p.home_score}`), ['78–59', '79–59', '80–59'], 'score after each event');
  // The FIBA feed does not number free throws: no "1 of 2" is invented from the timestamp or the foul.
  assert.ok(seq.every((p) => p.free_throw === null && !/of 2/.test(p.description)));
});

test('USA–France: Collier 8:02, Badiane 8:33 and Ayayi 6:53 — shot type and value from type/pointsAttempted, never from score movement', () => {
  assert.equal(at(usa, 4, '8:02')[0].description, 'Napheesa Collier makes a two-point jump shot.');
  assert.equal(at(usa, 4, '8:33')[0].description, 'Marieme Badiane makes a two-point jump shot.');
  const miss = at(usa, 4, '6:53')[0];
  assert.equal(miss.text_raw, 'Valeriane Ayayi misses');
  assert.equal(miss.description, 'Valeriane Ayayi misses a two-point jump shot.');
  assert.equal(miss.made, false);
  assert.equal(miss.distance_ft, null, 'no distance: the provider publishes none');
  const assisted = usa.find((p) => /\(Aliyah Boston assists\)/.test(p.text_raw || ''));
  assert.match(assisted.description, /^Caitlin Clark makes a three-point jump shot \(Aliyah Boston assists\)\.$/);
  assert.equal(assisted.assist.name, 'Aliyah Boston');
  assert.equal(assisted.assist.id, '4432831');
});

test('production acceptance: no "Player makes" / "Player misses" description, every scoring play rich, scores consistent, order intact', () => {
  for (const plays of [usa, wnba]) {
    const q = pbpQuality(plays);
    assert.equal(q.generic, 0);
    assert.equal(q.scoring_rich_pct, 100);
    assert.equal(q.out_of_order, 0);
    assert.equal(q.unresolved_identities, 0);
    assert.deepEqual(q.score_inconsistencies, []);
  }
  assert.ok(usa.every((p) => !GENERIC_SHOT_TEXT.test(p.description)));
  assert.equal(pbpQuality(usa).by_source.fallback, 0);
});

test('rebounds, turnovers, steals, blocks, fouls and timeouts: individual vs team, types only as sourced', () => {
  const find = (re) => usa.find((p) => re.test(p.text_raw || ''));
  assert.equal(find(/^France Defensive Rebound\.$/).description, 'France team defensive rebound.');
  assert.equal(find(/Deadball Team Rebound/).description, 'France team dead-ball rebound.');
  assert.equal(find(/^Janelle Salaun Offensive Rebound\.$/).description, 'Janelle Salaun offensive rebound.');
  assert.equal(find(/^Napheesa Collier$/).description, 'Napheesa Collier turnover (lost ball).');
  assert.equal(find(/^Chelsea Gray Steal\.$/).description, 'Chelsea Gray steal.');
  assert.equal(find(/^Aliyah Boston Block\.$/).description, 'Aliyah Boston block.');
  assert.equal(find(/^Technical Foul on Marine Johannes\.$/).description, 'Marine Johannes technical foul.');
  assert.equal(find(/^United States Timeout$/).description, 'United States timeout.');
  assert.equal(find(/^Gabby Williams misses $/).description, 'Gabby Williams misses a free throw.', 'FIBA type MadeFreeThrow with scoringPlay false is a missed free throw');
});

test('WNBA payloads: complete source text is preserved; sourced free-throw numbers, blocks, steals and foul types survive', () => {
  const byText = (t) => wnba.find((p) => p.text_raw === t);
  assert.equal(byText('Paige Bueckers misses 27-foot three point pullup jump shot').description, 'Paige Bueckers misses 27-foot three point pullup jump shot.');
  const ft = byText('Jessica Shepard makes free throw 1 of 2');
  assert.deepEqual(ft.free_throw, { n: 1, of: 2 });
  assert.equal(ft.description, 'Jessica Shepard makes free throw 1 of 2.');
  const blk = byText("Diamond Miller blocks Alanna Smith 's 2-foot driving layup");
  assert.equal(blk.blocked_by.name, 'Diamond Miller');
  assert.equal(blk.primary.name, 'Alanna Smith');
  assert.equal(blk.description, 'Diamond Miller blocks Alanna Smith’s 2-foot driving layup.');
  const tov = byText('Nell Angloma lost ball turnover (Jessica Shepard steals)');
  assert.equal(tov.stolen_by.name, 'Jessica Shepard');
  assert.equal(byText('Saniya Rivers shooting foul').foul_type, 'shooting');
  assert.equal(byText('Aaliyah Edwards offensive foul').foul_type, 'offensive');
  assert.equal(byText('Aaliyah Edwards offensive foul turnover').family, 'turnover');
  // Provider text that says only "two point shot" is less specific than its own type.
  assert.equal(byText('Arike Ogunbowale makes 4-foot two point shot').description, 'Arike Ogunbowale makes a 4-foot driving finger-roll layup.');
  assert.equal(byText('Ashlon Jackson enters the game for Diamond Miller').family, 'substitution');
});

test('truthful fallbacks when the source says less: never a bare "makes"/"misses", never an invented shot type', () => {
  const base = { id: 'x', sequenceNumber: '1', period: { number: 1 }, clock: { displayValue: '9:00' }, team: { id: '1' }, participants: [{ athlete: { id: '9' } }], homeScore: 2, awayScore: 0 };
  const names = { athleteName: () => 'Player A', teamName: () => 'Team' };
  assert.equal(semanticPlay({ ...base, type: { text: '' }, text: 'Player A makes', scoringPlay: true, shootingPlay: true, scoreValue: 2, pointsAttempted: 2 }, names).description, 'Player A scores 2 points.');
  assert.equal(semanticPlay({ ...base, type: { text: '' }, text: 'Player A misses', scoringPlay: false, shootingPlay: true, scoreValue: 3, pointsAttempted: 3 }, names).description, 'Player A misses a 3-point attempt.');
  assert.equal(semanticPlay({ ...base, type: { text: '' }, text: 'Player A misses', scoringPlay: false, shootingPlay: true }, names).description, 'Player A misses a field-goal attempt.');
  assert.equal(describePlay({ family: 'shot', primary: { name: 'Player A' }, made: true, points: 2, subtype: null, type_raw: null }, 'Player A makes').text, 'Player A scores 2 points.');
});

test('names keep their Unicode as the identity source publishes them (no stripping, no invented diacritics)', () => {
  const body = { ...FINAL, boxscore: { players: FINAL.boxscore.players.map((t) => ({ ...t, statistics: t.statistics.map((s) => ({ ...s, athletes: s.athletes.map((a) => (a.athlete.id === '5220147' ? { ...a, athlete: { ...a.athlete, displayName: 'Marième Badiane' } } : a)) })) })) } };
  const plays = semanticPlays(body.plays, resolversFromSummary(body));
  assert.equal(at(plays, 4, '8:33')[0].description, 'Marième Badiane makes a two-point jump shot.');
  assert.equal(at(usa, 4, '8:33')[0].description, 'Marieme Badiane makes a two-point jump shot.', 'the provider publishes no accent here; none is added');
});

test('order comes from sequenceNumber: a shuffled payload renders the same sequence', () => {
  const shuffled = [...FINAL.plays].reverse();
  const plays = semanticPlays(shuffled, resolversFromSummary(FINAL));
  assert.deepEqual(plays.map((p) => p.source_id), usa.map((p) => p.source_id));
  const broken = semanticPlays([{ ...FINAL.plays[10], homeScore: FINAL.plays[10].homeScore + 5, scoringPlay: true, scoreValue: 2 }], resolversFromSummary(FINAL));
  assert.ok(pbpQuality(broken).score_inconsistencies.length === 1, 'the consistency check flags a score that does not match the play');
});

test('both normalizers carry the semantics: international game center and WNBACast read the same description', () => {
  const intl = normalizePlays(FINAL, new Map([['17483', 'nt-usa'], ['104956', 'nt-france']]));
  const clark = intl.filter((p) => p.period === 4 && p.clock === '7:16');
  assert.deepEqual(clark.map((p) => p.text), ['Migna Toure personal foul.', 'Caitlin Clark makes a free throw.', 'Caitlin Clark makes a free throw.']);
  assert.equal(clark[1].text_raw, 'Caitlin Clark makes');
  assert.equal(clark[1].team_id, 'nt-usa');
  assert.ok(intl.some((p) => p.coordinate), 'published coordinates still pass through');
  const full = normalizeIntlSummary(FINAL, { competitionId: 'fiba-womens-world-cup-2026', eventId: '401917260' });
  assert.equal(full.plays.length, FINAL.plays.length);
  const w = normalizeSummary(WNBA);
  const ft = w.plays.find((p) => p.text_raw === 'Jessica Shepard makes free throw 1 of 2');
  assert.equal(ft.text, 'Jessica Shepard makes free throw 1 of 2.');
  assert.equal(ft.family, 'free_throw');
  assert.ok(w.plays.every((p) => !GENERIC_SHOT_TEXT.test(p.text || '')));
});

test('feed UI: compact filters and period selector, restrained emphasis, linked player names, score after the event', () => {
  const intl = normalizePlays(FINAL, new Map([['17483', 'nt-usa'], ['104956', 'nt-france']]));
  const html = String(pbpFeed(intl, { hrefFor: (p) => (p.primary?.id ? `/international/players/${p.primary.id}` : null) }));
  assert.match(html, /<select data-pbp-filter[^>]*>.*All plays.*Scoring.*Fouls.*Turnovers.*Rebounds/s);
  assert.match(html, /<select data-pbp-period[^>]*>.*All periods.*Q1.*Q4/s);
  assert.match(html, /data-pbp-latest hidden/);
  assert.match(html, /<a class="pbp-name" href="\/international\/players\/4433403">Caitlin Clark<\/a> makes a free throw\./);
  assert.doesNotMatch(html, /Caitlin Clark<\/a> makes<\/span>/);
  const leadChange = intl.find((p) => pbpEmphasis(p).includes('lead-change'));
  assert.ok(leadChange, 'a lead change is marked from the provider scores');
  assert.equal(pbpEmphasis({ scoring: false }).length, 0, 'non-scoring plays are not highlighted');
  const first = html.indexOf('data-seq=');
  assert.ok(first > 0);
});

test('stored finals and archives upgrade: plays normalized before pbe-pbp/1.0.0 get the same semantics from their own fields', async () => {
  const { upgradeNormalizedPlays } = await import('../workers/shared/pbp.js');
  // Shape of a wnba-api archive written before this version: normalized fields, old text, no semantics.
  const old = normalizeSummary(WNBA).plays.map(({ family, subtype, shot_value, free_throw, assist, stolen_by, blocked_by, rebound, turnover_type, foul_type, score_before, primary, description_source, text_raw, ...p }) => ({ ...p, text: text_raw }));
  assert.ok(!old[0].family);
  const box = normalizeSummary(WNBA).box;
  const up = upgradeNormalizedPlays(old, { names: new Map(box.players.map((r) => [String(r.athlete_id), r.name])) });
  const fresh = normalizeSummary(WNBA).plays;
  assert.deepEqual(up.map((p) => p.text), fresh.map((p) => p.text), 'archived plays render exactly as freshly normalized plays');
  assert.equal(upgradeNormalizedPlays(fresh), fresh, 'already-upgraded plays are left alone');
});
