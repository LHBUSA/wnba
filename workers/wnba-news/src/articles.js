// PropBetEdge WNBA Newsroom — in-house article engine.
//
// Every article is written by PropBetEdge from structured records served by
// wnba-api (ESPN injury feed, transactions, box scores, standings, schedules,
// stored Odds API snapshots) plus attributed publisher reports used as
// SOURCES, never as copy. Rules the generator obeys by construction:
//   * every number comes from a cited record (a grounding validator rejects
//     any article containing a number that is not in its evidence);
//   * the only quotation marks allowed wrap a publisher's own headline, with
//     the publisher named;
//   * no predictions, no picks, no invented return dates, no "sources say";
//   * a market sentence always names the source, the capture time and the
//     number of books, and never calls consensus a model.
// The output shape is the PBE Desk article: headline, deck, body, "Why it
// matters for bettors", "Market angle", context, evidence, related entities.

import { validateArticle } from './gate.js';
import { aan } from './prose.js';
// Synthesis generators (2.0.0-preview) replace the v1 list-style generators for these five kinds.
// The v1 functions stay exported as *V1 for comparison runs (scripts/newsroom-dryrun.mjs).
export { injuryDeep as injuryArticles, transactionDeep as transactionArticles, resultDeep as resultArticles, previewDeep as previewArticles, trendDeep as trendArticles } from './deep.js';

export const ARTICLE_VERSION = 'wnba-articles/1.2.0';

// ------------------------------------------------------------ formatting

const TZ = 'America/New_York';
const dShort = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }) : '');
const dLong = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' }) : '');
const tET = (iso) => (iso ? `${new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })} ET` : '');
const f1 = (v) => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '') : null);
const am = (v) => (v === null || v === undefined ? null : v > 0 ? `+${v}` : `${v}`);
const pts = (v) => (v === null || v === undefined ? null : v > 0 ? `+${v}` : `${v}`);
const BOOKS = { draftkings: 'DraftKings', fanduel: 'FanDuel', betmgm: 'BetMGM', betrivers: 'BetRivers', fanatics: 'Fanatics', bovada: 'Bovada', williamhill_us: 'Caesars', lowvig: 'LowVig', betonlineag: 'BetOnline', espnbet: 'ESPN BET' };
const book = (k) => BOOKS[k] || k;
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
const listJoin = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const nick = (t) => t?.short_name || t?.name || t?.abbr || 'team';
const full = (t) => t?.name || t?.short_name || 'team';
const poss = (name) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);

function teamForm(st, team) {
  if (!st) return null;
  const bits = [];
  if (st.last_ten) bits.push(`gone ${st.last_ten} over their last 10`);
  if (st.streak) { const k = Number(st.streak.slice(1)); bits.push(k === 1 ? `${/^W/.test(st.streak) ? 'won' : 'lost'} their last game` : `${/^W/.test(st.streak) ? 'won' : 'lost'} ${k} straight`); }
  const scoring = Number.isFinite(st.points_for_avg) && Number.isFinite(st.points_against_avg) ? ` They score ${f1(st.points_for_avg)} points a game and allow ${f1(st.points_against_avg)}.` : '';
  return bits.length ? `The ${nick(team)} have ${listJoin(bits)}.${scoring}` : scoring.trim() || null;
}


async function hashId(parts, n = 12) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, n);
}
const kebab = (s) => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72).replace(/-+$/, '');

// ------------------------------------------------------------ shared context helpers

function marketText(m, g, forTeamId) {
  if (!m || !g) return null;
  const home = g.home;
  const away = g.away;
  const fav = m.spread.home_line !== null ? (m.spread.home_line < 0 ? home : m.spread.home_line > 0 ? away : null) : null;
  const line = m.spread.home_line !== null ? Math.abs(m.spread.home_line) : null;
  const parts = [];
  if (fav && line !== null) parts.push(`${nick(fav)} are ${line}-point favorites`);
  else if (line === 0) parts.push('the spread is a pick’em');
  if (m.total.line !== null) parts.push(`the total sits at ${m.total.line}`);
  const ml = [];
  if (m.moneyline.away_best) ml.push(`${away.abbr} ${am(m.moneyline.away_best.price)} (${book(m.moneyline.away_best.book)})`);
  if (m.moneyline.home_best) ml.push(`${home.abbr} ${am(m.moneyline.home_best.price)} (${book(m.moneyline.home_best.book)})`);
  const s1 = parts.length ? `In the most recent PropBetEdge market capture for ${away.abbr} at ${home.abbr} (${dShort(g.start_utc)}), ${listJoin(parts)}.` : null;
  const s2 = ml.length ? `Best available moneylines: ${ml.join(', ')}.` : null;
  const s3 = `Prices are the best across ${m.books} books from The Odds API, captured ${dShort(m.captured_at)} at ${tET(m.captured_at)}${m.stale ? ' — older than 12 hours' : ''}.`;
  const s4 = m.moneyline.home_no_vig !== null ? `With the bookmaker margin removed, the market’s consensus makes the ${nick(home)} ${aan(f1(m.moneyline.home_no_vig * 100))} ${f1(m.moneyline.home_no_vig * 100)}% winner — a market benchmark, not a PropBetEdge projection.` : null;
  return { sentences: [s1, s2, s3, s4].filter(Boolean), facts: { market: m, fav_line: line, home_no_vig_pct: m.moneyline.home_no_vig !== null ? f1(m.moneyline.home_no_vig * 100) : null, game_date: g.start_utc } };
}

function standingText(st, conference) {
  if (!st) return null;
  const gb = st.games_behind && st.games_behind !== '-' ? `, ${st.games_behind} games back` : '';
  const seed = st.seed ? `the No. ${st.seed} seed in the ${conference || st.conference_name || 'league'}` : `in the ${conference || 'league'}`;
  return `${st.wins}-${st.losses}, ${seed}${gb}`;
}

function nextGame(schedule, teamId) {
  return (schedule || []).filter((g) => g.status?.state === 'pre' && (g.home?.team_id === teamId || g.away?.team_id === teamId)).sort((a, b) => a.start_utc.localeCompare(b.start_utc))[0] || null;
}

function gameEntity(g) {
  return g ? { type: 'game', id: g.game_id, name: `${g.away?.abbr} @ ${g.home?.abbr}`, start_utc: g.start_utc } : null;
}

const POLICY = { odds_hours_et: [8, 13, 18], props_window_h: 36, stale_h: 12, rotation_games: 5, trend_window: 10 };

const CAVEATS = {
  injury: {
    against: ['ESPN’s feed is a provider status, not the league’s official injury report, and it can change before tip.', 'Replacement minutes are read from recent box scores, not from a published lineup.'],
    unknown: ['The official game-day status and the starting lineup.', 'How the next posted player-prop lines treat the absence.'],
    markets: ['spread', 'total', 'player_props']
  },
  transaction: {
    against: ['Depth moves rarely move a game line on their own.'],
    unknown: ['How many minutes the incoming player receives — there is no box score for the new role yet.'],
    markets: ['player_props']
  },
  performance: {
    against: ['One game is a sample of one; the season average is the steadier baseline.'],
    unknown: ['Whether the next posted prop lines adjust to this result.'],
    markets: ['spread', 'total', 'player_props']
  },
  result: {
    against: ['One game is a sample of one.'],
    unknown: ['How the market prices both teams on the next slate.'],
    markets: ['spread', 'total']
  },
  preview: {
    against: ['Recent form and rest describe the past; neither is a projection.'],
    unknown: ['Official availability and starting lineups, published closer to tip.', 'Player-prop lines until the capture window opens.'],
    markets: ['spread', 'moneyline', 'total', 'player_props']
  },
  trend: {
    against: ['A trend measured against one sportsbook’s lines over a small window is fragile.'],
    unknown: ['Whether the market has already adjusted; current prices are on the game pages.'],
    markets: ['spread', 'total']
  },
  props: {
    against: ['Recent averages ignore opponent, pace and minutes changes that the line already prices.'],
    unknown: ['Final availability and minutes.'],
    markets: ['player_points']
  },
  market: {
    against: ['A move between two captures does not identify its cause.'],
    unknown: ['Whether the move continues before tip.'],
    markets: ['spread', 'total']
  }
};

const MIN_WORDS = { injury: 110, preview: 110, performance: 100, result: 90, transaction: 80, trend: 60, props: 60, market: 50 };

function finalize(a) {
  const c = CAVEATS[a.kind] || CAVEATS.result;
  a.facts = { ...(a.facts || {}), policy: POLICY };
  a.bettor_angle = {
    summary: a.bettor[0],
    supporting: a.bettor.slice(1),
    against: a.against || c.against,
    unknown: a.unknown || c.unknown,
    markets: a.markets || c.markets,
    odds_status: a.market_angle?.market ? 'snapshot' : a.market_angle?.line ? 'reference_line' : 'unavailable',
    model_status: 'unavailable'
  };
  a.market_watch = a.market_angle;
  delete a.bettor;
  delete a.market_angle;
  a.gate = validateArticle(a, { minWords: MIN_WORDS[a.kind] ?? 100 });
  a.status = a.gate.ok ? 'published' : 'held';
  return a;
}

