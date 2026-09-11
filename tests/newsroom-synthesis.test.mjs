// Regression coverage for the WNBA newsroom synthesis generators (wnba-articles/2.0.0-preview).
//
// Offline: every record comes from tests/fixtures/newsroom-2026-09-11.json (captured from the public read
// API). Each test states the rule it protects. gate.js is asserted byte-identical to the reviewed copy;
// the new checks live in reconcile.js and run after it.
//
//   node --test tests/newsroom-synthesis.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { injuryArticles, transactionArticles, resultArticles, previewArticles, trendArticles, withSlug } from '../workers/wnba-news/src/articles.js';
import { buildDictionary } from '../workers/wnba-news/src/editorial.js';
import { reconcileArticle, lintProse, coLeaders, firstMarket } from '../workers/wnba-news/src/reconcile.js';
import { aan, sc, statAvg, countOf } from '../workers/wnba-news/src/prose.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'newsroom-2026-09-11.json'), 'utf8'));
const now = Date.parse(FX.as_of);
const api = async (p) => (p in FX.api ? FX.api[p] : null);
const add = (s, n) => { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + n)); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; };
const today = '20260911';
const sched = FX.api[`/v1/schedule?from=${add(today, -14)}&to=${add(today, 7)}`];
const longSched = FX.api[`/v1/schedule?from=${add(today, -50)}&to=${today}`];
const standings = FX.api['/v1/standings'];
const players = FX.api['/v1/players'];
const injuries = FX.api['/v1/injuries'].items;
const transactions = FX.api['/v1/transactions'].items;
const standingsById = new Map((standings?.groups || []).flatMap((g) => g.entries.map((e) => [e.team_id, { ...e, conference_name: g.name }])));
const games = sched.games;
const teamsList = [];
const seen = new Set();
for (const p of players.players) if (p.team && !seen.has(p.team.team_id)) { seen.add(p.team.team_id); teamsList.push(p.team); }
const dict = buildDictionary({ players: players.players.map((p) => ({ athlete_id: p.athlete_id, name: p.name, team_id: p.team_id })), teams: teamsList });
const regIds = new Set();
for (const k of Object.keys(FX.api)) if (/^\/v1\/schedule\?from=2026(05|06|07|08|09)/.test(k)) for (const g of FX.api[k]?.games || []) if (g.season?.type === 2) regIds.add(String(g.game_id));
const externalByPlayer = new Map();
for (const it of FX.wire) for (const e of it.entities || []) if (e.type === 'player') { if (!externalByPlayer.has(e.id)) externalByPlayer.set(e.id, []); externalByPlayer.get(e.id).push(it); }
const finalsByTeam = new Map();
for (const g of (longSched?.games || []).filter((x) => x.status?.state === 'post' && x.status?.completed).sort((a, b) => b.start_utc.localeCompare(a.start_utc))) for (const t of [g.home?.team_id, g.away?.team_id]) { if (!finalsByTeam.has(t)) finalsByTeam.set(t, []); finalsByTeam.get(t).push(g); }

const base = { api, injuries, externalByPlayer, schedule: games, standingsById, now, transactions, dict, teams: teamsList, props: null, season: FX.season, regIds, asOf: FX.as_of, finalsByTeam };
const one = async (fn, over) => { const xs = await fn({ ...base, ...over }); for (const a of xs) await withSlug(a); return xs; };
const REC = (a) => reconcileArticle(a, { season: FX.season, injuries });
const prose = (a) => [a.headline, a.deck, ...a.body, a.bettor_angle.summary, ...a.bettor_angle.supporting, ...a.bettor_angle.against, ...a.bettor_angle.unknown, ...(a.market_watch?.text || [])].join('\n');
const byPlayer = (xs, id) => xs.find((a) => String(a.lead_player_id) === id);

