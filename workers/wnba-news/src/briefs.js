// Material external-news lane for the PropBetEdge WNBA newsroom.
//
// A source-wire cluster is a new PBE brief when it represents a material WNBA
// event that is not already covered by one of our structured article generators.
// The brief keeps one stable story id for the cluster: corroborating publishers
// or source updates revise that story; a different cluster creates a new story.
//
// wnba-briefs/1.1.0 — a brief is a PropBetEdge article, not an RSS mirror:
//   * an original PBE headline built from the event type and the linked player/team (never the publisher's
//     headline with a source prefix); the originating report is attributed in the deck, body and evidence;
//   * WHAT HAPPENED (attributed) → WHAT PROPBETEDGE CAN VERIFY (our structured records: game log, standings,
//     injury feed, transactions, schedule) → WHY IT MATTERS (only what those records support) → WHAT COMES NEXT;
//   * the source-rights and story-identity method moves out of the body into `method` (the trust layer).
// Publisher article bodies are never copied. The only publisher text in PBE prose is the attributed headline,
// quoted exactly; anything that exists only in the report stays the publisher's.

import { finalize, hashId } from './articles.js';
import { eventMateriality, laneOf, legacyType, EVENT_TYPES } from './taxonomy.js';
import { seasonLog } from './deep.js';
import { dShort, dLong, tET, f1, listJoin, nick, poss } from './prose.js';

export const BRIEF_VERSION = 'wnba-briefs/1.1.0';
export const BRIEF_MAX_AGE_MS = 36 * 3600e3;
export const BRIEF_MAX_PER_RUN = 12;

// Event types whose brief headline names the event class (the v1 legacy types keep their v1 headlines, so stories
// already published are not re-headlined).
const LEAGUE_HEADLINE = {
  expansion: 'WNBA expansion news',
  cba: 'WNBA labor news',
  draft: 'WNBA draft news',
  awards: 'WNBA awards news',
  front_office: 'WNBA front-office news',
  business: 'WNBA business news',
  playoff: 'WNBA playoff news'
};

const MATERIAL_TYPES = new Set(['injury', 'trade', 'transaction', 'coaching', 'lineup', 'playoffs', 'league', 'news']);

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

/** The event's type: the most material member's (source-wire v2), else the canonical item's legacy type. */
function eventTypeOf(members, canon) {
  const typed = members.filter((m) => m.event_type && m.materiality);
  if (!typed.length) return null;
  return [...typed].sort((a, b) => b.materiality.score - a.materiality.score || when(a) - when(b))[0].event_type;
}

/**
 * Materiality. Source-wire v2 items carry a deterministic materiality score (taxonomy.js): the event is material when
 * its strongest report plus independent corroboration clears the threshold and at least one report has an exact
 * publisher timestamp. Items without a score (v1 records) keep the v1 rule.
 */