// ------------------------------------------------------------ editorial structures
//
// Each story kind has several article shapes — different leads, section order and sentence construction —
// written over the SAME grounded facts. The shape is picked deterministically from the story's identity, so
// a story keeps its shape across re-renders and a slate of similar stories does not read like one template.
// No shape adds a fact: every sentence in every shape is built from the same records the gate checks.

export const VARIANTS = { injury: 3, transaction: 3, performance: 3, result: 3, preview: 3, trend: 2, props: 2, market: 2 };
let VARIANT_OVERRIDE = null;
/** Test hook (scripts/newsroom-dryrun.mjs --all): force one structure for every story. */
export function __setVariantOverride(v) { VARIANT_OVERRIDE = v; }
function structureOf(kind, key) {
  const n = VARIANTS[kind] || 1;
  if (VARIANT_OVERRIDE !== null) return VARIANT_OVERRIDE % n;
  let h = 2166136261;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h % n;
}
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// `aan` now comes from prose.js (it also handles signed numbers: "a −8.9", spoken "a minus …").

// ------------------------------------------------------------ 1. availability / injury

export async function injuryArticlesV1({ api, injuries, externalByPlayer, schedule, standingsById, now }) {
  const out = [];
  const serious = (i) => /out/i.test(i.status || '') || /day/i.test(i.status || '');
  // One article per player per status episode, newest feed updates first; cap to keep quality.
  const recent = (injuries || []).filter((i) => i.athlete_id && serious(i) && Date.parse(i.source_updated_at) > now - 14 * 86400e3)
    .sort((a, b) => String(b.source_updated_at).localeCompare(String(a.source_updated_at))).slice(0, 12);
  for (const inj of recent) {
    const [pRes, tRes] = await Promise.all([api(`/v1/players/${inj.athlete_id}`), api(`/v1/teams/${inj.team_id}`)]);
    if (!pRes || !tRes) continue;
    const p = pRes.player;
    const team = tRes.team;
    const rot = tRes.rotation;
    const me = rot?.rows?.find((r) => r.athlete_id === inj.athlete_id) || null;
    const season = pRes.recent?.season;
    const l10 = pRes.recent?.last10;
    if (!season || season.games < 3) continue; // not enough real production to frame
    const reports = (externalByPlayer.get(inj.athlete_id) || []).filter((r) => r.story_type === 'injury').slice(0, 3);
    const ofs = /OFS/i.test(inj.fantasy_status || '') || /season/i.test(inj.status || '');
    const dtd = !ofs && /day/i.test(inj.status);
    const role = me ? (me.role === 'starter' ? 'starter' : me.role === 'rotation' ? 'rotation player' : 'reserve') : 'reserve';
    const st = standingsById.get(team.team_id) || tRes.standing;
    const ng = nextGame(tRes.schedule, team.team_id);
    const opp = ng ? (ng.home.team_id === team.team_id ? ng.away : ng.home) : null;
    const where = ng ? (ng.home.team_id === team.team_id ? 'host' : 'visit') : null;
    const part = [inj.side, inj.body_part].filter(Boolean).join(' ').toLowerCase();
    const v = structureOf('injury', `${inj.athlete_id}|${inj.status}|${inj.source_updated_at}`);
    const minutes = f1(me && me.appearances > 0 ? me.min : season.min); // 0 observed minutes (no appearances) is not her role
    const rec = st ? ` (${st.wins}-${st.losses})` : '';

    const headline = [
      ofs ? `${p.name} out for the season, per ESPN’s injury feed: what the ${nick(team)} lose`
        : dtd ? `${p.name} day-to-day for the ${nick(team)}: the minutes at stake` : `${p.name} listed out for the ${nick(team)}: what changes`,
      ofs ? `The ${nick(team)} lose ${p.name} for the season, per ESPN’s injury feed`
        : dtd ? `${p.name} listed day-to-day: what the ${nick(team)} stand to lose` : `${p.name} listed out, and the ${nick(team)} lose ${minutes} minutes a night`,
      ofs ? `ESPN’s injury feed lists ${p.name} out for the season: where the ${nick(team)} go from here`
        : dtd ? `The ${nick(team)} list ${p.name} as day-to-day${opp ? ` before the ${nick(opp)}` : ''}`
          : `Without ${p.name}: the ${nick(team)} rotation after ESPN’s listing`
    ][v];
    const deck = [
      `The ${full(team)}${rec} are without a ${role} who has averaged ${f1(season.pts)} points in ${f1(season.min)} minutes across ${season.games} games this season.`,
      `${p.name} has averaged ${f1(season.pts)} points and ${f1(season.reb)} rebounds in ${f1(season.min)} minutes over ${season.games} games — production the ${full(team)}${rec} now have to replace.`,
      `${ng ? `The ${full(team)}${rec} ${where} the ${full(opp)} next, on ${dShort(ng.start_utc)}` : `The ${full(team)}${rec} have no game on the published schedule`}, and ESPN’s feed lists their ${role} ${p.name} as ${inj.status}.`
    ][v];

    const sStatus = [
      `ESPN’s WNBA injury feed lists ${p.name} as ${inj.status}${part ? ` with a ${part} injury` : ''}, last updated ${dShort(inj.source_updated_at)} at ${tET(inj.source_updated_at)}.${ofs ? ' The feed marks her out for the rest of the season.' : ''} This is ESPN’s status, not the league’s official injury report.`,
      `${p.name} is listed as ${inj.status}${part ? ` (${part})` : ''} on ESPN’s WNBA injury feed, which last updated her status ${dShort(inj.source_updated_at)} at ${tET(inj.source_updated_at)}.${ofs ? ' The listing runs through the rest of the season.' : ''} The feed is a provider status rather than the league’s official report.`,
      `As of ${dShort(inj.source_updated_at)} at ${tET(inj.source_updated_at)}, ESPN’s WNBA injury feed carries ${p.name} as ${inj.status}${part ? ` with a ${part} injury` : ''}.${ofs ? ' It marks her out for the remainder of the season.' : ''} That is ESPN’s listing, not the league’s official injury report.`
    ][v];
    const sReports = reports.slice(0, 2).map((r) => [
      `${r.source_name} reported it on ${dShort(r.published_at)} under the headline “${r.headline}”.`,
      `${r.source_name} covered it on ${dShort(r.published_at)}: “${r.headline}”.`,
      `The report from ${r.source_name}, published ${dShort(r.published_at)}, ran as “${r.headline}”.`
    ][v]);
    const trendTail = l10 && l10.games >= 5 ? [
      ` Over her last ${l10.games} games she averaged ${f1(l10.pts)} points and ${f1(l10.reb)} rebounds in ${f1(l10.min)} minutes.`,
      ` The recent sample is ${l10.games} games at ${f1(l10.pts)} points and ${f1(l10.reb)} rebounds in ${f1(l10.min)} minutes.`,
      ` Her last ${l10.games}: ${f1(l10.pts)} points, ${f1(l10.reb)} rebounds, ${f1(l10.min)} minutes.`
    ][v] : '';
    const sProduction = [
      `${p.name} has played ${season.games} games this season, averaging ${f1(season.pts)} points, ${f1(season.reb)} rebounds and ${f1(season.ast)} assists in ${f1(season.min)} minutes.`,
      `Her season: ${season.games} games, ${f1(season.pts)} points, ${f1(season.reb)} rebounds and ${f1(season.ast)} assists in ${f1(season.min)} minutes a night.`,
      `Across ${season.games} games she has put up ${f1(season.pts)} points, ${f1(season.reb)} rebounds and ${f1(season.ast)} assists, playing ${f1(season.min)} minutes.`
    ][v] + trendTail;
    const sRotation = me && rot?.sample && !(me.appearances > 0)
      ? `She has not appeared in the ${poss(nick(team))} last ${rot.sample} games, the observed rotation window.`
      : me && rot?.sample ? [
      `In the ${poss(nick(team))} last ${rot.sample} games she started ${me.starts} and averaged ${f1(me.min)} minutes when she played.`,
      `She started ${me.starts} of the ${poss(nick(team))} last ${rot.sample} games and averaged ${f1(me.min)} minutes in the games she played.`,
      `In the last ${rot.sample} ${nick(team)} games — the observed rotation window — she drew ${me.starts} starts and ${f1(me.min)} minutes a game when active.`
    ][v] : null;
    const sTeam = st ? [
      `The ${nick(team)} are ${standingText(st, st.conference_name)}.${ng ? ` They ${where} the ${full(opp)} on ${dLong(ng.start_utc)}.` : ''}`,
      `${ng ? `Next for the ${nick(team)}: ${where === 'host' ? `the ${full(opp)} visit on ${dLong(ng.start_utc)}` : `a trip to face the ${full(opp)} on ${dLong(ng.start_utc)}`}. ` : ''}They sit ${standingText(st, st.conference_name)}.`,
      ng ? `The ${full(team)}, ${standingText(st, st.conference_name)}, go into ${dLong(ng.start_utc)} against the ${full(opp)} without ${p.name}.` : `The ${full(team)} are ${standingText(st, st.conference_name)} and will be without ${p.name}.`
    ][v] : null;
    const tf = teamForm(st, team);
    const body = [
      [sStatus, ...sReports, sProduction, sRotation, sTeam, tf],
      [sProduction, sRotation, sStatus, ...sReports, sTeam, tf],
      [sTeam, sStatus, sProduction, sRotation, ...sReports, tf]
    ][v].filter(Boolean);

    const outIds = new Set((tRes.availability || []).map((x) => x.athlete_id));
    const heirs = (rot?.rows || []).filter((r) => r.athlete_id !== inj.athlete_id && !outIds.has(r.athlete_id) && r.appearances > 0).slice(0, 3);
    const heirList = listJoin(heirs.map((h) => `${h.name} (${f1(h.min)} min, ${f1(h.pts)} pts)`)) || 'not yet established';
    const bettor = [[
      `${p.name}’s ${minutes} minutes a night have to be absorbed by the rest of the rotation. The healthy players with the heaviest observed minutes over the last ${rot?.sample || 0} games are ${heirList}.`,
      `Replacing ${minutes} minutes a night is the betting question here. Over the last ${rot?.sample || 0} games the healthy players logging the most minutes are ${heirList}.`,
      `The ${minutes} minutes ${p.name} leaves behind land somewhere in the rotation; the healthy minutes leaders over the last ${rot?.sample || 0} games are ${heirList}.`
    ][v]];
    const otherOut = (tRes.availability || []).filter((x) => x.athlete_id !== inj.athlete_id);
    if (otherOut.length) bettor.push(`She is not the only absence: the feed also lists ${listJoin(otherOut.slice(0, 4).map((x) => `${x.name} (${x.status})`))}.`);
    bettor.push('Player-prop lines for the next game are captured only inside 36 hours of tip; that is where a minutes shift shows up first.');

    const mt = ng?.market ? marketText(ng.market, ng, team.team_id) : null;
    const market_angle = mt
      ? { text: [...mt.sentences, `This capture was taken ${Date.parse(ng.market.captured_at) > Date.parse(inj.source_updated_at) ? 'after' : 'before'} the injury feed’s last update (${dShort(inj.source_updated_at)}, ${tET(inj.source_updated_at)}).`], market: ng.market, game_id: ng.game_id }
      : { text: [ng ? `No market snapshot exists yet for the ${poss(nick(team))} next game (${dShort(ng.start_utc)}). Snapshots run at 8:00 a.m., 1:00 p.m. and 6:00 p.m. ET.` : 'No upcoming game is on the published schedule.'], market: null, game_id: ng?.game_id || null };

    const id = await hashId(['injury', inj.athlete_id, inj.status, inj.source_updated_at]);
    out.push(finalize({
      id,
      kind: 'injury',
      category: 'Injuries',
      structure: v,
      headline,
      deck,
      body,
      bettor,
      market_angle,
      lead_team_id: team.team_id,
      lead_player_id: p.athlete_id,
      primary_subject: p.name,
      published_at: inj.source_updated_at,
      context: { player: { athlete_id: p.athlete_id, name: p.name, position: p.position_name, season, last10: l10, photo: pRes.photo }, team: { team_id: team.team_id, name: team.name, standing: st }, next_game: ng ? { game_id: ng.game_id, start_utc: ng.start_utc, home: ng.home, away: ng.away } : null },
      entities: [{ type: 'player', id: p.athlete_id, name: p.name }, { type: 'team', id: team.team_id, name: team.name }, ...(opp ? [{ type: 'team', id: opp.team_id, name: opp.name }] : []), ...(ng ? [gameEntity(ng)] : []), ...heirs.map((h) => ({ type: 'player', id: h.athlete_id, name: h.name }))],
      facts: { injury: inj, season, last10: l10, rotation_me: me, heirs, standing: st, next_game: ng ? { start_utc: ng.start_utc } : null, market: mt?.facts || null, other_out: otherOut.map((x) => ({ name: x.name, status: x.status })) },
      evidence: [
        { kind: 'record', source: 'ESPN WNBA injury feed', url: 'https://www.espn.com/wnba/injuries', captured_at: new Date(now).toISOString(), record: { athlete_id: inj.athlete_id, status: inj.status, body_part: inj.body_part, fantasy_status: inj.fantasy_status, source_updated_at: inj.source_updated_at, note: inj.short_comment } },
        ...reports.map((r) => ({ kind: 'publisher_report', source: r.source_name, publisher: r.source_name, headline: r.headline, url: r.canonical_url, published_at: r.published_at, captured_at: r.first_captured_at })),
        { kind: 'record', source: 'ESPN game log (season and last-10 averages)', url: `https://www.espn.com/wnba/player/gamelog/_/id/${p.athlete_id}`, record: { season, last10: l10 } },
        ...(rot?.games?.length ? [{ kind: 'record', source: `ESPN box scores, last ${rot.sample} ${nick(team)} games (observed rotation)`, url: `https://www.espn.com/wnba/team/schedule/_/id/${team.team_id}`, record: { games: rot.games } }] : []),
        ...(ng?.market ? [{ kind: 'market', source: 'The Odds API (stored PropBetEdge snapshot)', captured_at: ng.market.captured_at, record: { books: ng.market.books, spread: ng.market.spread.home_line, total: ng.market.total.line } }] : [])
      ]
    }));
  }
  return out;
}