const stories = {};
test('fixture builds all six regression stories, and every one passes gate.js + reconcile', async () => {
  // the full feed is passed (team context must stay complete); only the subjects are limited
  const inj = await one(injuryArticles, { injurySubjects: new Set(['4281929', '4420318']) });
  stories.sabally = byPlayer(inj, '4281929');
  stories.magbegor = byPlayer(inj, '4420318');
  stories.brown = (await one(transactionArticles, { transactions: transactions.filter((t) => t.team?.team_id === '17' && t.date.startsWith('2026-08-29')) }))[0];
  stories.fever = (await one(resultArticles, { finals: games.filter((g) => String(g.game_id) === '401857181') }))[0];
  stories.preview = (await one(previewArticles, { upcoming: games.filter((g) => String(g.game_id) === '401857194') }))[0];
  stories.sky = (await one(trendArticles, { teams: teamsList.filter((t) => t.team_id === '19') }))[0];
  for (const [k, a] of Object.entries(stories)) {
    assert.ok(a, `missing story: ${k}`);
    assert.equal(a.gate.ok, true, `${k} gate: ${a.gate.failures.join(' | ')}`);
    const r = REC(a);
    assert.equal(r.ok, true, `${k} reconcile: ${r.failures.join(' | ')}`);
  }
});

// ---------------------------------------------------------------- 1. season-year integrity
test('a player with no current-season games is never presented as this season (Kalani Brown, 2025 Phoenix)', () => {
  const a = stories.brown;
  const t = prose(a);
  assert.match(t, /no 2026 regular-season games in the ESPN game log/);
  assert.match(t, /2025/);
  assert.match(t, /Phoenix Mercury/);
  assert.match(t, /2025 numbers, not 2026/);
  assert.doesNotMatch(t, /Kalani Brown[^.]*this season/);
  const pv = a.facts.provenance.find((x) => x.name === 'Kalani Brown');
  assert.equal(pv.year, 2025);
  assert.equal(pv.season_name, '2025 Regular Season'); // never the 2025 postseason
});
test('reconcile HOLDS prior-season stats dressed as this season', () => {
  const a = structuredClone(stories.brown);
  a.body[1] = 'Kalani Brown has played 29 games this season, averaging 5.1 points and 4 rebounds in 12.8 minutes.';
  const r = REC(a);
  assert.equal(r.ok, false);
  assert.match(r.failures.join(' '), /R1 season/);
});
test('current-season provenance must come from current-season games', () => {
  for (const pv of stories.sabally.facts.provenance) if (pv.year === FX.season) assert.equal(pv.season_name, '2026 Regular Season');
});

// ---------------------------------------------------------------- 2. absence context
test('a long-running absence is never described as minutes that "have to be absorbed" (Sabally)', () => {
  const a = stories.sabally;
  assert.equal(a.facts.absence.mode, 'long');
  assert.ok(a.facts.absence.games_since >= 3);
  const t = prose(a);
  assert.doesNotMatch(t, /have to be absorbed|has to be absorbed|have to replace|go somewhere/i);
  assert.match(a.headline, /already played \d+ games without her/);
  assert.match(t, /June 23/); // her last logged game
});
test('a fresh absence still states the minutes at stake, and says the redistribution is unobserved (Magbegor)', () => {
  const a = stories.magbegor;
  assert.equal(a.facts.absence.mode, 'fresh');
  const t = prose(a);
  assert.match(t, /no box score answers it yet|not yet established|not yet observed/i);
});
test('reconcile HOLDS "have to be absorbed" on a long absence', () => {
  const a = structuredClone(stories.sabally);
  a.body[0] = `${a.body[0]} Her 16.7 minutes a night have to be absorbed by the rest of the rotation.`;
  const r = REC(a);
  assert.equal(r.ok, false);
  assert.match(r.failures.join(' '), /R2 absence/);
});

// ---------------------------------------------------------------- 3. injury completeness
test('a preview names every current feed listing for both teams (Aces at Storm: 5 Storm + 2 Aces)', () => {
  const a = stories.preview;
  const t = prose(a);
  for (const tid of ['14', '17']) {
    const feed = injuries.filter((x) => String(x.team_id) === tid);
    assert.ok(feed.length > 0);
    for (const x of feed) assert.ok(t.includes(x.name), `preview omits ${x.name}`);
  }
  assert.ok(t.includes('Natisha Hiedeman')); // the listing the v1 preview dropped with slice(0, 4)
});
test('reconcile HOLDS a preview that omits one feed listing', () => {
  const a = structuredClone(stories.preview);
  a.body = a.body.map((p) => p.replaceAll('Natisha Hiedeman', 'a Storm guard'));
  a.bettor_angle.against = a.bettor_angle.against.map((p) => p.replaceAll('Natisha Hiedeman', 'a Storm guard'));
  a.bettor_angle.unknown = a.bettor_angle.unknown.map((p) => p.replaceAll('Natisha Hiedeman', 'a Storm guard'));
  const r = REC(a);
  assert.equal(r.ok, false);
  assert.match(r.failures.join(' '), /R3 injuries.*Natisha Hiedeman/s);
});

