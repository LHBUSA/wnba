// Material external-news lane for the PropBetEdge WNBA newsroom.
//
// A source-wire cluster is a new PBE brief when it represents a material WNBA
// event that is not already covered by one of our structured article generators.
// The brief keeps one stable story id for the cluster: corroborating publishers
// or source updates revise that story; a different cluster creates a new story.
//
// wnba-briefs/2.0.0 — a brief is PropBetEdge journalism about an EVENT, not a note that another outlet published:
//   * ANOTHER PUBLISHER WRITING AN ARTICLE IS NOT AN EVENT. A feature, profile, opinion, analysis, listicle or
//     retrospective with no development underneath it stays external coverage (the player/team page source wire),
//     never a standalone story. The decision is deterministic (underlyingEvent) and recorded for the run.
//   * ORIGINAL VALUE: what PropBetEdge adds is measured (originalValue) from its own records — production, recent form,
//     role in the rotation, availability, transactions, standings, schedule. Beyond a developing Flash, a brief with no
//     developed PBE records does not publish.
//   * an original headline naming the development (never the publisher's headline, never "the report and …");
//     the originating report is attributed once in the body and in the evidence;
//   * THE DEVELOPMENT → WHAT PROPBETEDGE'S RECORDS SHOW → WHERE THE TEAM STANDS → WHY IT MATTERS (only what records
//     support) → WHAT COMES NEXT; source-rights and identity notes live in `method`.
// Publisher article bodies are never copied. The only publisher text in PBE prose is the attributed headline,
// quoted exactly; anything that exists only in the report stays the publisher's.

import { finalize, hashId } from './articles.js';
import { eventMateriality, laneOf, legacyType, eventType, classify, EVENT_TYPES } from './taxonomy.js';
import { publicItem } from './sources.js';
import { seasonLog } from './deep.js';
import { dShort, dLong, tET, f1, listJoin, nick, poss, wordN } from './prose.js';

export const BRIEF_VERSION = 'wnba-briefs/2.0.0';
export const BRIEF_MAX_AGE_MS = 36 * 3600e3;
export const BRIEF_MAX_PER_RUN = 12;

const MATERIAL_TYPES = new Set(['injury', 'trade', 'transaction', 'coaching', 'lineup', 'playoffs', 'league', 'news']);

// Event types that are developments in their own right. Everything else a publisher writes — features, profiles,
// previews, recaps, market pieces, business colour — is coverage of basketball, not a new event.
export const DEVELOPMENT_TYPES = new Set(['injury', 'availability', 'trade', 'signing', 'waiver', 'roster_move', 'coaching', 'front_office', 'awards', 'record', 'playoff', 'expansion', 'cba', 'draft', 'league', 'lineup']);
// Taxonomy flags that mark a piece as commentary rather than a report of something that happened.
const COVERAGE_FLAGS = new Set(['opinion', 'speculative', 'explainer', 'recycled', 'promo_or_media', 'community', 'question', 'minor_honor']);