// ------------------------------------------------------------ 2. transactions

const VERB = [[/^Signed\b/, 'sign'], [/^Re-signed\b/, 're-sign'], [/^Waived\b/, 'waive'], [/^Released\b/, 'release'], [/^Acquired\b/, 'acquire'], [/^Activated\b/, 'activate'], [/^Placed\b/, 'place'], [/^Traded\b/, 'trade'], [/^Claimed\b/, 'claim'], [/^Suspended\b/, 'suspend'], [/^Exercised\b/, 'exercise'], [/^Extended\b/, 'extend']];
function presentTense(sentence) {
  const s = sentence.trim().replace(/\.$/, '');
  for (const [re, v] of VERB) if (re.test(s)) return s.replace(re, v);
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export async function transactionArticlesV1({ api, transactions, schedule, dict, now }) {
  const byTeamDay = new Map();
  for (const t of transactions || []) {
    if (!t.team?.team_id || !t.date || Date.parse(t.date) < now - 14 * 86400e3) continue;
    const k = `${t.team.team_id}|${t.date.slice(0, 10)}`;
    if (!byTeamDay.has(k)) byTeamDay.set(k, { team: t.team, date: t.date, moves: [] });
    byTeamDay.get(k).moves.push(t.description);
  }
  const out = [];
  for (const g of byTeamDay.values()) {
    const clauses = g.moves.flatMap((m) => m.split(/(?<=\.)\s+/)).map((x) => x.trim()).filter(Boolean);
    const tRes = await api(`/v1/teams/${g.team.team_id}`);
    const team = tRes?.team || g.team;
    const v = structureOf('transaction', `${team.team_id}|${g.date.slice(0, 10)}|${g.moves.join('|')}`);
    const named = [];
    for (const [nm, p] of dict.playerByName) {
      if (clauses.some((c) => c.toLowerCase().includes(nm))) named.push(p);
    }
    const moveText = listJoin(clauses.slice(0, 2).map(presentTense));
    const headline = [`${nick(team)} ${moveText}`, `${full(team)} ${moveText}`, `Roster move: the ${nick(team)} ${moveText}`][v].replace(/\s+/g, ' ');
    const outList = (tRes?.availability || []);
    const injTail = outList.length ? `${outList.length} ${nick(team)} player${outList.length === 1 ? '' : 's'} on the injury feed` : '';
    const deck = [
      `A roster move dated ${dShort(g.date)} from ESPN’s WNBA transactions log${injTail ? `, with ${injTail}` : ''}.`,
      `ESPN’s WNBA transactions log dates the ${nick(team)} move ${dShort(g.date)}${injTail ? `; ${injTail}` : ''}.`,
      `${injTail ? `With ${injTail}, the` : 'The'} ${full(team)} made a roster move on ${dShort(g.date)}, per ESPN’s transactions log.`
    ][v];
    const sMoves = [
      `Per ESPN’s WNBA transactions log, the ${full(team)} made ${clauses.length === 1 ? 'this move' : 'these moves'} on ${dShort(g.date)}: ${clauses.join(' ')}`,
      `ESPN’s WNBA transactions log records ${clauses.length === 1 ? 'the move' : 'the moves'} for the ${full(team)} on ${dShort(g.date)}: ${clauses.join(' ')}`,
      `The entry in ESPN’s WNBA transactions log, dated ${dShort(g.date)}, reads: ${clauses.join(' ')}`
    ][v];
    const onRoster = named.filter((p) => (tRes?.roster || []).some((r) => r.athlete_id === p.athlete_id));
    const profiles = [];
    const sProfiles = [];
    for (const p of onRoster.slice(0, 2)) {
      const pr = await api(`/v1/players/${p.athlete_id}`);
      const s = pr?.recent?.season;
      if (s?.games) {
        profiles.push({ athlete_id: p.athlete_id, name: p.name, season: s });
        sProfiles.push([
          `${p.name} has logged ${s.games} games with minutes this season in the source game log, averaging ${f1(s.pts)} points in ${f1(s.min)} minutes.`,
          `In the source game log, ${p.name} has ${s.games} games with minutes this season at ${f1(s.pts)} points in ${f1(s.min)} minutes.`,
          `${p.name}’s season so far, per the source game log: ${s.games} games with minutes, ${f1(s.pts)} points and ${f1(s.min)} minutes a game.`
        ][v]);
      } else {
        sProfiles.push(`${p.name} is on the current ${nick(team)} roster; the source game log shows no minutes for her this season.`);
      }
    }
    const sInjured = outList.length ? [
      `The ${nick(team)} currently list ${listJoin(outList.slice(0, 5).map((x) => `${x.name} (${x.status})`))} on ESPN’s injury feed.`,
      `On ESPN’s injury feed the ${nick(team)} carry ${listJoin(outList.slice(0, 5).map((x) => `${x.name} (${x.status})`))}.`,
      `ESPN’s injury feed has ${listJoin(outList.slice(0, 5).map((x) => `${x.name} (${x.status})`))} for the ${nick(team)}.`
    ][v] : null;
    const st = tRes?.standing;
    const sStanding = st ? `${['They are', 'The team is', 'The ' + nick(team) + ' are'][v]} ${standingText(st, st.conference_name)}.` : null;
    const tf2 = teamForm(st, team);
    const core = (tRes?.rotation?.rows || []).filter((r) => r.appearances > 0).slice(0, 3);
    const sCore = core.length ? [
      `The heaviest minutes in their last ${tRes.rotation.sample} games belong to ${listJoin(core.map((r) => `${r.name} (${f1(r.min)})`))}.`,
      `Over the last ${tRes.rotation.sample} games the minutes have run through ${listJoin(core.map((r) => `${r.name} (${f1(r.min)})`))}.`,
      `The rotation’s core over the last ${tRes.rotation.sample} games: ${listJoin(core.map((r) => `${r.name} (${f1(r.min)} minutes)`))}.`
    ][v] : null;
    const body = [
      [sMoves, ...sProfiles, sInjured, sStanding, tf2, sCore],
      [sMoves, sInjured, sCore, ...sProfiles, sStanding, tf2],
      [sMoves, sStanding, tf2, ...sProfiles, sInjured, sCore]
    ][v].filter(Boolean);
    const ng = nextGame(tRes?.schedule, team.team_id);
    const bettor = [
      outList.length ? `With ${outList.length} player${outList.length === 1 ? '' : 's'} listed on the injury feed, depth signings matter less for the headline stars than for the back of the rotation — where minutes and prop eligibility change.` : 'The move changes depth rather than the top of the rotation; its betting relevance runs through minutes at the back of the bench.',
      ng ? `Next up: ${ng.away.abbr} at ${ng.home.abbr} on ${dLong(ng.start_utc)}.` : 'No upcoming game is on the published schedule.'
    ];
    const mt = ng?.market ? marketText(ng.market, ng, team.team_id) : null;
    const market_angle = mt ? { text: mt.sentences, market: ng.market, game_id: ng.game_id } : { text: [ng ? `No market snapshot exists yet for that game. Snapshots run at 8:00 a.m., 1:00 p.m. and 6:00 p.m. ET.` : ''].filter(Boolean), market: null, game_id: ng?.game_id || null };
    const id = await hashId(['transaction', team.team_id, g.date.slice(0, 10), g.moves.join('|')]);
    out.push(finalize({
      id, kind: 'transaction', category: 'Transactions', structure: v, headline, deck, body, bettor, market_angle,
      lead_team_id: team.team_id, lead_player_id: onRoster[0]?.athlete_id || null, primary_subject: nick(team), published_at: g.date,
      context: { team: { team_id: team.team_id, name: team.name, standing: st }, players: profiles, next_game: ng ? { game_id: ng.game_id, start_utc: ng.start_utc, home: ng.home, away: ng.away } : null },
      entities: [{ type: 'team', id: team.team_id, name: team.name }, ...onRoster.map((p) => ({ type: 'player', id: p.athlete_id, name: p.name })), ...(ng ? [gameEntity(ng)] : [])],
      facts: { moves: g.moves, profiles, out: outList.map((x) => ({ name: x.name, status: x.status })), standing: st, market: mt?.facts || null, out_count: outList.length, core: (tRes?.rotation?.rows || []).slice(0, 3), rotation_sample: tRes?.rotation?.sample },
      evidence: [{ kind: 'record', source: 'ESPN WNBA transactions log', url: 'https://www.espn.com/wnba/transactions', captured_at: new Date(now).toISOString(), record: { team: team.abbr, date: g.date, moves: g.moves } }, ...profiles.map((p) => ({ kind: 'record', source: `ESPN game log — ${p.name}`, url: `https://www.espn.com/wnba/player/gamelog/_/id/${p.athlete_id}`, record: p.season }))]
    }));
  }
  return out;
}

// ------------------------------------------------------------ 3. results / performances

const isTD = (r) => (r.pts ?? 0) >= 10 && (r.reb ?? 0) >= 10 && (r.ast ?? 0) >= 10;
const notable = (r) => (r.pts ?? 0) >= 28 || (r.reb ?? 0) >= 15 || (r.ast ?? 0) >= 12 || isTD(r);

export async function resultArticlesV1({ api, finals, standingsById, now }) {
  const out = [];
  for (const g0 of finals) {
    const live = await api(`/v1/games/${g0.game_id}/live`);
    const gm = await api(`/v1/games/${g0.game_id}`);
    if (!live || !gm) continue;
    const g = live.game;
    if (g.status?.state !== 'post' || !g.status.completed) continue;
    const box = live.box.players.filter((r) => !r.dnp && r.min);
    const stars = box.filter(notable).sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0));
    const winner = g.home.winner ? g.home : g.away;
    const loser = g.home.winner ? g.away : g.home;
    const margin = winner.score - loser.score;
    const ot = g.home.linescores.length > 4;
    const lead = live.derived?.lead;
    const loserSide = loser === g.home ? 'home' : 'away';
    const comeback = (lead?.largest_lead?.[loserSide]?.margin ?? 0) >= 12;
    const pc = gm.pickcenter?.[0] || null;
    if (!stars.length && !ot && !comeback && !pc) continue;
    const top = stars[0] || [...box].sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0))[0];
    const topTeam = top.team_id === g.home.team_id ? g.home : g.away;
    const kind = stars.length ? 'performance' : 'result';
    const v = structureOf(kind, `result|${g.game_id}`);
    const score = `${winner.score}-${loser.score}`;

    // Market result against the line ESPN relays (and our own pre-tip capture when one exists).
    let ats = null;
    if (pc && pc.spread !== null) {
      const homeMargin = g.home.score - g.away.score;
      const cover = homeMargin + pc.spread; // spread is quoted for the home side
      ats = { provider: pc.provider, home_spread: pc.spread, over_under: pc.over_under, home_margin: homeMargin, result: cover > 0 ? 'home_cover' : cover < 0 ? 'away_cover' : 'push', total_points: g.home.score + g.away.score, total_result: pc.over_under === null ? null : g.home.score + g.away.score > pc.over_under ? 'over' : g.home.score + g.away.score < pc.over_under ? 'under' : 'push' };
    }
    const favTeam = ats ? (ats.home_spread < 0 ? g.home : g.away) : null;
    const coverTeam = ats ? (ats.result === 'home_cover' ? g.home : ats.result === 'away_cover' ? g.away : null) : null;

    const statLine = (r) => {
      const bits = [`${r.pts} points`];
      if ((r.reb ?? 0) >= 8) bits.push(`${r.reb} rebounds`);
      if ((r.ast ?? 0) >= 6) bits.push(`${r.ast} assists`);
      return `${listJoin(bits)} on ${r.fgm}-of-${r.fga} shooting${r.fg3a ? ` (${r.fg3m}-of-${r.fg3a} from three)` : ''} in ${r.min} minutes`;
    };
    const keyStat = (r) => (isTD(r) ? { label: 'triple-double', key: null } : (r.pts ?? 0) >= 28 ? { label: `${r.pts} points`, key: 'pts', v: r.pts } : (r.reb ?? 0) >= 15 ? { label: `${r.pts} points and ${r.reb} rebounds`, key: 'reb', v: r.reb } : { label: `${r.ast} assists`, key: 'ast', v: r.ast });
    const ks = stars.length ? keyStat(top) : null;
    const verbOf = (r, k) => (k.key === 'pts' ? `scores ${r.pts}` : k.key === 'reb' ? `posts ${r.pts} points and ${r.reb} rebounds` : `hands out ${r.ast} assists`);
    let headline;
    if (stars.length && ks.key === null) {
      headline = topTeam === winner
        ? [`${top.name} posts a triple-double as the ${nick(winner)} beat the ${nick(loser)} ${score}`, `The ${nick(winner)} beat the ${nick(loser)} ${score} behind a ${top.name} triple-double`, `A ${top.name} triple-double carries the ${nick(winner)} past the ${nick(loser)}, ${score}`][v]
        : [`${top.name} posts a triple-double as the ${nick(winner)} beat the ${nick(loser)} ${score}`, `${top.name} posts a triple-double, but the ${nick(winner)} beat the ${nick(loser)} ${score}`, `The ${nick(winner)} beat the ${nick(loser)} ${score} despite a ${top.name} triple-double`][v];
    } else if (stars.length) {
      headline = topTeam === winner
        ? [`${poss(top.name)} ${ks.label} lead the ${nick(winner)} past the ${nick(loser)}, ${score}`, `The ${nick(winner)} beat the ${nick(loser)} ${score} behind ${poss(top.name)} ${ks.label}`, `${top.name} ${verbOf(top, ks)} as the ${nick(winner)} top the ${nick(loser)}, ${score}`][v]
        : [`${poss(top.name)} ${ks.label} not enough as the ${nick(winner)} beat the ${nick(loser)}, ${score}`, `The ${nick(winner)} beat the ${nick(loser)} ${score} despite ${poss(top.name)} ${ks.label}`, `${poss(top.name)} ${ks.label} come in ${aan(margin)} ${margin}-point loss to the ${nick(winner)}`][v];
    } else {
      headline = [
        `${nick(winner)} ${ot ? 'survive overtime against' : comeback ? 'rally past' : 'beat'} the ${nick(loser)}, ${score}`,
        `The ${full(winner)} ${ot ? 'win in overtime over' : comeback ? 'come back to beat' : 'beat'} the ${full(loser)}, ${score}`,
        `${ot ? 'Overtime' : comeback ? 'Comeback' : 'Final'} — the ${nick(winner)} ${winner.score}, the ${nick(loser)} ${loser.score}`
      ][v];
    }
    const deckBits = [];
    if (ats && coverTeam) deckBits.push(`the ${nick(coverTeam)} covered ${poss(pc.provider)} ${Math.abs(ats.home_spread)}-point line`);
    if (ats?.total_result && ats.total_result !== 'push') deckBits.push(`the game ${ats.total_result === 'over' ? 'cleared' : 'stayed under'} the ${ats.over_under} total`);
    const deckTail = lead ? (lead.lead_changes ? ` It had ${lead.lead_changes} lead change${lead.lead_changes === 1 ? '' : 's'}.` : ' There were no lead changes.') : '';
    const deck = [
      deckBits.length ? `${cap(listJoin(deckBits))}.${deckTail}` : `Final from ${dLong(g.start_utc)}.${deckTail}`,
      `Final from ${dLong(g.start_utc)}: the ${nick(winner)} ${winner.score}, the ${nick(loser)} ${loser.score}${deckBits.length ? ` — ${listJoin(deckBits)}` : ''}.${deckTail}`,
      `The ${full(winner)} beat the ${full(loser)} by ${margin}${deckBits.length ? `; ${listJoin(deckBits)}` : ` on ${dLong(g.start_utc)}`}.${deckTail}`
    ][v];

    const otText = ot ? ` in ${g.home.linescores.length - 4 === 1 ? 'overtime' : `${g.home.linescores.length - 4} overtimes`}` : '';
    const venue = g.venue?.name ? ` at ${g.venue.name}` : '';
    const sResult = [
      `The ${full(winner)} beat the ${full(loser)} ${score}${otText} on ${dLong(g.start_utc)}${venue}.`,
      `On ${dLong(g.start_utc)}${venue}, the ${full(winner)} beat the ${full(loser)} ${score}${otText}.`,
      `The ${full(winner)} took a ${score} decision over the ${full(loser)}${otText} on ${dLong(g.start_utc)}${venue}.`
    ][v];
    const sStars = stars.slice(0, 3).map((r) => [`${r.name} finished with ${statLine(r)}.`, `${r.name} put up ${statLine(r)}.`, `${r.name} went for ${statLine(r)}.`][v]);
    if (!stars.length && top) sStars.push(`${top.name} led all scorers with ${statLine(top)}.`);
    const wLead = lead ? lead.largest_lead[loserSide === 'home' ? 'away' : 'home'].margin : null;
    const sLead = lead && !lead.lead_changes && !lead.largest_lead[loserSide].margin
      ? [`There were no lead changes: the ${nick(loser)} never led, and the ${poss(nick(winner))} largest lead was ${wLead}.`, `The ${nick(winner)} led wire to wire — no lead changes, the ${nick(loser)} never ahead — and by as many as ${wLead}.`, `No lead changes and no ${nick(loser)} lead at any point; the ${nick(winner)} went up by as many as ${wLead}.`][v]
      : lead ? [
      `The game had ${lead.lead_changes} lead change${lead.lead_changes === 1 ? '' : 's'} and ${lead.ties} tie${lead.ties === 1 ? '' : 's'}; the ${poss(nick(loser))} largest lead was ${lead.largest_lead[loserSide].margin}, the ${poss(nick(winner))} was ${lead.largest_lead[loserSide === 'home' ? 'away' : 'home'].margin}.`,
      `It was a game of ${lead.lead_changes} lead change${lead.lead_changes === 1 ? '' : 's'} and ${lead.ties} tie${lead.ties === 1 ? '' : 's'}. The ${nick(loser)} led by as many as ${lead.largest_lead[loserSide].margin}; the ${nick(winner)} by as many as ${lead.largest_lead[loserSide === 'home' ? 'away' : 'home'].margin}.`,
      `The lead changed hands ${lead.lead_changes} time${lead.lead_changes === 1 ? '' : 's'}, with ${lead.ties} tie${lead.ties === 1 ? '' : 's'}; the largest leads were ${lead.largest_lead[loserSide === 'home' ? 'away' : 'home'].margin} for the ${nick(winner)} and ${lead.largest_lead[loserSide].margin} for the ${nick(loser)}.`
    ][v] : null;
    const q = g.home.linescores.map((h, i) => ({ q: i + 1, home: h, away: g.away.linescores[i] }));
    const bestQ = q.map((x) => ({ ...x, diff: (winner === g.home ? x.home - x.away : x.away - x.home) })).sort((a, b) => b.diff - a.diff)[0];
    const qName = bestQ ? (bestQ.q <= 4 ? `${ordinal(bestQ.q)} quarter` : 'overtime') : '';
    const qScore = bestQ ? `${winner === g.home ? bestQ.home : bestQ.away}-${winner === g.home ? bestQ.away : bestQ.home}` : '';
    const sQuarter = bestQ && bestQ.diff > 0 ? [
      `The ${nick(winner)} did their heaviest damage in the ${qName}, winning it ${qScore}.`,
      `The ${qName} swung it: the ${nick(winner)} won it ${qScore}.`,
      `Their best stretch was the ${qName}, taken ${qScore}.`
    ][v] : null;
    const ts = (t) => live.box.teams.find((x) => x.team_id === t.team_id)?.stats || {};
    const tw = ts(winner);
    const tl = ts(loser);
    const shoot = (x) => x['fieldGoalsMade-fieldGoalsAttempted'];
    const sShoot = shoot(tw) && shoot(tl) ? `The ${nick(winner)} shot ${shoot(tw)} from the field (${tw.fieldGoalPct}%) and ${tw['threePointFieldGoalsMade-threePointFieldGoalsAttempted']} from three; the ${nick(loser)} shot ${shoot(tl)} (${tl.fieldGoalPct}%). Rebounds went ${tw.totalRebounds}-${tl.totalRebounds} and turnovers ${tw.totalTurnovers ?? tw.turnovers}-${tl.totalTurnovers ?? tl.turnovers}, with ${tw.pointsInPaint}-${tl.pointsInPaint} in the paint.` : null;
    const bigRun = live.derived?.runs?.largest ? Object.values(live.derived.runs.largest).sort((a, b) => b.points - a.points)[0] : null;
    const runTeam = bigRun ? nick(bigRun.team_id === g.home.team_id ? g.home : g.away) : '';
    const sRun = bigRun && bigRun.points >= 10 ? [
      `The biggest unanswered run was ${bigRun.points}-0 by the ${runTeam}, from ${bigRun.from} to ${bigRun.to}.`,
      `The ${runTeam} put together the game’s biggest run, ${bigRun.points}-0, from ${bigRun.from} to ${bigRun.to}.`,
      `${cap(aan(bigRun.points))} ${bigRun.points}-0 ${runTeam} run, from ${bigRun.from} to ${bigRun.to}, was the longest unanswered stretch.`
    ][v] : null;
    const body = [
      [sResult, ...sStars, sLead, sQuarter, sShoot, sRun],
      [...sStars.slice(0, 1), sResult, ...sStars.slice(1), sQuarter, sRun, sLead, sShoot],
      [sResult, sLead, sQuarter, sRun, ...sStars, sShoot]
    ][v].filter(Boolean);
    const sw = standingsById.get(winner.team_id);
    const sl = standingsById.get(loser.team_id);
    const bettor = [];
    if (ats) {
      bettor.push([
        `${poss(pc.provider)} line, as relayed by ESPN, had the ${nick(favTeam)} favored by ${Math.abs(ats.home_spread)} with a total of ${ats.over_under}. The final margin was ${margin} and the teams combined for ${ats.total_points} points, so ${coverTeam ? `the ${nick(coverTeam)} covered` : 'the spread pushed'} and the total went ${ats.total_result}.`,
        `Against ${poss(pc.provider)} line (relayed by ESPN): the ${nick(favTeam)} were ${Math.abs(ats.home_spread)}-point favorites and the total was ${ats.over_under}. ${cap(aan(margin))} ${margin}-point margin and ${ats.total_points} combined points mean ${coverTeam ? `the ${nick(coverTeam)} covered` : 'the spread pushed'} and the total went ${ats.total_result}.`,
        `The market read: ${pc.provider}, via ESPN, had the ${nick(favTeam)} by ${Math.abs(ats.home_spread)} and the total at ${ats.over_under}. The result — ${aan(margin)} ${margin}-point margin, ${ats.total_points} points — put ${coverTeam ? `the ${nick(coverTeam)} on the right side of the spread` : 'the spread at a push'} and the total ${ats.total_result}.`
      ][v]);
    } else bettor.push('No closing line is available in the source record for this game.');
    const comparisons = [];
    for (const r of stars.slice(0, 2)) {
      const pr = await api(`/v1/players/${r.athlete_id}`);
      const sea = pr?.recent?.season;
      const k = keyStat(r);
      if (!sea?.games || k.key === null) continue;
      const avg = sea[k.key];
      comparisons.push({ athlete_id: r.athlete_id, name: r.name, stat: k.key, value: k.v, season_avg: avg, games: sea.games });
      const label = { pts: 'points', reb: 'rebounds', ast: 'assists' }[k.key];
      const big = Number.isFinite(avg) && k.v - avg >= Math.max(4, avg * 0.35);
      bettor.push(`${poss(r.name)} ${k.v} ${label} compare with a season average of ${f1(avg)} over ${sea.games} games${big ? ' — a clear outlier, the kind of line the next posted prop market has to digest' : ''}.`);
    }
    if (sw && sl) bettor.push(`Standings after the result: ${nick(winner)} ${sw.wins}-${sw.losses}, ${nick(loser)} ${sl.wins}-${sl.losses}.`);
    const id = await hashId(['result', g.game_id]);
    out.push(finalize({
      id, kind, category: stars.length ? 'Performances' : 'Results', structure: v, headline, deck, body, bettor,
      market_angle: { text: ats ? [`Market reference: ${pc.provider} via ESPN (a single sportsbook). PropBetEdge ${gm.market ? `also holds a pre-tip capture from ${dShort(gm.market.captured_at)}` : 'began storing its own market captures on September 11, 2026, so no PropBetEdge capture exists for this game'}.`] : [], market: gm.market || null, game_id: g.game_id, line: pc },
      lead_team_id: winner.team_id, lead_player_id: top?.athlete_id || null, primary_subject: nick(winner), published_at: g.last_play_wallclock || g.start_utc,
      context: { game: { game_id: g.game_id, start_utc: g.start_utc, home: g.home, away: g.away, venue: g.venue }, stars: stars.slice(0, 3) },
      entities: [gameEntity(g), { type: 'team', id: winner.team_id, name: winner.name }, { type: 'team', id: loser.team_id, name: loser.name }, ...stars.slice(0, 3).map((r) => ({ type: 'player', id: r.athlete_id, name: r.name })), ...(top && !stars.length ? [{ type: 'player', id: top.athlete_id, name: top.name }] : [])],
      facts: { scores: { w: winner.score, l: loser.score, margin }, stars, top, lead, run: bigRun, ats, standings: { w: sw, l: sl }, ot_periods: g.home.linescores.length - 4, quarters: q, best_quarter: bestQ, team_stats: { w: tw, l: tl }, comparisons },
      evidence: [{ kind: 'record', source: 'ESPN box score + play-by-play', url: `https://www.espn.com/wnba/game/_/gameId/${g.game_id}`, record: { final: `${g.away.abbr} ${g.away.score} - ${g.home.abbr} ${g.home.score}`, events: live.events_total } }, ...(pc ? [{ kind: 'market', source: `${pc.provider} line relayed by ESPN`, record: { spread_home: pc.spread, total: pc.over_under, home_ml: pc.home_moneyline, away_ml: pc.away_moneyline } }] : [])]
    }));
  }
  return out;
}