// ---------------------------------------------------------------- 4. co-leaders
test('materially equivalent lines are both named (Mitchell and Clark, 34 each)', () => {
  const a = stories.fever;
  const cl = coLeaders(a.facts.box_lines, a.facts.headline_stat);
  assert.equal(cl.length, 2);
  for (const p of cl) assert.ok(a.headline.includes(p.name), `headline omits ${p.name}`);
  assert.match(a.headline, /34 apiece/);
});
test('the co-leader rule is explicit: points within 2 of a 20+ game high', () => {
  const lines = [{ name: 'A', pts: 34 }, { name: 'B', pts: 34 }, { name: 'C', pts: 32 }, { name: 'D', pts: 31 }, { name: 'E', pts: 19 }];
  assert.deepEqual(coLeaders(lines, 'pts').map((x) => x.name), ['A', 'B', 'C']);
  assert.deepEqual(coLeaders([{ name: 'A', pts: 18 }, { name: 'B', pts: 17 }], 'pts'), []); // below the 20 floor
  assert.deepEqual(coLeaders([{ name: 'A', reb: 16 }, { name: 'B', reb: 15 }], 'reb').map((x) => x.name), ['A', 'B']);
});
test('reconcile HOLDS a headline that names one of two equivalent lines', () => {
  const a = structuredClone(stories.fever);
  a.headline = 'Kelsey Mitchell’s 34 points lead the Fever past the Sun, 111–91';
  const r = REC(a);
  assert.equal(r.ok, false);
  assert.match(r.failures.join(' '), /R4 co-leaders/);
});

// ---------------------------------------------------------------- 5. market-type alignment
test('a totals story leads its bettor analysis with the total (Sky unders)', () => {
  const a = stories.sky;
  assert.equal(a.market_type, 'total');
  assert.equal(firstMarket([a.bettor_angle.summary, ...a.bettor_angle.supporting].join(' ')), 'total');
});
test('"Over their last 10" is not betting vocabulary', () => {
  assert.equal(firstMarket('Over their last 10 completed games the Sky went 4-6 against the spread.'), 'spread');
  assert.equal(firstMarket('The games went under the total eight times.'), 'total');
});
test('reconcile HOLDS a totals story whose bettor read is about the spread', () => {
  const a = structuredClone(stories.sky);
  a.bettor_angle.summary = 'Against the spread the Sky covered in four of 10, so the lines oversold them.';
  a.bettor_angle.supporting = [];
  const r = REC(a);
  assert.equal(r.ok, false);
  assert.match(r.failures.join(' '), /R5 market/);
});

// ---------------------------------------------------------------- 6. rest semantics
test('rest is the source\'s rest_days, with the last-played date and no derived calendar gap', () => {
  const a = stories.preview;
  const t = prose(a);
  assert.match(t, /19 days of rest/);          // wnba-api rest_days for the Aces
  assert.match(t, /August 28/);                 // their last game, in New York time (a 02:00Z tip)
  assert.doesNotMatch(t, /days before (this |the )?tip/i);
  assert.doesNotMatch(t, /20 days of rest/);    // the ET calendar gap is 20; the source says 19
  assert.ok(a.facts.rest_days.includes(19));
});
test('reconcile HOLDS a rest figure that is not in the source', () => {
  const a = structuredClone(stories.preview);
  a.body = a.body.map((p) => p.replace('19 days of rest', '20 days of rest'));
  const r = REC(a);
  assert.equal(r.ok, false);
  assert.match(r.failures.join(' '), /R6 rest/);
});