function material(canon, members = [canon]) {
  const m = eventMateriality(members);
  if (m) return m.material;
  if (!MATERIAL_TYPES.has(canon.story_type)) return false;
  if (canon.story_type === 'news') return (canon.priority ?? 9) <= 2 || (canon.relevance ?? 0) >= 4;
  return true;
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

/**
 * Original PropBetEdge headline for the event. Built only from the event type and verified identities, so it can
 * never say more than the report and the records support. The publisher's headline is attributed in the deck.
 */
export function briefHeadline({ storyType, eventType = null, player, team, verified, source }) {
  if (eventType && LEAGUE_HEADLINE[eventType] && !player) {
    const teamName = team?.name || null;
    return teamName ? `${teamName}: ${LEAGUE_HEADLINE[eventType].replace(/^WNBA /, '')} — the report and where the ${nick(team)} stand` : `${LEAGUE_HEADLINE[eventType]}: the ${source} report and what PropBetEdge’s records show`;
  }
  if (eventType === 'awards' && player) return `${player.name} award news${team?.name ? ` for the ${team.name}` : ''}: the announcement and her season in numbers`;
  const teamName = team?.name || null;
  if (player) {
    const withTeam = teamName ? ` for the ${teamName}` : '';
    switch (storyType) {
      case 'injury': return `${player.name} injury report${withTeam}: what the availability records show`;
      case 'trade':
      case 'transaction': return `${player.name} roster news${withTeam}: the report and the transactions record`;
      case 'lineup': return `${player.name} and the ${teamName || 'WNBA'} lineup: the report and her rotation role`;
      case 'playoffs': return `${player.name} and the ${teamName ? `${nick(team)}’` : 'WNBA'} playoff picture: the report and the records`;
      default: return verified?.season ? `${player.name} in focus${withTeam}: the report and her season in numbers` : `${player.name} in focus${withTeam}: what the report says and what the records show`;
    }
  }
  if (teamName) {
    switch (storyType) {
      case 'coaching': return `${teamName} coaching news: the report and where the ${nick(team)} stand`;
      case 'trade':
      case 'transaction': return `${teamName} roster news: the report and the transactions log`;
      case 'injury': return `${teamName} injury news: the report and the injury feed`;
      case 'playoffs': return `${teamName} playoff picture: the report and the standings`;
      case 'lineup': return `${teamName} lineup news: the report and the observed rotation`;
      default: return `${teamName} in the news: the report and where the ${nick(team)} stand`;
    }
  }
  return `WNBA league news: the ${source} report and what PropBetEdge’s records show`;
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
 * copied from a record and cited as evidence; anything unavailable is simply absent.
 */
async function verify({ player, team, ctx }) {
  const v = {};
  const evidence = [];
  const capturedAt = new Date(ctx.now || Date.now()).toISOString();
  const season = ctx.season || null;
  if (player && ctx.api) {
    const pRes = await ctx.api(`/v1/players/${player.id}`).catch(() => null);
    if (pRes?.player) {
      const cur = season ? seasonLog(pRes, season, ctx.dict?.teamById).current : null;
      if (cur?.games) {
        const last5g = (pRes.gamelog?.seasons?.find((s) => s.name === cur.season_name)?.games || []).filter((x) => x.min).slice(0, 5);
        const l5 = last5g.length === 5 ? { games: 5, pts: last5g.reduce((a, x) => a + (x.pts || 0), 0) / 5, min: last5g.reduce((a, x) => a + (x.min || 0), 0) / 5 } : null;
        v.season = { season_name: cur.season_name, year: cur.year, games: cur.games, pts: cur.pts, reb: cur.reb, ast: cur.ast, min: cur.min, last5: l5 };
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
    const st = ctx.standingsById?.get?.(String(team.id));
    if (st) {
      v.standing = { wins: st.wins, losses: st.losses, seed: st.seed ?? null, conference_name: st.conference_name || null, last_ten: st.last_ten || null };
      evidence.push({ kind: 'record', source: 'ESPN standings', url: 'https://wnba.propbetedge.ai/standings', captured_at: capturedAt, record: v.standing });
    }
    const next = (ctx.schedule || []).filter((g) => g.status?.state === 'pre' && [g.home?.team_id, g.away?.team_id].map(String).includes(String(team.id))).sort((a, b) => String(a.start_utc).localeCompare(String(b.start_utc)))[0];
    if (next) {
      const home = String(next.home?.team_id) === String(team.id);
      v.next_game = { game_id: next.game_id, start_utc: next.start_utc, home, opponent: home ? next.away?.name : next.home?.name };
      evidence.push({ kind: 'record', source: 'ESPN schedule', url: `https://wnba.propbetedge.ai/matchups/${next.game_id}`, captured_at: capturedAt, record: { game_id: next.game_id, start_utc: next.start_utc, opponent: v.next_game.opponent } });
    }
  }
  return { v, evidence, team };
}

function writeBrief({ source, sourceHeadline, sourceAt, others, names, player, team, v, storyType }) {
  const sections = [];
  const body = [];
  const section = (title, paras) => { const ps = paras.filter(Boolean); if (!ps.length) return; sections.push({ title, first: body.length, count: ps.length }); body.push(...ps); };
  const s = v.season;
  const pn = player?.name;
  const tn = v.team?.name || team?.name || null;
  const tNick = v.team ? nick(v.team) : null;

  // 1. What happened — attributed, never the article body.
  section('What happened', [
    `${source} published “${sourceHeadline}” on ${dLong(sourceAt)}.${others.length ? ` ${listJoin(others.map((o) => o.publisher))} ${others.length === 1 ? 'has' : 'have'} also covered it.` : ''} ${names.length ? `PropBetEdge links the report to ${listJoin(names)}.` : 'The report passed the WNBA relevance check without a safe player or team link.'}`,
    `Anything that appears only in that report — quotes, context, characterisation — remains ${poss(source)} reporting; this story does not restate it as PropBetEdge fact. What PropBetEdge adds is below, from its own WNBA records.`
  ]);

  // 2. What PropBetEdge can verify — structured records only.
  const verifiedParas = [];
  if (s) verifiedParas.push(`${pn} has played ${s.games} games for the ${tn} this season, averaging ${f1(s.pts)} points, ${f1(s.reb)} rebounds and ${f1(s.ast)} assists in ${f1(s.min)} minutes.${s.last5 ? ` Over her last five games she is at ${f1(s.last5.pts)} points in ${f1(s.last5.min)} minutes.` : ''}`);
  if (player && v.injury) verifiedParas.push(v.injury.status ? `ESPN’s injury feed lists ${pn} as ${v.injury.status}${v.injury.body_part ? ` (${String(v.injury.body_part).toLowerCase()})` : ''}, last updated ${dShort(v.injury.source_updated_at)}. That is ESPN’s status, not the league’s official injury report.` : `${pn} is not listed on ESPN’s injury feed at the time of this story.`);
  if (v.transaction) verifiedParas.push(`ESPN’s transactions log records this move for the ${tn} on ${dShort(v.transaction.date)}: ${String(v.transaction.description).replace(/\.$/, '')}.`);
  if (v.standing) verifiedParas.push(`The ${tn} are ${v.standing.wins}–${v.standing.losses}${v.standing.seed ? `, No. ${v.standing.seed} in the ${v.standing.conference_name || 'conference'}` : ''}${v.standing.last_ten ? `, and ${v.standing.last_ten} over their last 10 games` : ''}.`);
  section('What PropBetEdge can verify', verifiedParas.length ? verifiedParas : ['PropBetEdge’s structured records do not yet add a verified detail to this report: no linked game log, standings entry, injury listing or transaction is available for it.']);

  // 3. Why it matters — only what the records support.
  const why = [];
  if (s) {
    const role = s.min >= 24 ? 'a heavy-minutes role' : s.min >= 12 ? 'a regular rotation role' : 'limited minutes';
    why.push(`At ${f1(s.min)} minutes a game, ${pn} has ${role} for the ${tNick}${s.min >= 12 ? ', so a change in her availability or usage would move real minutes to teammates' : ', so a change in her status moves fewer minutes than a starter’s would'}.`);
  }
  if (player && v.injury?.status) why.push(`Because the injury feed already lists her as ${v.injury.status}, any line for the ${tNick} captured after ${dShort(v.injury.source_updated_at)} was set with that listing public.`);
  why.push(`For bettors the report is context rather than a signal: a market-relevant change would show up in PropBetEdge’s availability, rotation or stored market records, and this story is revised when one does.`);
  section('Why it matters', why);

  // 4. What comes next — schedule and the records to watch.
  const next = [];
  if (v.next_game) next.push(`The ${tn} next play ${v.next_game.home ? `the ${v.next_game.opponent} at home` : `at the ${v.next_game.opponent}`} on ${dLong(v.next_game.start_utc)} at ${tET(v.next_game.start_utc)}; the matchup page carries form, rest, rotations and the stored market for that game.`);
  else if (tn) next.push(`No ${tn} game appears on the published schedule for the coming week.`);
  next.push(storyType === 'injury' || v.injury?.status
    ? `The injury feed is the record to watch: a status change there, not a restated report, is what would change the availability picture.`
    : storyType === 'trade' || storyType === 'transaction'
      ? `The transactions log is the record to watch: a signing, waiver or trade there confirms the move in PropBetEdge’s data.`
      : `If the story develops into an injury-feed change, a transaction or a rotation change in the next box score, this brief is updated with that record cited.`);
  section('What comes next', next);

  return { body, sections };
}

/** Build at most one PBE brief per material source-wire cluster. `ctx` supplies structured records when available. */
export async function briefArticles({ externalItems = [], structured = [], now = Date.now(), ctx = {}, existingIds = null } = {}) {
  const existing = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  const withIds = await Promise.all(grouped(externalItems).map(async (g) => ({ ...g, canon: canonical(g.members), briefId: await hashId(['brief', g.cluster_id]) })));
  const candidates = withIds
    .filter((g) => g.canon && material(g.canon, g.members))
    // Freshness is the EVENT's origin: its earliest report. A newly added source that surfaces an old report, or a
    // late corroboration of an old event, can never make that event a fresh story. An already-published brief
    // for the event can still be revised while its newest report is inside the window.
    .filter((g) => now - Math.min(...g.members.map(when).filter(Boolean)) <= BRIEF_MAX_AGE_MS || (existing.has(g.briefId) && now - Math.max(...g.members.map(when)) <= BRIEF_MAX_AGE_MS))
    .filter((g) => { const t = eventTypeOf(g.members, g.canon); return !coveredByStructured(t ? { ...g.canon, story_type: legacyType(t) } : g.canon, g.members, structured); })
    .sort((a, b) => Math.max(...b.members.map(when)) - Math.max(...a.members.map(when)))
    .slice(0, BRIEF_MAX_PER_RUN);

  const out = [];
  for (const { cluster_id, members, canon } of candidates) {
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
    const evType = eventTypeOf(members, canon);
    const storyType = evType ? legacyType(evType) : canon.story_type;
    const evM = eventMateriality(members);

    const { v, evidence: records, team } = await verify({ player, team: teamEntity?.name ? teamEntity : null, ctx: { ...ctx, now } });
    const headline = trimHeadline(briefHeadline({ storyType, eventType: evType, player, team: v.team || team, verified: v, source }));
    const canonReport = reports.find((r) => r.headline === sourceHeadline && r.publisher === source) || reports[0];
    const others = reports.filter((r) => r !== canonReport && r.publisher !== source);
    const s = v.season;
    const deckRecord = s
      ? `PropBetEdge’s records: ${f1(s.pts)} points and ${f1(s.ast >= s.reb ? s.ast : s.reb)} ${s.ast >= s.reb ? 'assists' : 'rebounds'} per game across ${s.games} games for the ${v.team?.name} this season.`
      : v.standing ? `PropBetEdge’s records: the ${v.team.name} are ${v.standing.wins}–${v.standing.losses}.` : 'PropBetEdge keeps the report attributed and adds its own WNBA records where they exist.';
    const deck = `${source} published “${sourceHeadline}”. ${deckRecord}`;
    const { body, sections } = writeBrief({ source, sourceHeadline, sourceAt: canonReport?.published_at || eventAt, others, names, player, team: v.team || team, v, storyType });
    const method = [
      evM
        ? `Why this is a News Brief: the event (${EVENT_TYPES[evType]?.label || storyType}) scored ${evM.score} on PropBetEdge’s deterministic materiality check (threshold 3.5; ${evM.publishers} publisher${evM.publishers === 1 ? '' : 's'}), and it is not already covered by a structured injury or transaction story.`
        : `Why this is a News Brief: ${poss(source)} item passed the PropBetEdge source-wire materiality check (story type: ${canon.story_type}) and is not already covered by a structured injury or transaction story.`,
      'Source rights: PropBetEdge stores the publisher’s headline, link and supplied metadata only. It does not reproduce the article body, and details that exist only in that report remain the publisher’s reporting.',
      'Story identity: this brief is tied to one event in PropBetEdge’s persisted event registry, identified by its facts (event type, player, team), never by a publisher’s article id. When another publisher covers the same event, or PropBetEdge’s records change, the story is revised at the same URL with an Updated time; a different event becomes a new brief.'
    ];
    const verifiedKey = JSON.stringify([s ? [s.games, f1(s.pts), f1(s.reb), f1(s.ast), f1(s.min)] : null, v.injury?.status || null, v.standing ? [v.standing.wins, v.standing.losses, v.standing.seed] : null, v.next_game?.game_id || null, v.transaction?.date || null]);
    const input_hash = [BRIEF_VERSION, storyType, canon.item_id, verifiedKey, ...members.map((m) => `${m.item_id}:${m.source_updated_at || m.published_at || ''}:${m.headline || ''}`).sort()].join('|');

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
      bettor: [player
        ? `For bettors, ${poss(source)} report on ${player.name} is context, not a signal: it matters for a line or prop only if PropBetEdge’s availability, rotation or market records change because of it.`
        : `For bettors, ${poss(source)} report is context, not a signal: it matters only if PropBetEdge’s availability, rotation, schedule or market records change because of it.`],
      against: ['The event is based on attributed external reporting; details not present in PropBetEdge structured records remain publisher reporting, not independently verified PBE facts.'],
      unknown: ['Whether this development changes official availability, rotation, schedule context or a stored market in PropBetEdge structured records.'],
      markets: ['availability', 'rotation', 'matchup', 'market'],
      market_angle: { text: [], market: null, game_id: v.next_game?.game_id || null },
      lead_team_id: v.team?.id || team?.id || player?.team_id || null,
      lead_player_id: player?.id || null,
      primary_subject: player?.name || v.team?.name || null,
      published_at: eventAt,
      context: { brief: { cluster_id, story_type: storyType, event_type: evType, desk: evType ? laneOf(evType) : null, source_item_id: canon.item_id, source_url: canon.canonical_url, source_name: source }, next_game: null },
      entities: [...allEntities, ...(v.next_game ? [{ type: 'game', id: v.next_game.game_id, name: `${v.team?.name} ${v.next_game.home ? 'vs' : 'at'} ${v.next_game.opponent}`, start_utc: v.next_game.start_utc }] : [])],
      facts: {
        brief: { cluster_id, story_type: storyType, event_type: evType, materiality: evM ? { score: evM.score, publishers: evM.publishers } : null, source_item_id: canon.item_id, linked_entities: allEntities.map((e) => ({ type: e.type, id: e.id, name: e.name })), verified: v },
        provenance: v.provenance ? [v.provenance] : []
      },
      evidence: [...reports, ...records],
      input_hash
    }));
  }
  return out;
}