// ------------------------------------------------------------ 4. previews (upcoming games)

export async function previewArticlesV1({ api, upcoming, now }) {
  const out = [];
  for (const g0 of upcoming) {
    const m = await api(`/v1/matchups/${g0.game_id}`);
    if (!m) continue;
    const g = m.game;
    const [A, H] = m.teams;
    const mk = m.market_summary;
    const v = structureOf('preview', `preview|${g.game_id}`);
    const fav = mk?.spread?.home_line !== null && mk?.spread?.home_line !== undefined ? (mk.spread.home_line < 0 ? H : mk.spread.home_line > 0 ? A : null) : null;
    const line = fav ? Math.abs(mk.spread.home_line) : null;
    const a = A.team.short_name;
    const h = H.team.short_name;
    const headline = fav ? [
      `${a} at ${h}: the ${fav.team.short_name} are ${line}-point favorites — form, rest and availability`,
      `${a} at ${h}: the market has the ${fav.team.short_name} by ${line}`,
      `Rest, form and who is out as the ${fav.team.short_name} lay ${line} in ${a} at ${h}`
    ][v] : [
      `${a} at ${h} preview: form, rest and availability`,
      `${a} at ${h}: what the form and the injury feed say`,
      `Previewing ${a} at ${h}: rest, form and who is out`
    ][v];
    const form = (t) => `${t.team.short_name} ${t.form.record_last10 || '—'} over their last ${t.form.sample} (avg margin ${pts(t.form.avg_margin_last10) ?? '—'})`;
    const outCount = A.availability.length + H.availability.length;
    const venue = g.venue?.name ? ` at ${g.venue.name}` : '';
    const deck = [
      `${dLong(g.start_utc)}${venue}. ${form(A)}; ${form(H)}.`,
      `${form(A)}; ${form(H)}. Tip-off window: ${dLong(g.start_utc)}${venue}.`,
      `The ${full(H.team)} host the ${full(A.team)} on ${dLong(g.start_utc)}${venue}.${outCount ? ` ${outCount} player${outCount === 1 ? '' : 's'} across both teams are on the injury feed.` : ' Neither team lists a player on the injury feed.'}`
    ][v];
    const coreOf = (t) => { const outIds = new Set(t.availability.map((x) => x.athlete_id)); return t.rotation.rows.filter((x) => x.appearances > 0 && !outIds.has(x.athlete_id)).slice(0, 3); };
    const cores = { a: coreOf(A), h: coreOf(H) };
    const sStanding = (t) => `The ${full(t.team)} are ${standingText(t.standing, t.standing?.conference_name) || t.team.record || ''}, ${t.form.record_last10} in their last ${t.form.sample}.`;
    const sRest = (t) => (t.schedule_context.rest_days !== null ? `They come in on ${t.schedule_context.rest_days} day${t.schedule_context.rest_days === 1 ? '' : 's'} of rest.` : '');
    const sPace = (t) => (t.pace ? `They average an estimated ${f1(t.pace.possessions_per_game)} possessions and ${f1(t.pace.points_per_game)} points per game.` : '');
    const sCore = (t) => { const core = t === A ? cores.a : cores.h; return core.length ? `Their heaviest minutes among available players over the last ${t.rotation.sample} games: ${listJoin(core.map((x) => `${x.name} (${f1(x.min)} min, ${f1(x.pts)} pts)`))}.` : null; };
    const sCoreNamed = (t) => { const core = t === A ? cores.a : cores.h; return core.length ? `For the ${t.team.short_name}, the heaviest minutes among available players over the last ${t.rotation.sample} games belong to ${listJoin(core.map((x) => `${x.name} (${f1(x.min)} min, ${f1(x.pts)} pts)`))}.` : null; };
    const sInj = (t) => (t.availability.length ? `On ESPN’s injury feed for the ${t.team.short_name}: ${listJoin(t.availability.slice(0, 4).map((x) => `${x.name} (${x.status})`))}.` : null);
    const sRestBoth = A.schedule_context.rest_days !== null && H.schedule_context.rest_days !== null
      ? `Rest: the ${a} come in on ${A.schedule_context.rest_days} day${A.schedule_context.rest_days === 1 ? '' : 's'}, the ${h} on ${H.schedule_context.rest_days}.` : null;
    const sPaceBoth = A.pace && H.pace
      ? `Estimated pace: the ${a} average ${f1(A.pace.possessions_per_game)} possessions and ${f1(A.pace.points_per_game)} points a game, the ${h} ${f1(H.pace.possessions_per_game)} and ${f1(H.pace.points_per_game)}.` : null;
    const sSeries = m.season_series?.[0]?.summary ? `Season series: ${m.season_series[0].summary}.` : null;
    const joinT = (...xs) => xs.filter(Boolean).join(' ');
    const body = [
      [joinT(sStanding(A), sRest(A), sPace(A)), sCore(A), sInj(A), joinT(sStanding(H), sRest(H), sPace(H)), sCore(H), sInj(H), sSeries],
      [sStanding(A), sStanding(H), sRestBoth || joinT(sRest(A), sRest(H)), sPaceBoth, sCoreNamed(A), sCoreNamed(H), sInj(A), sInj(H), sSeries],
      [sInj(A) || `The ${a} list no one on ESPN’s injury feed.`, sInj(H) || `The ${h} list no one on ESPN’s injury feed.`, joinT(sStanding(A), sRest(A), sPace(A)), sCore(A), joinT(sStanding(H), sRest(H), sPace(H)), sCore(H), sSeries]
    ][v].filter(Boolean);
    const bettor = [];
    const diff = (A.form.avg_margin_last10 ?? null) !== null && (H.form.avg_margin_last10 ?? null) !== null ? { a: A.form.avg_margin_last10, h: H.form.avg_margin_last10 } : null;
    if (diff) bettor.push([
      `Recent form gap: the ${a} have averaged a ${pts(diff.a)} margin over their last ${A.form.sample}, the ${h} ${pts(diff.h)} over their last ${H.form.sample}.`,
      `The form lines point in their own directions: a ${pts(diff.a)} average margin for the ${a} over their last ${A.form.sample}, ${pts(diff.h)} for the ${h} over their last ${H.form.sample}.`,
      `Margins tell the recent story — ${pts(diff.a)} a game for the ${a} across their last ${A.form.sample}, ${pts(diff.h)} for the ${h} across their last ${H.form.sample}.`
    ][v]);
    bettor.push(outCount ? `${outCount} player${outCount === 1 ? '' : 's'} across both teams are on the injury feed — check the availability panel before the lines settle.` : 'Neither team lists a player on the injury feed right now.');
    bettor.push(mk?.props?.available ? `Player props are captured for this game (${mk.props.players} players).` : 'Player props for this game will be captured inside 36 hours of tip.');
    const mt = mk ? marketText(mk, g, null) : null;
    const id = await hashId(['preview', g.game_id]);
    out.push(finalize({
      id, kind: 'preview', category: 'Previews', structure: v, headline, deck, body, bettor,
      market_angle: mt ? { text: mt.sentences, market: mk, game_id: g.game_id } : { text: ['No market snapshot exists for this game yet. Snapshots run at 8:00 a.m., 1:00 p.m. and 6:00 p.m. ET.'], market: null, game_id: g.game_id },
      lead_team_id: H.team.team_id, lead_player_id: null, primary_subject: H.team.short_name, published_at: mk?.captured_at || new Date(now).toISOString(),
      context: { game: { game_id: g.game_id, start_utc: g.start_utc, home: g.home, away: g.away, venue: g.venue } },
      entities: [gameEntity(g), { type: 'team', id: A.team.team_id, name: A.team.name }, { type: 'team', id: H.team.team_id, name: H.team.name }, ...[A, H].flatMap((t) => t.rotation.rows.filter((x) => x.appearances > 0).slice(0, 2).map((x) => ({ type: 'player', id: x.athlete_id, name: x.name })))],
      facts: { away: { form: A.form, rest: A.schedule_context, pace: A.pace, standing: A.standing, rot: cores.a, inj: A.availability.map((x) => ({ name: x.name, status: x.status })) }, home: { form: H.form, rest: H.schedule_context, pace: H.pace, standing: H.standing, rot: cores.h, inj: H.availability.map((x) => ({ name: x.name, status: x.status })) }, series: m.season_series, market: mt?.facts || null, out_count: outCount, props: mk?.props || null },
      evidence: [{ kind: 'record', source: 'wnba-api matchup research (ESPN standings, schedules, box scores, injury feed)', url: `https://wnba.propbetedge.ai/matchups/${g.game_id}`, record: { game_id: g.game_id } }, ...(mk ? [{ kind: 'market', source: 'The Odds API (stored PropBetEdge snapshot)', captured_at: mk.captured_at, record: { books: mk.books, spread_home: mk.spread.home_line, total: mk.total.line } }] : [])],
      input_hash: `${mk?.captured_at || 'nomkt'}|${outCount}`
    }));
  }
  return out;
}