// ---------------------------------------------------------------- 7. template grammar
test('aan: the article matches how the number is spoken', () => {
  for (const [n, want] of [['8.5', 'an'], ['8', 'an'], ['80', 'an'], ['86.4', 'an'], ['11', 'an'], ['11.5', 'an'], ['18', 'an'], ['18.7', 'an'], ['7', 'a'], ['7.5', 'a'], ['1.5', 'a'], ['110', 'a'], ['9', 'a'], ['12.5', 'a'], ['+0.1', 'a'], ['-8.9', 'a'], ['−8.9', 'a']]) assert.equal(aan(n), want, `aan(${n})`);
});
test('zero and singular constructions never reach prose', () => {
  assert.equal(statAvg(0, 'rebound'), 'no rebounds');
  assert.equal(statAvg(0.04, 'point'), 'no points');
  assert.equal(statAvg(1, 'point'), '1 point');
  assert.equal(statAvg(4.25, 'rebound'), '4.3 rebounds');
  assert.equal(countOf(0, 'player'), 'no players');
  assert.equal(countOf(1, 'start'), 'one start');
  assert.equal(countOf(5, 'player'), 'five players');
});
test('a score never renders as a hyphenated 3-digit pair (gate.js reads "-100" as a price)', () => {
  assert.equal(sc(108, 100), '108–100');
  assert.doesNotMatch(sc(108, 100), /\b[-+]\d{3,}\b/);
  assert.match('108-100', /[-+]\d{3,}/); // the shape the gate would reject
});
test('lintProse catches the template failures it is there for', () => {
  assert.match(lintProse('the Aces are 8.5-point favorites, a 8.5-point spread').join(' '), /article/);
  assert.match(lintProse('On the glass the Aces are 0 a game').join(' '), /zero construction/);
  assert.match(lintProse('Mitchell and Clark scored 34 and 34').join(' '), /duplicated number/);
  assert.match(lintProse('they come in 19 days before tip').join(' '), /derived rest wording/);
  assert.match(lintProse('Melbourne will return on September 17.').join(' '), /definitive availability/);
  assert.match(lintProse('Her return date is September 17.').join(' '), /return date without ESPN/);
  assert.deepEqual(lintProse('The Aces lay 8.5 on an 8.5-point consensus spread, 4, 3.7 and 3.7 minutes.'), []);
});
test('the corpus lint is clean across every regression story', () => {
  for (const [k, a] of Object.entries(stories)) for (const part of [a.headline, a.deck, ...a.body, a.bettor_angle.summary, ...a.bettor_angle.supporting, ...a.bettor_angle.against, ...a.bettor_angle.unknown]) {
    assert.deepEqual(lintProse(part), [], `${k}: ${part.slice(0, 80)}`);
  }
});

// ---------------------------------------------------------------- 8. ESPN return dates
test('every return date is ESPN\'s estimate, with the feed-update date, and never a confirmation', () => {
  for (const a of Object.values(stories)) {
    for (const part of [a.headline, a.deck, ...a.body, ...a.bettor_angle.against, ...a.bettor_angle.unknown]) {
      for (const s of part.split(/(?<=[.!?”])\s+/)) {
        if (!/return date|estimated return/i.test(s)) continue;
        assert.match(s, /ESPN/i, s);
        assert.match(s, /estimat/i, s);
        assert.match(s, /updat/i, s);
        assert.doesNotMatch(s, /\b(will|is expected to|are expected to) (return|play|be back|be available)\b/i, s);
      }
    }
  }
});
test('the preview labels a game-day return date as an estimate, not availability', () => {
  const t = prose(stories.preview);
  assert.match(t, /ESPN’s estimated return date of September 17, the day of this game/);
  assert.match(t, /estimates, not confirmations|not a confirmation/);
});

// ---------------------------------------------------------------- 9. ESPN comment text
test('ESPN injury-comment text never appears in generated prose', () => {
  for (const [k, a] of Object.entries(stories)) {
    const r = REC(a);
    assert.equal(r.failures.filter((f) => f.startsWith('R7')).length, 0, `${k}: ${r.failures.join(' | ')}`);
  }
  // the richest replacement reporting lives in these comments and is deliberately unused
  const note = injuries.find((x) => String(x.athlete_id) === '3917453')?.long_comment || '';
  assert.match(note, /Dolson/);
  assert.doesNotMatch(prose(stories.preview), /lean more heavily/i);
});
test('reconcile HOLDS prose that repeats ESPN comment text', () => {
  const a = structuredClone(stories.preview);
  const note = injuries.find((x) => String(x.athlete_id) === '3917453').long_comment;
  a.body.push(note.split('. ')[1]);
  const r = REC(a);
  assert.equal(r.ok, false);
  assert.match(r.failures.join(' '), /R7 comment text/);
});