const clean = (s) => String(s || '').replace(/[“”"]/g, "'").replace(/\s+/g, ' ').trim();
const when = (x) => Date.parse(x?.published_at || 0) || 0;
const uniq = (xs) => [...new Set(xs.filter(Boolean))];
const entityKey = (e) => `${e?.type || ''}:${e?.id || ''}`;
const trimHeadline = (s, n = 150) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function grouped(items) {
  const out = new Map();
  for (const item of items || []) {
    const key = item.cluster_id || `item:${item.item_id}`;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(item);
  }
  return [...out.entries()].map(([cluster_id, members]) => ({ cluster_id, members }));
}

function canonical(members) {
  return [...members].sort((a, b) => {
    const pa = Number.isFinite(a.priority) ? a.priority : 9;
    const pb = Number.isFinite(b.priority) ? b.priority : 9;
    if (pa !== pb) return pa - pb;
    return when(a) - when(b);
  })[0];
}

/** The event's type: the most material member's (source-wire v2), else null. */
function eventTypeOf(members) {
  const typed = members.filter((m) => m.event_type && m.materiality);
  if (!typed.length) return null;
  return [...typed].sort((a, b) => b.materiality.score - a.materiality.score || when(a) - when(b))[0].event_type;
}

/**
 * Materiality. Source-wire v2 items carry a deterministic materiality score (taxonomy.js): the event is material when
 * its strongest report plus independent corroboration clears the threshold and at least one report has an exact
 * publisher timestamp. Items without a score (v1 records — the Worker classifies every stored item before the article
 * pass, so these reach this function only from tests and replays) keep the v1 rule.
 */
function material(canon, members = [canon]) {
  const m = eventMateriality(members);
  if (m) return m.material;
  if (!MATERIAL_TYPES.has(canon.story_type)) return false;
  if (canon.story_type === 'news') return (canon.priority ?? 9) <= 2 || (canon.relevance ?? 0) >= 4;
  return true;
}

/**
 * Is there an underlying development, or only publisher coverage? Deterministic: the event type (the strongest typed
 * member, else the taxonomy applied to each member's own headline) must be a development type, and the report must not
 * be flagged as commentary. "X is the special talent firing up the Fire" types as `news`: coverage, not an event.
 */
export function underlyingEvent(members) {
  const typed = eventTypeOf(members);
  const headlineTypes = members.map((m) => ({ m, t: m.event_type || eventType(m.headline || '', { categories: m.tags || [] }) }));
  const type = typed || headlineTypes.find((x) => DEVELOPMENT_TYPES.has(x.t))?.t || headlineTypes[0]?.t || 'news';
  const flags = uniq(members.flatMap((m) => m.materiality?.flags || classify(m, { entities: m.entities || [], source: { priority: m.priority } }).materiality.flags));
  const commentary = flags.filter((f) => COVERAGE_FLAGS.has(f));
  const reporting = members.filter((m) => !(m.materiality?.flags || []).some((f) => COVERAGE_FLAGS.has(f)));
  if (!DEVELOPMENT_TYPES.has(type)) return { event: false, type, reason: `event type "${type}" is coverage, not a development`, flags };
  if (!reporting.length) return { event: false, type, reason: `every report is commentary (${commentary.join(', ')})`, flags };
  return { event: true, type, reason: `${EVENT_TYPES[type]?.label || type} development`, flags };
}

/** What PropBetEdge's own records add to the report — the dimensions the brief can develop. */
export function originalValue(v) {
  const d = [];
  if (v.season) d.push('season_production');
  if (v.season?.last5) d.push('recent_form');
  if (v.role) d.push('rotation_role');
  if (v.injury?.status) d.push('availability_listing');
  if (v.transaction) d.push('transaction_record');
  if (v.standing) d.push('team_standing');
  if (v.next_game) d.push('schedule');
  return { dimensions: d, count: d.length };
}

function coveredByStructured(canon, members, structured) {
  const published = (structured || []).filter((a) => a?.status === 'published');
  const ents = uniq(members.flatMap((m) => m.entities || []).map(entityKey));
  const players = new Set(ents.filter((x) => x.startsWith('player:')).map((x) => x.slice(7)));
  const teams = new Set(ents.filter((x) => x.startsWith('team:')).map((x) => x.slice(5)));

  if (canon.story_type === 'injury') {
    return published.some((a) => a.kind === 'injury' && a.lead_player_id != null && players.has(String(a.lead_player_id)));
  }
  if (canon.story_type === 'transaction' || canon.story_type === 'trade') {
    // A named player is the strongest identity. Do not suppress a new player-specific
    // event merely because another transaction happened for the same team.
    if (players.size) {
      return published.some((a) => a.kind === 'transaction' && a.lead_player_id != null && players.has(String(a.lead_player_id)));
    }
    // Team-only publisher items can fall back to team identity because there is no
    // safer player key available in the source-wire cluster.
    return published.some((a) => a.kind === 'transaction' && a.lead_team_id != null && teams.has(String(a.lead_team_id)));
  }
  return false;
}

// Development phrases for PropBetEdge headlines, by event type. Built only from the event type and verified identities,
// so a headline can never say more than the report and the records support.
const LEAGUE_HEADLINE = {
  expansion: 'WNBA expansion', cba: 'WNBA labor talks', draft: 'WNBA draft', awards: 'WNBA awards', front_office: 'WNBA front-office change',
  business: 'WNBA business', playoff: 'WNBA playoff picture', league: 'WNBA league office', coaching: 'WNBA coaching change'
};

/** Original PropBetEdge headline for the development. The publisher and its headline are attributed in the body. */
export function briefHeadline({ eventType: type = null, storyType, player, team, verified }) {
  const tn = team?.name || null;
  const t = type || storyType;
  if (player) {
    const withTeam = tn ? ` for the ${tn}` : '';
    const role = verified?.season ? `: ${f1(verified.season.pts)} points a game and the role behind them` : '';
    switch (t) {
      case 'injury': case 'availability': return `${player.name} injury update${withTeam}${verified?.season ? `: the ${f1(verified.season.min)} minutes and the role at stake` : ''}`;
      case 'trade': return `${player.name} trade${withTeam}${role}`;
      case 'signing': case 'waiver': case 'roster_move': case 'transaction': return `${player.name} roster move${withTeam}${role}`;
      case 'awards': return `${player.name} honored${withTeam}${verified?.season ? ': the season behind it' : ''}`;
      case 'record': return `${player.name} milestone${withTeam}${verified?.season ? ': the production behind it' : ''}`;
      case 'lineup': return `${player.name} lineup change${withTeam}${verified?.role ? ': her minutes and starts in the records' : ''}`;
      case 'draft': return `${player.name} and the WNBA draft${withTeam ? `: the ${tn} context` : ''}`;
      default: return `${player.name}${withTeam}: ${LEAGUE_HEADLINE[t] || 'WNBA'} news and her season in the records`;
    }
  }
  if (tn) {
    switch (t) {
      case 'coaching': return `${tn} coaching change: where the ${nick(team)} stand`;
      case 'front_office': return `${tn} front-office change: where the ${nick(team)} stand`;
      case 'trade': case 'signing': case 'waiver': case 'roster_move': case 'transaction': return `${tn} roster move: the team it changes`;
      case 'injury': case 'availability': return `${tn} injury news: the availability picture`;
      case 'playoff': return `${tn} playoff picture: the standings, form and schedule ahead`;
      case 'lineup': return `${tn} lineup change: the observed rotation`;
      default: return `${tn}: ${LEAGUE_HEADLINE[t] || 'WNBA'} news and where the ${nick(team)} stand`;
    }
  }
  return `${LEAGUE_HEADLINE[t] || 'WNBA league'} news: what has been reported so far`;
}

function linkedNames(members) {
  const byKey = new Map();
  for (const e of members.flatMap((m) => m.entities || [])) if (e?.type && e?.id && !byKey.has(entityKey(e))) byKey.set(entityKey(e), e.name || e.id);
  return [...byKey.values()].slice(0, 5);
}

function evidenceFor(members) {
  return [...members]
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || when(a) - when(b))
    .slice(0, 4)
    .map((m) => ({
      kind: 'publisher_report',
      publisher: m.source_name,
      headline: clean(m.headline),
      url: m.canonical_url,
      published_at: m.published_at,
      source_updated_at: m.source_updated_at || null
    }));
}

/**
 * Gather what PropBetEdge's own structured records say about the linked player/team. Every value here is
 * copied from a record (or is arithmetic over records, written to v.derived) and cited as evidence; anything
 * unavailable is simply absent.
 */
async function verify({ player, team, ctx }) {
  const v = { derived: {} };
  const evidence = [];
  const capturedAt = new Date(ctx.now || Date.now()).toISOString();
  const season = ctx.season || null;
  if (player && ctx.api) {
    const pRes = await ctx.api(`/v1/players/${player.id}`).catch(() => null);
    if (pRes?.player) {
      const cur = season ? seasonLog(pRes, season, ctx.dict?.teamById).current : null;
      if (cur?.games) {
        const last5g = (pRes.gamelog?.seasons?.find((s) => s.name === cur.season_name)?.games || []).filter((x) => x.min).slice(0, 5);
        const l5 = last5g.length === 5 ? { games: 5, pts: last5g.reduce((a, x) => a + (x.pts || 0), 0) / 5, min: last5g.reduce((a, x) => a + (x.min || 0), 0) / 5, ast: last5g.reduce((a, x) => a + (x.ast || 0), 0) / 5 } : null;
        v.season = { season_name: cur.season_name, year: cur.year, games: cur.games, pts: cur.pts, reb: cur.reb, ast: cur.ast, min: cur.min, last5: l5, wins: cur.wins, losses: cur.losses, last_date: cur.last_date };
        if (l5) { v.derived.last5_pts_delta = l5.pts - cur.pts; v.derived.last5_min_delta = l5.min - cur.min; }
        v.provenance = { name: pRes.player.name, stat: 'season', season_name: cur.season_name, year: cur.year, team: pRes.player.team?.name || cur.team_name, games: cur.games, pts: cur.pts, min: cur.min, reb: cur.reb };
        evidence.push({ kind: 'record', source: `ESPN game log (${cur.season_name})`, url: `https://wnba.propbetedge.ai/players/${player.id}`, captured_at: capturedAt, record: { games: cur.games, pts: cur.pts, reb: cur.reb, ast: cur.ast, min: cur.min, last5: l5 } });
      }
      v.position = pRes.player.position_name || null;
      if (!team && pRes.player.team) team = { id: pRes.player.team.team_id, name: pRes.player.team.name, short_name: pRes.player.team.short_name };
    }
    if (Array.isArray(ctx.injuries)) {
      const listing = ctx.injuries.find((i) => String(i.athlete_id) === String(player.id));
      v.injury = listing ? { status: listing.status, body_part: listing.body_part || null, source_updated_at: listing.source_updated_at } : { status: null };
      evidence.push({ kind: 'record', source: 'ESPN WNBA injury feed', url: 'https://wnba.propbetedge.ai/injuries', captured_at: capturedAt, record: listing ? { athlete_id: player.id, status: listing.status, body_part: listing.body_part, source_updated_at: listing.source_updated_at } : { athlete_id: player.id, listed: false } });
    }
    const last = (player.name || '').split(/\s+/).pop();
    const tx = (ctx.transactions || []).filter((t) => last && String(t.description || '').includes(last) && (!team || String(t.team?.team_id) === String(team.id))).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    if (tx) {
      v.transaction = { date: tx.date, description: tx.description };
      evidence.push({ kind: 'record', source: 'ESPN transactions log', url: 'https://www.espn.com/wnba/transactions', captured_at: capturedAt, record: { date: tx.date, description: tx.description, team_id: tx.team?.team_id } });
    }
  }
  if (team) {
    v.team = { id: String(team.id), name: team.name, short_name: team.short_name || null };
    const tRes = ctx.api ? await ctx.api(`/v1/teams/${team.id}`).catch(() => null) : null;
    if (tRes?.team?.short_name && !v.team.short_name) v.team.short_name = tRes.team.short_name;
    const st = ctx.standingsById?.get?.(String(team.id)) || tRes?.standing || null;
    if (st) {
      v.standing = { wins: st.wins, losses: st.losses, seed: st.seed ?? null, conference_name: st.conference_name || null, last_ten: st.last_ten || null, streak: st.streak || null, points_for_avg: st.points_for_avg ?? null, points_against_avg: st.points_against_avg ?? null };
      evidence.push({ kind: 'record', source: 'ESPN standings', url: 'https://wnba.propbetedge.ai/standings', captured_at: capturedAt, record: v.standing });
    }
    // Role in the observed rotation (last completed games): minutes rank and starts.
    const rot = tRes?.rotation;
    const row = player && rot?.rows?.find((r) => String(r.athlete_id) === String(player.id));
    if (row && row.appearances > 0) {
      const ranked = [...rot.rows].filter((r) => r.appearances > 0).sort((a, b) => b.min - a.min);
      v.role = { sample: rot.sample, starts: row.starts, appearances: row.appearances, min: row.min, pts: row.pts, min_rank: ranked.findIndex((r) => r.athlete_id === row.athlete_id) + 1, rotation_size: ranked.length };
      evidence.push({ kind: 'record', source: `ESPN box scores, last ${rot.sample} ${v.team.short_name || v.team.name} games (observed rotation)`, url: `https://wnba.propbetedge.ai/teams/${team.id}`, captured_at: capturedAt, record: v.role });
    }
    if (v.season && Number.isFinite(v.standing?.points_for_avg) && v.standing.points_for_avg > 0) v.derived.scoring_share_pct = (100 * v.season.pts) / v.standing.points_for_avg;
    const next = (ctx.schedule || []).filter((g) => g.status?.state === 'pre' && [g.home?.team_id, g.away?.team_id].map(String).includes(String(team.id))).sort((a, b) => String(a.start_utc).localeCompare(String(b.start_utc)))[0];
    if (next) {
      const home = String(next.home?.team_id) === String(team.id);
      const oppId = String(home ? next.away?.team_id : next.home?.team_id);
      const os = ctx.standingsById?.get?.(oppId) || null;
      v.next_game = { game_id: next.game_id, start_utc: next.start_utc, home, opponent: home ? next.away?.name : next.home?.name, opponent_record: os ? { wins: os.wins, losses: os.losses, last_ten: os.last_ten || null } : null };
      evidence.push({ kind: 'record', source: 'ESPN schedule', url: `https://wnba.propbetedge.ai/matchups/${next.game_id}`, captured_at: capturedAt, record: { game_id: next.game_id, start_utc: next.start_utc, opponent: v.next_game.opponent, opponent_record: v.next_game.opponent_record } });
    }
  }
  return { v, evidence, team };
}

const shareWord = (pct) => (pct >= 30 ? 'close to a third' : pct >= 22 ? 'more than a fifth' : pct >= 15 ? 'about a sixth' : null);

function writeBrief({ source, sourceHeadline, sourceAt, others, player, team, v, type }) {
  const sections = [];
  const body = [];
  const section = (title, key, paras) => { const ps = paras.filter(Boolean); if (!ps.length) return; sections.push({ title, key, first: body.length, count: ps.length }); body.push(...ps); };
  const s = v.season;
  const pn = player?.name;
  const tn = v.team?.name || team?.name || null;
  const tNick = v.team ? nick(v.team) : null;
  const label = (EVENT_TYPES[type]?.label || 'WNBA').toLowerCase();

  // 1. The development — attributed once; confirmation (or not) by PropBetEdge's own records.
  const dev = [`${source} reported ${label === 'wnba' ? 'the development' : `${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label} development`}${pn ? ` involving ${pn}` : tn ? ` for the ${tn}` : ''} on ${dLong(sourceAt)}, under the headline “${sourceHeadline}”.`];
  // Independent corroboration is part of the development: who else reported it, when, and how they framed it.
  if (others.length) dev.push(others.slice(0, 3).map((o) => `${o.publisher} followed ${dShort(o.published_at) === dShort(sourceAt) ? `at ${tET(o.published_at)}` : `on ${dShort(o.published_at)}`} with “${o.headline}”.`).join(' '));
  if (['injury', 'availability'].includes(type) && player && v.injury) dev.push(v.injury.status ? `ESPN’s injury feed lists ${pn} as ${v.injury.status}${v.injury.body_part ? ` (${String(v.injury.body_part).toLowerCase()})` : ''}, last updated ${dShort(v.injury.source_updated_at)} — ESPN’s status, not the league’s official injury report.` : `ESPN’s injury feed does not list ${pn} at the time of this story, so the report is not yet reflected in the structured availability record.`);
  if (['trade', 'signing', 'waiver', 'roster_move'].includes(type)) dev.push(v.transaction ? `ESPN’s transactions log records a matching move for the ${tn} on ${dShort(v.transaction.date)}: ${String(v.transaction.description).replace(/\.$/, '')}.` : `ESPN’s transactions log does not yet record the move${tn ? ` for the ${tn}` : ''}; until it does, the terms are the publisher’s reporting.`);
  section('The development', 'change', dev);

  // 2. What PropBetEdge's records show — production, trajectory and role, developed rather than listed.
  const rec = [];
  if (s) {
    let p = `${pn} has played ${s.games} games for the ${tn} this season, averaging ${f1(s.pts)} points, ${f1(s.reb)} rebounds and ${f1(s.ast)} assists in ${f1(s.min)} minutes.`;
    if (s.last5) {
      const dp = v.derived.last5_pts_delta;
      p += Math.abs(dp) >= 1.5
        ? ` Her last five games have run ${dp > 0 ? 'hotter' : 'cooler'}: ${f1(s.last5.pts)} points in ${f1(s.last5.min)} minutes, ${f1(Math.abs(dp))} points ${dp > 0 ? 'above' : 'below'} her season average${Math.abs(v.derived.last5_min_delta) >= 1.5 ? ` on ${f1(Math.abs(v.derived.last5_min_delta))} ${v.derived.last5_min_delta > 0 ? 'more' : 'fewer'} minutes a night` : ''}.`
        : ` Her last five games are in line with that: ${f1(s.last5.pts)} points in ${f1(s.last5.min)} minutes.`;
    }
    rec.push(p);
  }
  if (v.role) rec.push(`In the ${poss(tNick)} last ${wordN(v.role.sample)} completed games she ${v.role.starts ? `started ${v.role.starts === v.role.appearances ? `all ${wordN(v.role.appearances)} she played` : `${wordN(v.role.starts)} of the ${wordN(v.role.appearances)} she played`}` : `came off the bench in all ${wordN(v.role.appearances)} she played`} and averaged ${f1(v.role.min)} minutes — ${v.role.min_rank === 1 ? 'the most' : `the ${['', '', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'][v.role.min_rank] || `No. ${v.role.min_rank}`}-most`} on the team in that window.`);
  if (s && Number.isFinite(v.derived.scoring_share_pct) && shareWord(v.derived.scoring_share_pct)) rec.push(`Her ${f1(s.pts)} points a game are ${shareWord(v.derived.scoring_share_pct)} of the ${poss(tNick)} ${f1(v.standing.points_for_avg)}-point scoring average (${f1(v.derived.scoring_share_pct)}%).`);
  if (player && v.injury && !['injury', 'availability'].includes(type)) rec.push(v.injury.status ? `ESPN’s injury feed lists her as ${v.injury.status}${v.injury.body_part ? ` (${String(v.injury.body_part).toLowerCase()})` : ''}, last updated ${dShort(v.injury.source_updated_at)} — ESPN’s status, not the league’s official report.` : `She is not listed on ESPN’s injury feed.`);
  section('What PropBetEdge’s records show', 'records', rec);

  // 3. Where the team stands.
  const st = v.standing;
  if (st) {
    const bits = [`The ${tn} are ${st.wins}–${st.losses}${st.seed ? `, No. ${st.seed} in the ${st.conference_name || 'conference'}` : ''}${st.last_ten ? `, and ${st.last_ten} over their last 10 games` : ''}.`];
    if (Number.isFinite(st.points_for_avg) && Number.isFinite(st.points_against_avg)) bits.push(` They score ${f1(st.points_for_avg)} points a game and allow ${f1(st.points_against_avg)}.`);
    section('Where the team stands', 'team', [bits.join('')]);
  }

  // 4. Why it matters — only what the records support; no standing disclaimers.
  const why = [];
  if (s && v.role) {
    why.push(v.role.min_rank <= 3
      ? `That is a core role: one of the ${poss(tNick)} top ${wordN(Math.max(v.role.min_rank, 3))} in minutes over the observed window${v.role.starts ? ' and a regular starter' : ''}, so ${['injury', 'availability', 'trade', 'waiver'].includes(type) ? `a change in her availability moves about ${f1(v.role.min)} minutes a night to teammates` : `the ${tNick} lean on her production`}.`
      : `She sits outside the top three in minutes over the observed window, so ${['injury', 'availability', 'trade', 'waiver'].includes(type) ? 'a change in her availability moves bench minutes rather than a starter’s share' : 'her role is a rotation one rather than the center of the offense'}.`);
  } else if (s) {
    why.push(`At ${f1(s.min)} minutes a game across ${s.games} games, ${s.min >= 24 ? 'her workload is a heavy-minutes role' : s.min >= 12 ? 'she holds a regular rotation spot' : 'her minutes are limited'}${tNick ? ` for the ${tNick}` : ''}.`);
  }
  section('Why it matters', 'why', why);

  // 5. What comes next — schedule and the specific record that would confirm the development.
  const next = [];
  if (v.next_game) {
    const o = v.next_game.opponent_record;
    next.push(`The ${tn} next play ${v.next_game.home ? `the ${v.next_game.opponent} at home` : `at the ${v.next_game.opponent}`} on ${dLong(v.next_game.start_utc)} at ${tET(v.next_game.start_utc)}${o ? `; the ${v.next_game.opponent} are ${o.wins}–${o.losses}${o.last_ten ? ` and ${o.last_ten} over their last 10` : ''}` : ''}.`);
  } else if (tn) next.push(`No ${tn} game appears on the published schedule for the coming week.`);
  next.push(['injury', 'availability'].includes(type)
    ? `The record that would confirm it is ESPN’s injury feed${pn ? ` for ${pn}` : ''}; a status change there updates this story at the same address.`
    : ['trade', 'signing', 'waiver', 'roster_move'].includes(type)
      ? `The record that would confirm it is ESPN’s transactions log${tn ? ` for the ${tn}` : ''}; when the move appears there, this story is updated at the same address.`
      : v.team || player
        ? `This story is updated at the same address when a PropBetEdge record — a transaction, an injury-feed change or a box score — reflects the development.`
        : `This story is updated at the same address as the league’s terms, dates or affected teams are confirmed in further reporting or PropBetEdge records.`);
  section('What comes next', 'next', next);

  return { body, sections };
}

/**
 * Build at most one PBE brief per material source-wire EVENT. `ctx` supplies structured records when available.
 * The returned array carries `decisions`: every material cluster the lane considered and why it did or did not become a
 * standalone story (external_coverage = kept on the source wire and player/team pages).
 */
export async function briefArticles({ externalItems = [], structured = [], now = Date.now(), ctx = {}, existingIds = null } = {}) {
  const existing = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  // Sources under policy review (WNBA.com, WNBA-hosted team sites) never create, corroborate or appear in a brief.
  const usable = (externalItems || []).filter(publicItem);
  const withIds = await Promise.all(grouped(usable).map(async (g) => ({ ...g, canon: canonical(g.members), briefId: await hashId(['brief', g.cluster_id]) })));
  const decisions = [];
  const candidates = withIds
    .filter((g) => g.canon && material(g.canon, g.members))
    // Freshness is the EVENT's origin: its earliest report. A newly added source that surfaces an old report, or a
    // late corroboration of an old event, can never make that event a fresh story. An already-published brief
    // for the event can still be revised while its newest report is inside the window.
    .filter((g) => now - Math.min(...g.members.map(when).filter(Boolean)) <= BRIEF_MAX_AGE_MS || (existing.has(g.briefId) && now - Math.max(...g.members.map(when)) <= BRIEF_MAX_AGE_MS))
    .filter((g) => { const t = eventTypeOf(g.members); return !coveredByStructured(t ? { ...g.canon, story_type: legacyType(t) } : g.canon, g.members, structured); })
    // Another publisher writing an article is not an event: coverage with no development stays external coverage.
    .filter((g) => {
      const u = underlyingEvent(g.members);
      g.underlying = u;
      if (!u.event) decisions.push({ cluster_id: g.cluster_id, brief_id: g.briefId, headline: clean(g.canon.headline), publisher: g.canon.source_name, decision: 'external_coverage', reason: u.reason });
      return u.event;
    })
    .sort((a, b) => Math.max(...b.members.map(when)) - Math.max(...a.members.map(when)))
    .slice(0, BRIEF_MAX_PER_RUN);

  const out = [];
  for (const { cluster_id, members, canon, underlying } of candidates) {
    const names = linkedNames(members);
    const source = clean(canon.source_name || canon.attribution || 'The publisher');
    const sourceHeadline = clean(canon.headline);
    const reports = evidenceFor(members);
    const allEntities = [];
    const seen = new Set();
    for (const e of members.flatMap((m) => m.entities || [])) {
      const k = entityKey(e);
      if (!e?.type || !e?.id || seen.has(k)) continue;
      seen.add(k);
      allEntities.push(e);
    }
    const player = allEntities.find((e) => e.type === 'player') || null;
    const teamEntity = allEntities.find((e) => e.type === 'team') || (player?.team_id ? { type: 'team', id: player.team_id, name: null } : null);
    const eventTimes = members.map(when).filter(Boolean);
    if (!eventTimes.length) continue;
    const eventAt = new Date(Math.min(...eventTimes)).toISOString();
    const id = await hashId(['brief', cluster_id]);
    const evType = eventTypeOf(members);
    const type = evType || underlying.type;
    const storyType = evType ? legacyType(evType) : canon.story_type;
    const evM = eventMateriality(members);

    const { v, evidence: records, team } = await verify({ player, team: teamEntity?.name ? teamEntity : null, ctx: { ...ctx, now } });
    const value = originalValue(v);
    const publishers = new Set(reports.map((r) => r.publisher)).size;
    // Original value test: PropBetEdge adds at least one verified record dimension, or the event is independently
    // corroborated, or it is a fresh (developing) report about a linked WNBA player/team whose records will follow.
    // A single uncorroborated report with nothing PropBetEdge can verify is a link, not a story.
    const developingLinked = Boolean(player || teamEntity) && now - Date.parse(eventAt) <= 3 * 3600e3;
    if (!(value.count >= 1 || publishers >= 2 || developingLinked)) {
      decisions.push({ cluster_id, brief_id: id, headline: sourceHeadline, publisher: source, decision: 'external_coverage', reason: `${underlying.reason}, but a single uncorroborated report with no PropBetEdge record to add` });
      continue;
    }
    decisions.push({ cluster_id, brief_id: id, headline: sourceHeadline, publisher: source, decision: 'standalone', reason: `${underlying.reason}; PropBetEdge value: ${value.dimensions.join(', ') || 'none yet'}; ${publishers} publisher${publishers === 1 ? '' : 's'}` });
    const headline = trimHeadline(briefHeadline({ eventType: type, storyType, player, team: v.team || team, verified: v }));
    const canonReport = reports.find((r) => r.headline === sourceHeadline && r.publisher === source) || reports[0];
    const others = reports.filter((r) => r !== canonReport && r.publisher !== source);
    const s = v.season;
    const deckRecord = s
      ? `${player.name} has averaged ${f1(s.pts)} points and ${f1(s.ast >= s.reb ? s.ast : s.reb)} ${s.ast >= s.reb ? 'assists' : 'rebounds'} in ${f1(s.min)} minutes across ${s.games} games for the ${v.team?.name}${s.last5 ? `, ${f1(s.last5.pts)} points over her last five` : ''}.`
      : v.standing ? `The ${v.team.name} are ${v.standing.wins}–${v.standing.losses}${v.standing.last_ten ? `, ${v.standing.last_ten} over their last 10` : ''}.` : `${source} has the first report; PropBetEdge adds its own records as they reflect the development.`;
    const deck = `${deckRecord} ${player ? `First reported by ${source}` : `Reported by ${source}`} on ${dShort(canonReport?.published_at || eventAt)}.`;
    const { body, sections } = writeBrief({ source, sourceHeadline, sourceAt: canonReport?.published_at || eventAt, others, player, team: v.team || team, v, type });
    const method = [
      `Why this is a standalone story: the report describes ${/^[aeiou]/i.test(underlying.reason) ? 'an' : 'a'} ${underlying.reason.replace(/ development$/, '').toLowerCase()} development${evM ? ` (materiality ${evM.score}, threshold 3.5; ${evM.publishers} publisher${evM.publishers === 1 ? '' : 's'})` : ''}, not a feature or commentary piece, and it is not already covered by a structured injury or transaction story. PropBetEdge’s own records add: ${value.dimensions.map((d) => d.replaceAll('_', ' ')).join(', ') || 'nothing yet (a developing report)'}.`,
      'Source rights: PropBetEdge stores the publisher’s headline, link and supplied metadata only. It does not reproduce the article body, and details that exist only in that report — quotes, context, characterisation — remain the publisher’s reporting.',
      'Story identity: this story is tied to one event in PropBetEdge’s persisted event registry, identified by its facts (event type, player, team), never by a publisher’s article id. When another publisher covers the same event, or PropBetEdge’s records change, the story is revised at the same URL with an Updated time; a different event becomes a new story.'
    ];
    const verifiedKey = JSON.stringify([s ? [s.games, f1(s.pts), f1(s.reb), f1(s.ast), f1(s.min)] : null, v.injury?.status || null, v.standing ? [v.standing.wins, v.standing.losses, v.standing.seed] : null, v.next_game?.game_id || null, v.transaction?.date || null, v.role ? [v.role.min_rank, v.role.starts] : null]);
    const input_hash = [BRIEF_VERSION, type, canon.item_id, verifiedKey, ...members.map((m) => `${m.item_id}:${m.source_updated_at || m.published_at || ''}:${m.headline || ''}`).sort()].join('|');

    out.push(finalize({
      id,
      kind: 'brief',
      category: 'News Briefs',
      structure: 0,
      headline,
      deck,
      body,
      sections,
      method,
      // No stored market is attached to a source-wire event, so there is no additive betting read to write: the
      // shared Intelligence decision renders nothing rather than a standing disclaimer.
      bettor: [],
      against: [],
      unknown: [],
      markets: [],
      market_angle: { text: [], market: null, game_id: v.next_game?.game_id || null },
      lead_team_id: v.team?.id || team?.id || player?.team_id || null,
      lead_player_id: player?.id || null,
      primary_subject: player?.name || v.team?.name || null,
      published_at: eventAt,
      context: { brief: { cluster_id, story_type: storyType, event_type: type, desk: laneOf(type), source_item_id: canon.item_id, source_url: canon.canonical_url, source_name: source }, next_game: null },
      entities: [...allEntities, ...(v.next_game ? [{ type: 'game', id: v.next_game.game_id, name: `${v.team?.name} ${v.next_game.home ? 'vs' : 'at'} ${v.next_game.opponent}`, start_utc: v.next_game.start_utc }] : [])],
      facts: {
        brief: { cluster_id, story_type: storyType, event_type: type, underlying_event: underlying.event, underlying_reason: underlying.reason, value, materiality: evM ? { score: evM.score, publishers: evM.publishers } : null, source_item_id: canon.item_id, linked_entities: allEntities.map((e) => ({ type: e.type, id: e.id, name: e.name })), linked_names: names, verified: v },
        provenance: v.provenance ? [v.provenance] : []
      },
      evidence: [...reports, ...records],
      input_hash
    }));
  }
  out.decisions = decisions;
  return out;
}