// ------------------------------------------------------------ 5. team market trends (ATS / totals)

export async function trendArticlesV1({ api, finalsByTeam, teams, now }) {
  const out = [];
  for (const t of teams) {
    const games = (finalsByTeam.get(t.team_id) || []).slice(0, 10);
    if (games.length < 8) continue;
    const rows = [];
    for (const g of games) {
      const gm = await api(`/v1/games/${g.game_id}`);
      const pc = gm?.pickcenter?.[0];
      if (!pc || pc.spread === null || pc.over_under === null) continue;
      const home = g.home.team_id === t.team_id;
      const us = home ? g.home : g.away;
      const them = home ? g.away : g.home;
      const teamSpread = home ? pc.spread : -pc.spread;
      const m = us.score - them.score;
      const c = m + teamSpread;
      const tot = us.score + them.score;
      rows.push({ game_id: g.game_id, date: g.start_utc, opp: them.abbr, home, spread: teamSpread, margin: m, ats: c > 0 ? 'W' : c < 0 ? 'L' : 'P', total_line: pc.over_under, total: tot, ou: tot > pc.over_under ? 'O' : tot < pc.over_under ? 'U' : 'P', provider: pc.provider });
    }
    if (rows.length < 8) continue;
    const atsW = rows.filter((r) => r.ats === 'W').length;
    const atsL = rows.filter((r) => r.ats === 'L').length;
    const ov = rows.filter((r) => r.ou === 'O').length;
    const un = rows.filter((r) => r.ou === 'U').length;
    const extremeAts = atsW >= 7 || atsL >= 7;
    const extremeOu = ov >= 8 || un >= 8;
    if (!extremeAts && !extremeOu) continue;
    const provider = rows[0].provider;
    const n = rows.length;
    const v = structureOf('trend', `trend|${t.team_id}|${rows.map((r) => r.game_id).join(',')}`);
    const push = n - atsW - atsL;
    const rec = `${atsW}-${atsL}${push ? `-${push}` : ''}`;
    const headline = extremeAts
      ? [`The ${t.short_name} are ${rec} against the spread in their last ${n}`, atsW >= 7 ? `The ${t.short_name} have covered in ${atsW} of their last ${n}` : `The ${t.short_name} have failed to cover in ${atsL} of their last ${n}`][v]
      : [`${ov >= 8 ? 'Overs' : 'Unders'} have hit in ${Math.max(ov, un)} of the ${poss(t.short_name)} last ${n} games`, `The ${poss(t.short_name)} games have gone ${ov >= 8 ? 'over' : 'under'} the total in ${Math.max(ov, un)} of their last ${n}`][v];
    const avgSpread = rows.reduce((a, r) => a + r.spread, 0) / n;
    const avgMargin = rows.reduce((a, r) => a + r.margin, 0) / n;
    const deck = [
      `Measured against ${poss(provider)} lines as relayed by ESPN: an average spread of ${pts(Number(f1(avgSpread)))} against an average margin of ${pts(Number(f1(avgMargin)))}.`,
      `Against ${poss(provider)} lines, relayed by ESPN, the ${t.short_name} averaged a ${pts(Number(f1(avgMargin)))} margin while the spread averaged ${pts(Number(f1(avgSpread)))}.`
    ][v];
    const log = `${rows.map((r) => `${dShort(r.date)} ${r.home ? 'vs' : 'at'} ${r.opp} (${pts(r.spread)}, margin ${pts(r.margin)}, ${r.ats === 'W' ? 'covered' : r.ats === 'L' ? 'failed to cover' : 'push'})`).join('; ')}.`;
    const body = [
      [`Across their last ${n} completed games with a line in the source record, the ${full(t)} went ${rec} against the spread and ${ov}-${un} on totals.`, `Game by game: ${log}`],
      [`The ${full(t)} have a line in the source record for ${n} of their recent completed games. Against the spread they went ${rec}; on totals, ${ov}-${un}.`, `The full log: ${log}`]
    ][v];
    const bettor = [[
      `A run like this is information about how the market priced the ${t.short_name}, not a forecast: it says the lines ${atsW > atsL ? 'undersold' : 'oversold'} them over this ${n}-game window. Sample size is ${n}.`,
      `Read it as a description of the pricing, not a prediction: over these ${n} games the lines ${atsW > atsL ? 'undersold' : 'oversold'} the ${t.short_name}. Sample size is ${n}.`
    ][v]];
    const id = await hashId(['trend', t.team_id, new Date(now).toISOString().slice(0, 10)]);
    out.push(finalize({
      id, kind: 'trend', category: 'Team trends', structure: v, headline, deck, body, bettor,
      market_angle: { text: [`All lines are a single sportsbook (${provider}) relayed by ESPN. PropBetEdge’s own multi-book captures began on September 11, 2026 and will replace this reference as they accumulate.`], market: null, game_id: null },
      lead_team_id: t.team_id, lead_player_id: null, primary_subject: t.short_name, published_at: rows[0].date,
      context: { team: { team_id: t.team_id, name: t.name }, rows },
      entities: [{ type: 'team', id: t.team_id, name: t.name }],
      facts: { rows, atsW, atsL, ov, un, n, avgSpread: f1(avgSpread), avgMargin: f1(avgMargin) },
      evidence: rows.map((r) => ({ kind: 'market', source: `${r.provider} line relayed by ESPN`, url: `https://www.espn.com/wnba/game/_/gameId/${r.game_id}`, record: r })),
      input_hash: rows.map((r) => r.game_id).join(',')
    }));
  }
  return out;
}