// ---------------------------------------------------------------- 10. one structure, deterministically
test('one structure per class: the same inputs produce byte-identical prose', async () => {
  const again = (await one(previewArticles, { upcoming: games.filter((g) => String(g.game_id) === '401857194') }))[0];
  assert.deepEqual(again.body, stories.preview.body);
  assert.equal(again.headline, stories.preview.headline);
  assert.equal(again.structure, 0);
  assert.deepEqual(again.sections.map((s) => s.title), ['The read', 'Availability', 'The matchup', 'The market', 'The counter-case', 'What matters next']);
});

// ---------------------------------------------------------------- 11. historical runs borrow nothing from today
//
// There is no standings archive. A historical regeneration therefore has no standings for its date and must
// say less rather than substitute the present-day table — and no present-day injury feed either.
const histCtx = {
  ...base,
  historical: true,
  standingsById: new Map(),
  injuries: [],            // no archived feed for a past date
  asOf: '2026-08-18T16:00:00Z',
  api: async (p) => {
    const v = await api(p);
    if (!v) return v;
    if (/^\/v1\/teams\/\d+$/.test(p)) return { ...v, standing: null, availability: [] };
    if (/^\/v1\/matchups\//.test(p)) return { ...v, teams: (v.teams || []).map((t) => ({ ...t, standing: null, availability: [] })), market: null, market_summary: null };
    if (p === '/v1/standings') return { groups: [] };
    return v;
  }
};
const PRESENT_DAY_FIGURES = ['27-13', '8-32', '90.6', '86.5', '82.9', '88.2', '87.8', '93.8', '86.7', '89.7', 'No. 3 seed', 'No. 8 seed', 'games back'];
test('a historical story contains no present-day standings figure', async () => {
  const hp = (await one(previewArticles, { ...histCtx, upcoming: games.filter((g) => String(g.game_id) === '401857194') }))[0];
  const hr = (await one(resultArticles, { ...histCtx, finals: games.filter((g) => String(g.game_id) === '401857181') }))[0];
  const ht = (await one(trendArticles, { ...histCtx, teams: teamsList.filter((t) => t.team_id === '19') }))[0];
  for (const [k, a] of Object.entries({ preview: hp, result: hr, trend: ht })) {
    assert.ok(a, `no ${k} story`);
    const t = prose(a);
    for (const fig of PRESENT_DAY_FIGURES) assert.ok(!t.includes(fig), `${k} leaks a present-day standings figure: ${fig}`);
    assert.doesNotMatch(t, /points a game and allow|season average of|seed in the (Eastern|Western) Conference/i, `${k} states standings-derived context`);
    assert.equal(a.gate.ok, true, `${k} gate: ${a.gate.failures.join(' | ')}`);
    const r = reconcileArticle(a, { season: FX.season, injuries: [] });
    assert.equal(r.ok, true, `${k} reconcile: ${r.failures.join(' | ')}`);
  }
  // records computed from a team's own schedule stay: arithmetic over final scores, not the standings table
  assert.match(prose(hr), /team schedules through/);
});
test('a historical story never carries present-day injury-feed data', async () => {
  const hp = (await one(previewArticles, { ...histCtx, upcoming: games.filter((g) => String(g.game_id) === '401857194') }))[0];
  const t = prose(hp);
  for (const x of injuries) assert.ok(!t.includes(x.name), `historical preview names a present-day feed listing: ${x.name}`);
  assert.match(t, /injury feed is not archived/i);
  assert.deepEqual(hp.facts.injury_scope, []);
  assert.equal(hp.facts.injury_feed_unavailable, true);
});

// ---------------------------------------------------------------- 12. the gate itself is untouched
test('gate.js is byte-identical to the reviewed copy', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'workers', 'wnba-news', 'src', 'gate.js'));
  assert.equal(crypto.createHash('sha256').update(src).digest('hex'), '7e86475ba64e7ac3b7dbcc5386b616392582c5b17504899f59c903482f0bd7ff');
});