// ------------------------------------------------------------ 6. prop watch (within the 36h capture window)

export async function propArticles({ api, props }) {
  const out = [];
  for (const pg of props?.games || []) {
    const pointsProps = (pg.props || []).filter((p) => p.market === 'player_points' && p.athlete_id && p.point !== null);
    if (!pointsProps.length) continue;
    const rows = [];
    for (const pp of pointsProps.slice(0, 12)) {
      const pr = await api(`/v1/players/${pp.athlete_id}`);
      const l10 = pr?.recent?.last10;
      if (!l10?.games) continue;
      rows.push({ athlete_id: pp.athlete_id, name: pp.player, line: pp.point, l10_pts: l10.pts, l10_min: l10.min, games: l10.games, gap: Number(f1(l10.pts - pp.point)), best_over: pp.best.over, best_under: pp.best.under, books: pp.books.length });
    }
    if (!rows.length) continue;
    rows.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
    const top = rows[0];
    const v = structureOf('props', `props|${pg.odds_event_id}|${props.captured_at}`);
    const headline = [
      `Prop watch, ${pg.away_team} at ${pg.home_team}: ${top.name}’s points line is ${top.line} against a last-${top.games} average of ${f1(top.l10_pts)}`,
      `${top.name}’s points line sits at ${top.line} for ${pg.away_team} at ${pg.home_team}; her last-${top.games} average is ${f1(top.l10_pts)}`
    ][v];
    const intro = [
      `PropBetEdge captured player-points lines for this game on ${dShort(props.captured_at)} at ${tET(props.captured_at)}. The table compares each line with the player’s average over her most recent games with minutes (ESPN game log).`,
      `These player-points lines come from PropBetEdge’s capture on ${dShort(props.captured_at)} at ${tET(props.captured_at)}, each set against the player’s average over her most recent games with minutes in the ESPN game log.`
    ][v];
    const body = [intro, ...rows.slice(0, 6).map((r) => `${r.name}: line ${r.line}, last-${r.games} average ${f1(r.l10_pts)} points in ${f1(r.l10_min)} minutes (${pts(r.gap)}).`)];
    const bettor = ['A gap between a line and a recent average is a starting point, not an edge: lines already price minutes, matchups and injuries. PropBetEdge does not publish a WNBA prop model yet.'];
    const id = await hashId(['props', pg.odds_event_id, props.captured_at]);
    out.push(finalize({
      id, kind: 'props', category: 'Prop watch', structure: v, headline, deck: `${rows.length} player-points lines against recent production, captured ${dShort(props.captured_at)}.`, body, bettor,
      market_angle: { text: rows.slice(0, 4).map((r) => `${r.name} ${r.line}: best over ${am(r.best_over?.price)} (${book(r.best_over?.book)}), best under ${am(r.best_under?.price)} (${book(r.best_under?.book)}), ${r.books} book${r.books === 1 ? '' : 's'}.`), market: null, game_id: pg.game_id },
      lead_team_id: pg.home_team_id, lead_player_id: top.athlete_id, primary_subject: top.name, published_at: props.captured_at,
      context: { rows },
      entities: [...(pg.game_id ? [{ type: 'game', id: pg.game_id, name: `${pg.away_team} @ ${pg.home_team}` }] : []), ...rows.slice(0, 6).map((r) => ({ type: 'player', id: r.athlete_id, name: r.name }))],
      facts: { rows },
      evidence: [{ kind: 'market', source: 'The Odds API player props (stored PropBetEdge snapshot)', captured_at: props.captured_at, record: { game: pg.odds_event_id, lines: rows.map((r) => ({ name: r.name, line: r.line })) } }]
    }));
  }
  return out;
}

// ------------------------------------------------------------ 7. market moves

export async function marketMoveArticles({ api, upcoming }) {
  const out = [];
  for (const g of upcoming) {
    if (!g.market?.odds_event_id) continue;
    const odds = await api(`/v1/odds?event=${g.market.odds_event_id}`);
    const h = odds?.history || [];
    if (h.length < 2) continue;
    const first = h[0];
    const last = h.at(-1);
    const dSpread = first.spread !== null && last.spread !== null ? last.spread - first.spread : 0;
    const dTotal = first.total !== null && last.total !== null ? last.total - first.total : 0;
    if (Math.abs(dSpread) < 1.5 && Math.abs(dTotal) < 2) continue;
    const v = structureOf('market', `move|${g.game_id}|${last.at}`);
    const headline = Math.abs(dSpread) >= 1.5
      ? [`Line move: ${g.home.abbr} ${pts(first.spread)} to ${pts(last.spread)} for ${g.away.abbr} at ${g.home.abbr}`, `${g.away.abbr} at ${g.home.abbr}: the consensus spread moves from ${g.home.abbr} ${pts(first.spread)} to ${pts(last.spread)}`][v]
      : [`Total move: ${first.total} to ${last.total} for ${g.away.abbr} at ${g.home.abbr}`, `${g.away.abbr} at ${g.home.abbr}: the consensus total moves from ${first.total} to ${last.total}`][v];
    const body = [[
      `Between PropBetEdge’s capture on ${dShort(first.at)} at ${tET(first.at)} and the capture on ${dShort(last.at)} at ${tET(last.at)}, the consensus home spread moved from ${pts(first.spread)} to ${pts(last.spread)} and the consensus total from ${first.total} to ${last.total} (${last.books} books).`,
      `PropBetEdge’s captures show the move: at ${tET(first.at)} on ${dShort(first.at)} the consensus had the home spread at ${pts(first.spread)} and the total at ${first.total}; by ${tET(last.at)} on ${dShort(last.at)} they read ${pts(last.spread)} and ${last.total} (${last.books} books).`
    ][v]];
    const id = await hashId(['move', g.game_id, last.at]);
    out.push(finalize({
      id, kind: 'market', category: 'Market moves', structure: v, headline, deck: `${h.length} captures of the same market, The Odds API.`, body,
      bettor: ['A move tells you where money and information went between two captures; it is not a signal on its own. Check the availability desk for anything that changed in the same window.'],
      market_angle: { text: [], market: g.market, game_id: g.game_id },
      lead_team_id: g.home.team_id, lead_player_id: null, primary_subject: g.home.abbr, published_at: last.at,
      context: { history: h, game: { game_id: g.game_id, start_utc: g.start_utc, home: g.home, away: g.away } },
      entities: [gameEntity(g), { type: 'team', id: g.home.team_id, name: g.home.name }, { type: 'team', id: g.away.team_id, name: g.away.name }],
      facts: { first, last, dSpread, dTotal, n: h.length },
      evidence: [{ kind: 'market', source: 'The Odds API (stored PropBetEdge captures)', record: h }]
    }));
  }
  return out;
}

// ------------------------------------------------------------ store helpers

export async function withSlug(a) {
  a.slug = `${kebab(a.headline)}-${a.id.slice(0, 6)}`;
  a.generator = { type: 'deterministic', version: ARTICLE_VERSION, structure: a.structure ?? 0 };
  a.updated_at = new Date().toISOString();
  return a;
}

export function cardOf(a) {
  return {
    id: a.id,
    slug: a.slug,
    kind: a.kind,
    category: a.category,
    headline: a.headline,
    deck: a.deck,
    bettor_snippet: a.bettor_angle?.summary || null,
    status: a.status,
    published_at: a.published_at,
    updated_at: a.updated_at,
    lead_team_id: a.lead_team_id,
    lead_player_id: a.lead_player_id,
    entities: a.entities.filter(Boolean),
    has_market: Boolean(a.market_watch?.market),
    market: a.market_watch?.market ? { spread: a.market_watch.market.spread?.home_line ?? null, total: a.market_watch.market.total?.line ?? null, books: a.market_watch.market.books, captured_at: a.market_watch.market.captured_at, home_abbr: (a.context?.next_game || a.context?.game)?.home?.abbr || null, away_abbr: (a.context?.next_game || a.context?.game)?.away?.abbr || null } : null,
    sources: [...new Set(a.evidence.map((e) => e.publisher || e.source))].slice(0, 4),
    episode: a.kind === 'injury' && a.lead_player_id ? `${a.lead_player_id}|${String(a.facts?.injury?.status || '').toLowerCase()}` : null,
    matchup: (() => { const g = a.context?.game || a.context?.next_game; return g?.home?.team_id ? { away_team_id: g.away?.team_id ?? null, home_team_id: g.home.team_id } : null; })()
  };
}

// Shared with deep.js.
export { finalize, marketText, standingText, nextGame, gameEntity, hashId };
