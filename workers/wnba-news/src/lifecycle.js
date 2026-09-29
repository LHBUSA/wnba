// Newsroom story lifecycle: which generated article is a NEW material event (a new story that may
// lead the front page) and which is the SAME event with new data (a revision that keeps its
// original editorial publication time).
//
// Two clocks live on every card:
//   published_at        source/event clock — moves when the provider record or capture moves.
//   first_published_at  editorial origin   — the moment PropBetEdge first published the canonical
//                                            story. Immutable: a revision can never move it later.
//
// Canonical event identity (never a provider timestamp, never a calendar date):
//   injury  player + status, while that listing stays continuous. ESPN re-mints `injury_id` for
//           the same absence on routine feed refreshes (Satou Sabally: 51294, 51297, … 51387,
//           51389 — same player, status, body part and return date), so the id is provenance only.
//           A status change, or a re-listing after the player was off the feed for RELIST_GAP_MS,
//           is a genuinely new event.
//   trend   team + market (spread | total) + EPISODE. An episode is one continuous qualifying run: while the
//           daily trend desk keeps finding the same market material for the team, each new final that shifts
//           the ten-game window revises the SAME story (same id, URL and origin). The episode ends only when
//           the desk measures the market and finds it no longer material; a later run is a new episode and
//           may be a new story. A calendar date, a cron run or a generator version is never part of it.
//   transaction / brief  the generator id is NOT stable (transaction: date + the day's moves list; brief: the
//           source-wire cluster id), so canonicalStoryKey() below maps a drifted id back onto the stored story:
//           transaction = team + date; brief = event family + subject within the registry's 72h same-event window.
//   others  the generator id (game id) is already stable, and the novelty key below maps any other id minted for
//           the same fact back onto the stored story.

import { laneOf } from './taxonomy.js';

export const RELIST_GAP_MS = 12 * 3600e3;

const DEPTH_RANK = { flash: 0, brief: 1, full: 2, deep: 3 };

/** Stable digest of an article's fact block (the records it was written from), so a regeneration can tell new facts from new prose. */
export function factsDigest(a) {
  const strip = (x) => (Array.isArray(x) ? x.map(strip) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'policy').sort(([p], [q]) => p.localeCompare(q)).map(([k, v]) => [k, strip(v)])) : x);
  const s = JSON.stringify(strip(a?.facts || {})) + JSON.stringify((a?.evidence || []).map((e) => e.record ?? e.headline ?? null));
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

const SHARED_EXCLUDE = new Set(['policy', 'derived', 'provenance', 'market']);
/**
 * Facts the earlier version was written from, unchanged in the new version? Compares the fact keys both versions
 * carry (a newer generator may ADD fact keys — that is enrichment, not a change of fact). Volatile market captures and
 * derived arithmetic are excluded.
 */
export function sharedFactsUnchanged(prevItem, a) {
  const p = prevItem?.facts || {};
  const n = a?.facts || {};
  const keys = Object.keys(p).filter((k) => k in n && !SHARED_EXCLUDE.has(k));
  if (!keys.length) return false;
  // Order-insensitive (a feed can list the same players in a different order) and rounding-stable.
  const canon = (x) => (Array.isArray(x) ? x.map(canon).sort((p, q) => JSON.stringify(p).localeCompare(JSON.stringify(q))) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([k]) => !/(captured_at|fetched_at|age_s|stale|generation_cutoff|generated_at|source_observed_at)$/.test(k)).sort(([p], [q]) => p.localeCompare(q)).map(([k, v]) => [k, canon(v)])) : typeof x === 'number' ? Math.round(x * 1000) / 1000 : x);
  const norm = (x) => JSON.stringify(canon(x));
  return keys.every((k) => norm(p[k]) === norm(n[k]));
}

/** The revision kind for a rewrite of `prev` by `a`. `prevItem` is the stored earlier version, when available. */
export function revisionKind(a, prev, version, prevItem = null) {
  if (a.context?.regeneration === 'editorial_upgrade') return { kind: 'editorial_upgrade' };
  // The editorial desk rewrote a story whose facts did not change: an editorial quality upgrade, not a data update.
  if (a.editorial?.status === 'applied' && prevItem && prevItem.editorial?.status !== 'applied' && sharedFactsUnchanged(prevItem, a)) return { kind: 'editorial_quality_upgrade', from_generator: 'deterministic', editorial: a.editorial.version };
  const from = prev.depth_class;
  const to = a.depth?.class;
  if (from && to && DEPTH_RANK[to] > DEPTH_RANK[from]) return { kind: 'depth_upgrade', from, to };
  const prevVersion = String(prev.input_hash || '').split('|')[0];
  const sameFacts = prevItem ? sharedFactsUnchanged(prevItem, a) : prev.facts_digest ? prev.facts_digest === factsDigest(a) : false;
  if (prevVersion && prevVersion !== version && sameFacts) return { kind: 'editorial_quality_upgrade', from_generator: prevVersion };
  // Same generator, same facts, different source observation time: the provenance record was corrected, not the story.
  if (sameFacts && prevItem?.provenance?.source_observed_at && a.provenance?.source_observed_at && prevItem.provenance.source_observed_at !== a.provenance.source_observed_at) return { kind: 'metadata_correction', note: `Source observation time corrected from ${prevItem.provenance.source_observed_at} to ${a.provenance.source_observed_at}.` };
  return { kind: 'data_update' };
}

const ms = (x) => { const v = Date.parse(x || ''); return Number.isFinite(v) ? v : null; };
const earliest = (xs) => xs.filter((x) => ms(x) !== null).sort((a, b) => ms(a) - ms(b))[0] || null;
const latest = (xs) => xs.filter((x) => ms(x) !== null).sort((a, b) => ms(b) - ms(a))[0] || null;

export const articleFirstPublishedAt = (c) => c?.first_published_at || c?.published_at || null;

/** When the event behind a card began, as far as the card can tell (duplicates carry poisoned origins but honest source times). */
const eventStart = (c) => Math.min(...[ms(c.first_published_at), ms(c.published_at)].filter((v) => v !== null), Infinity);
const byOriginDesc = (x, y) => (ms(articleFirstPublishedAt(y)) ?? -Infinity) - (ms(articleFirstPublishedAt(x)) ?? -Infinity) || eventStart(y) - eventStart(x) || String(y.id).localeCompare(String(x.id));

/** Source provenance only — ESPN does not keep this stable across refreshes of the same absence. */
export const injuryIdentity = (a) => {
  const id = a?.kind === 'injury' ? a?.facts?.injury?.injury_id : null;
  return id === null || id === undefined || id === '' ? null : String(id);
};

/** `player|status` for an injury article (from facts) or card (stored episode). */
export const injuryEpisode = (x) => {
  if (x?.kind !== 'injury' || !x?.lead_player_id) return null;
  const status = x?.facts?.injury?.status;
  if (status) return `${x.lead_player_id}|${String(status).toLowerCase()}`;
  return x.episode || null;
};

// ---------------------------------------------------------------------------------------------- trend episodes

/** Live continuity needs one shared game; repairing cards written before episodes existed needs a majority of the window. */
export const TREND_MIN_OVERLAP = 1;
export const TREND_LEGACY_OVERLAP = 5;
/** Trend states that keep a story out of every listing (URL, origin and history are kept). */
export const TREND_UNLISTED = new Set(['ended', 'dormant']);

/** Market family of a trend: the article/card field, else read from a legacy headline. */
export const trendMarketOf = (x) => {
  if (x?.kind !== 'trend') return null;
  if (x.market_type === 'spread' || x.market_type === 'total') return x.market_type;
  const h = String(x.headline || '');
  if (/against the spread|\bATS\b/i.test(h)) return 'spread';
  if (/\b(unders?|overs?)\b|the total/i.test(h)) return 'total';
  return null;
};

/** Newest-first game ids the trend measures: a generated article carries them raw in input_hash; a card in trend_window. */
export const trendWindowOf = (x, { stored = false } = {}) => {
  if (x?.kind !== 'trend') return [];
  let w = x.trend_window;
  if (!w && stored) {
    const legacy = String(x.story_key || '').split(':');
    w = legacy.length === 3 ? legacy[2] : String(x.input_hash || '').split('|')[1];
  }
  if (!w && !stored) w = x.input_hash;
  return String(w || '').split(',').map((s) => s.trim()).filter(Boolean);
};

const overlap = (a, b) => { const s = new Set(a); return b.filter((x) => s.has(x)).length; };
const isEpisodeKey = (k) => typeof k === 'string' && k.split(':').length === 4;
export const trendEpisodeKey = (team, market, anchorGameId) => (team && market && anchorGameId ? `trend:${team}:${market}:${anchorGameId}` : null);

/**
 * `trend:team:market:anchor` — the episode a stored card belongs to, or the episode a generated article would OPEN
 * (anchored on the newest game of its first window). A continuing article inherits its predecessor's key in the merge.
 */
export const trendKey = (x, { stored = false } = {}) => {
  if (x?.kind !== 'trend' || !x?.lead_team_id) return null;
  if (isEpisodeKey(x.story_key)) return x.story_key;
  if (stored) return x.story_key || null;
  return trendEpisodeKey(x.lead_team_id, trendMarketOf(x), trendWindowOf(x)[0]);
};

/**
 * Assign episodes to trend cards written before episodes existed (story_key was the exact window, so every new final
 * minted a new story). Per team + market, oldest first: a card whose window shares a majority of games with the
 * previous card's continues that episode. Cards are only annotated here; repairIndex collapses each episode.
 */
export function assignLegacyTrendEpisodes(cards, repairs = []) {
  const groups = new Map();
  for (const c of cards) {
    if (c.kind !== 'trend' || c.duplicate_of || isEpisodeKey(c.story_key)) continue;
    const market = trendMarketOf(c);
    const win = trendWindowOf(c, { stored: true });
    if (!c.lead_team_id || !market || !win.length) continue;
    const k = `${c.lead_team_id}|${market}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ c, market, win });
  }
  for (const list of groups.values()) {
    list.sort((x, y) => eventStart(x.c) - eventStart(y.c) || String(x.c.id).localeCompare(String(y.c.id)));
    let prev = null;
    for (const cur of list) {
      const key = prev && overlap(prev.win, cur.win) >= TREND_LEGACY_OVERLAP ? prev.key : trendEpisodeKey(cur.c.lead_team_id, cur.market, cur.win[0]);
      repairs.push({ id: cur.c.id, fix: 'trend_episode_assigned', from: cur.c.story_key || null, to: key });
      cur.c.story_key = key;
      cur.c.market_type = cur.market;
      if (!cur.c.trend_window) cur.c.trend_window = cur.win.join(',');
      prev = { ...cur, key };
    }
  }
  return repairs;
}

/**
 * Apply one COMPLETE trend-desk pass to the stored trend cards. `decisions` holds one entry per team + market the desk
 * measured: standalone (published this pass), secondary (material, but the team's story is on its other market),
 * withheld (extreme but immaterial), not_extreme, or insufficient (too few lined games — measures nothing).
 *   current  the team's published trend this pass, or a material one whose rewrite was held — listed.
 *   dormant  still material but the team's current story is on its other market — unlisted, episode continues.
 *   ended    measured and no longer material — unlisted; a later run is a new episode.
 * Insufficient data and teams the pass did not measure leave a card unchanged. Idempotent.
 */
export function applyTrendDecisions(cards, decisions, { at, publishedIds = new Set() } = {}) {
  const changes = [];
  const byTeam = new Map();
  for (const d of decisions || []) {
    if (!d?.team_id || !d.market) continue;
    const k = `${d.team_id}|${d.market}`;
    byTeam.set(k, d);
  }
  // Newest episode first, so an older episode of the same run is the one that steps aside.
  const trends = cards.filter((c) => c.kind === 'trend' && !c.duplicate_of && c.lead_team_id).sort(byOriginDesc);
  const currentByTeam = new Map();
  for (const c of trends) if (publishedIds.has(c.id)) currentByTeam.set(String(c.lead_team_id), c);
  const set = (c, state, reason) => {
    if (c.trend_state === state && c.trend_state_reason === reason) return;
    changes.push({ id: c.id, from: c.trend_state || null, to: state, reason });
    c.trend_state = state;
    c.trend_state_reason = reason;
    c.trend_state_at = at;
    if (TREND_UNLISTED.has(state)) {
      c.quality_state = 'retired_from_index';
      c.quality_review = { policy: 'trend-lifecycle/1.0.0', state: 'retired_from_index', reason, at };
    } else if (c.quality_review?.policy === 'trend-lifecycle/1.0.0' || c.quality_review?.trend_lifecycle) {
      // Back to current: the normal quality review decides its listing state again.
      delete c.quality_state;
      delete c.quality_review;
    }
  };
  for (const c of trends) {
    const team = String(c.lead_team_id);
    const d = byTeam.get(`${team}|${trendMarketOf(c)}`);
    const cur = currentByTeam.get(team);
    if (cur && cur.id === c.id) { set(c, 'current', `the team's trend story this pass: ${d?.reason || 'material'}`); continue; }
    if (!d || d.decision === 'insufficient') continue;
    if (d.decision === 'withheld' || d.decision === 'not_extreme') { set(c, 'ended', `the trend desk measured it on ${at.slice(0, 10)} and it no longer qualifies: ${d.reason}`); continue; }
    // Still material. Another story is the team's current trend (the other market, or a newer episode): step aside.
    if (cur) { set(c, 'dormant', `still material (${d.reason}), but the team's current trend story is ${cur.id}`); continue; }
    const newerSame = trends.find((o) => o.id !== c.id &&String(o.lead_team_id) === team && trendMarketOf(o) === trendMarketOf(c) && o.trend_state === 'current');
    if (newerSame) { set(c, 'ended', `a later episode of the same run is current (${newerSame.id})`); continue; }
    set(c, 'current', `still material (${d.reason}); this pass did not rewrite it`);
  }
  return changes;
}

// ---------------------------------------------------------------------------------------------- novelty

/**
 * The fact a story reports, per desk — two stories with the same novelty key are the same news. Trends and injuries
 * use their episode logic instead (a key alone cannot express continuity); briefs are keyed by their source event id,
 * which is their generator id. Null when the desk has no fact key of its own.
 */
export const noveltyKey = (x) => {
  const game = (x?.entities || []).find((e) => e?.type === 'game')?.id ?? x?.context?.game?.game_id ?? null;
  switch (x?.kind) {
    case 'preview': return game ? `preview:${game}` : null;
    case 'result':
    case 'performance': return game ? `result:${game}` : null;
    case 'props': return game ? `props:${game}` : null;
    case 'market': return game ? `market:${game}` : null;
    case 'international': { const g = (x.entities || []).find((e) => e?.type === 'intl_game')?.id; return g ? `intl:${g}` : null; }
    default: return null;
  }
};

// Brief fact families: the same families the event registry (events.js factKey) treats as one event.
const BRIEF_FAMILY = (t) => (t === 'injury' || t === 'availability' ? 'injury' : laneOf(t) === 'roster' ? 'roster' : t === 'coaching' || t === 'front_office' || t === 'awards' ? t : null);
// Same window the event registry uses for "same fact key = same event" (events.js FACT_WINDOW_MS).
export const BRIEF_STORY_WINDOW_MS = 72 * 3600e3;

/**
 * Canonical story key for desks whose generator id is NOT stable (id drift), or null.
 *   transaction  team + transaction date. The generator id hashes the day's moves list, so a second move filed the
 *                same day minted a new id — and a new "new story" with a paid rewrite. One team, one day, one story.
 *   brief        event family + subject (player; the team for a coaching/front-office event with no player). The id
 *                hashes the source-wire cluster id, so a re-clustered event minted a new id. findPredecessor also
 *                requires the two briefs' event times to fall within BRIEF_STORY_WINDOW_MS, the registry's own
 *                same-event window. League-level briefs with no subject keep their cluster identity (null).
 * Computed from card fields (kind, lead ids, published_at, event_type) so stored cards need no migration.
 */
export function canonicalStoryKey(x) {
  if (x?.kind === 'transaction') {
    const day = String(x.published_at || '').slice(0, 10);
    return x.lead_team_id != null && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `transaction:${x.lead_team_id}:${day}` : null;
  }
  if (x?.kind === 'brief') {
    const fam = BRIEF_FAMILY(x.event_type || x.context?.brief?.event_type || null);
    if (!fam) return null;
    if (x.lead_player_id != null) return `brief:${fam}:player:${x.lead_player_id}`;
    if ((fam === 'coaching' || fam === 'front_office') && x.lead_team_id != null) return `brief:${fam}:team:${x.lead_team_id}`;
    return null;
  }
  return null;
}

/** The canonical card a duplicate points at. */
function canonicalOf(c, byId) {
  let x = c;
  for (let hops = 0; x?.duplicate_of && byId.has(x.duplicate_of) && hops < 8; hops += 1) x = byId.get(x.duplicate_of);
  return x;
}

/**
 * Deterministic, idempotent repair of a stored article index.
 * - every card gets an origin clock;
 * - legacy injury cards get their episode (read from the stored item when the card predates it);
 * - duplicate cards for one canonical event collapse onto one story: the most recently written
 *   member (current copy/URL) becomes canonical, and its first_published_at becomes the EARLIEST
 *   origin in the group. Taking the minimum is safe against poisoned values: a corrupted origin is
 *   always too late, never too early, so it can only lose.
 */
export async function repairIndex(index, { getItem = null } = {}) {
  const cards = (index || []).map((c) => ({ ...c }));
  const repairs = [];
  for (const c of cards) {
    if (!c.first_published_at && c.published_at) { c.first_published_at = c.published_at; repairs.push({ id: c.id, fix: 'origin_from_source_clock', to: c.published_at }); }
  }
  // Trend cards from before episodes existed: one episode per continuous run, collapsed by the grouping below.
  assignLegacyTrendEpisodes(cards, repairs);
  if (getItem) {
    for (const c of cards) {
      if (c.kind !== 'injury' || c.episode || !c.lead_player_id) continue;
      const item = await getItem(c.id).catch(() => null);
      const ep = injuryEpisode(item);
      if (ep) { c.episode = ep; repairs.push({ id: c.id, fix: 'episode_from_item', to: ep }); }
    }
  }
  const byId = new Map(cards.map((c) => [c.id, c]));

  const groups = [];
  // Injuries: per player, consecutive same-status cards form one event. A card the merge created as a
  // deliberate re-listing (relisted_after) always starts a new event.
  const perPlayer = new Map();
  for (const c of cards) {
    if (c.kind !== 'injury' || !c.lead_player_id || !c.episode || c.duplicate_of) continue;
    const k = String(c.lead_player_id);
    if (!perPlayer.has(k)) perPlayer.set(k, []);
    perPlayer.get(k).push(c);
  }
  for (const list of perPlayer.values()) {
    list.sort((x, y) => eventStart(x) - eventStart(y) || String(x.id).localeCompare(String(y.id)));
    let run = [];
    for (const c of list) {
      const prev = run[run.length - 1];
      if (prev && prev.episode === c.episode && !c.relisted_after) run.push(c);
      else { if (run.length) groups.push(run); run = [c]; }
    }
    if (run.length) groups.push(run);
  }
  const perTrend = new Map();
  for (const c of cards) {
    if (c.kind !== 'trend' || !c.story_key || c.duplicate_of) continue;
    if (!perTrend.has(c.story_key)) perTrend.set(c.story_key, []);
    perTrend.get(c.story_key).push(c);
  }
  groups.push(...perTrend.values());

  for (const members of groups) {
    const canonical = [...members].sort((x, y) => (ms(y.updated_at) ?? 0) - (ms(x.updated_at) ?? 0) || String(y.id).localeCompare(String(x.id)))[0];
    const attached = cards.filter((d) => d.duplicate_of && members.some((m) => m.id === d.duplicate_of));
    const origin = earliest([...members, ...attached].map((c) => c.first_published_at));
    for (const m of members) {
      if (m.id === canonical.id) continue;
      m.duplicate_of = canonical.id;
      repairs.push({ id: m.id, fix: 'collapsed_duplicate', to: canonical.id });
    }
    for (const d of attached) if (d.duplicate_of !== canonical.id) d.duplicate_of = canonical.id;
    if (origin && ms(origin) < ms(canonical.first_published_at)) {
      // The canonical copy was written after the story's origin, so that write was a revision.
      const revisedAt = latest([...members, ...attached].flatMap((c) => [c.revised_at, ms(c.first_published_at) > ms(origin) ? c.updated_at : null]));
      repairs.push({ id: canonical.id, fix: 'origin_restored', from: canonical.first_published_at, to: origin });
      canonical.first_published_at = origin;
      if (revisedAt && (!canonical.revised_at || ms(revisedAt) > ms(canonical.revised_at))) canonical.revised_at = revisedAt;
    }
  }
  for (const c of cards) if (c.duplicate_of) c.duplicate_of = canonicalOf(c, byId).id;
  return { cards, repairs };
}

/**
 * The stored story a freshly generated article continues, or null when it is a new material event.
 * `relistedAfter` names the previous event when the same status returns after a real gap.
 */
export function findPredecessor(a, cards, { now = Date.now() } = {}) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const direct = byId.has(a.id) ? canonicalOf(byId.get(a.id), byId) : null;
  if (a.kind === 'injury') {
    const ep = injuryEpisode(a);
    const mine = cards.filter((c) => c.kind === 'injury' && c.lead_player_id != null && String(c.lead_player_id) === String(a.lead_player_id) && !c.duplicate_of).sort(byOriginDesc);
    const current = mine[0];
    if (!current || !ep || current.episode !== ep) return { prev: direct && direct.episode === ep ? direct : null, relistedAfter: null };
    const ended = ms(current.listing_ended_at);
    if (ended !== null && now - ended >= RELIST_GAP_MS) return { prev: null, relistedAfter: current.id };
    return { prev: current, relistedAfter: null };
  }
  if (direct) return { prev: direct, relistedAfter: null };
  if (a.kind === 'trend') {
    // The episode this run continues: same team and market, not ended, sharing at least one game with the new window.
    const market = trendMarketOf(a);
    const win = trendWindowOf(a);
    const same = market && win.length ? cards.filter((c) => c.kind === 'trend' && !c.duplicate_of && String(c.lead_team_id) === String(a.lead_team_id) && trendMarketOf(c) === market && c.trend_state !== 'ended' && overlap(trendWindowOf(c, { stored: true }), win) >= TREND_MIN_OVERLAP)
      .sort((x, y) => (ms(y.updated_at) ?? 0) - (ms(x.updated_at) ?? 0) || String(y.id).localeCompare(String(x.id))) : [];
    return { prev: same[0] || null, relistedAfter: null };
  }
  // Canonical story key (id drift): a transaction or brief whose generator id moved but which reports the same canonical
  // story continues the stored card instead of minting a new story (and buying a new-story rewrite).
  const ck = canonicalStoryKey(a);
  if (ck) {
    const at = ms(a.published_at);
    const same = cards.filter((c) => !c.duplicate_of && c.id !== a.id && c.kind === a.kind && canonicalStoryKey(c) === ck
      && (a.kind !== 'brief' || (at !== null && ms(c.published_at) !== null && Math.abs(ms(c.published_at) - at) <= BRIEF_STORY_WINDOW_MS))).sort(byOriginDesc);
    if (same.length) return { prev: canonicalOf(same[same.length - 1], byId), relistedAfter: null, canonical: ck };
  }
  // Novelty gate: another stored story already reports this fact (same game preview/result, same market) — continue it.
  const nk = noveltyKey(a);
  if (nk) {
    const same = cards.filter((c) => !c.duplicate_of && c.id !== a.id && noveltyKey(c) === nk).sort(byOriginDesc);
    if (same.length) return { prev: canonicalOf(same[same.length - 1], byId), relistedAfter: null, novelty: nk };
  }
  return { prev: null, relistedAfter: null };
}

export const CROSS_KIND_WINDOW_MS = 48 * 3600e3;

/**
 * One event, one story, across generators. An official team announcement can reach the newsroom as a News Brief
 * minutes before ESPN's injury feed or transactions log produces the structured story for the same player. When
 * both exist, the brief collapses onto the structured story (the richer record), and that story inherits the
 * brief's earlier editorial origin — PropBetEdge first reported the event when the brief went live.
 * Idempotent; only briefs filed to the Injury Desk or Roster Moves with a named player are considered.
 */
export function collapseBriefsOntoStructured(cards, repairs = []) {
  const live = cards.filter((c) => !c.duplicate_of);
  for (const b of live) {
    if (b.kind !== 'brief' || !b.lead_player_id || !['injury', 'transaction'].includes(b.desk)) continue;
    const bt = ms(articleFirstPublishedAt(b));
    if (bt === null) continue;
    const pid = String(b.lead_player_id);
    const names = (c) => String(c.lead_player_id) === pid || (c.entities || []).some((e) => e?.type === 'player' && String(e.id) === pid);
    // Same event: published within the window of each other, or — for injuries — the structured story's listing is
    // still continuous on the feed (player + status while listed is one event, however long the absence runs).
    const sameEvent = (c) => Math.abs((ms(articleFirstPublishedAt(c)) ?? Infinity) - bt) <= CROSS_KIND_WINDOW_MS || (c.kind === 'injury' && !c.listing_ended_at && !c.superseded_by && (ms(articleFirstPublishedAt(c)) ?? Infinity) <= bt);
    const target = live
      .filter((c) => c.kind === b.desk && c.id !== b.id && !c.duplicate_of && names(c) && sameEvent(c))
      .sort((x, y) => (ms(articleFirstPublishedAt(x)) ?? 0) - (ms(articleFirstPublishedAt(y)) ?? 0))[0];
    if (!target) continue;
    b.duplicate_of = target.id;
    repairs.push({ id: b.id, fix: 'brief_collapsed_onto_structured', to: target.id });
    const tt = ms(articleFirstPublishedAt(target));
    if (tt !== null && bt < tt) {
      const revisedAt = latest([target.revised_at, target.updated_at, target.first_published_at]);
      repairs.push({ id: target.id, fix: 'origin_restored', from: target.first_published_at, to: b.first_published_at });
      target.first_published_at = b.first_published_at;
      if (revisedAt && ms(revisedAt) > bt) target.revised_at = revisedAt;
    }
  }
  return repairs;
}

/** Record whether each live injury listing is still on the feed. Only called with a successfully fetched feed. */
export function trackInjuryListings(cards, feed, at) {
  const onFeed = new Set((feed || []).filter((i) => i?.athlete_id).map((i) => `${i.athlete_id}|${String(i.status || '').toLowerCase()}`));
  for (const c of cards) {
    if (c.kind !== 'injury' || c.duplicate_of || !c.episode) continue;
    if (onFeed.has(c.episode)) { c.listing_seen_at = at; delete c.listing_ended_at; } else if (!c.listing_ended_at) c.listing_ended_at = at;
  }
}

/** Duplicates point at their canonical story; per player only the newest injury EVENT stays live. */
export function assignSupersession(cards) {
  const current = new Map();
  for (const c of cards) {
    if (c.kind !== 'injury' || !c.lead_player_id || c.duplicate_of) continue;
    const k = String(c.lead_player_id);
    if (!current.has(k) || byOriginDesc(c, current.get(k)) < 0) current.set(k, c);
  }
  for (const c of cards) {
    const top = c.kind === 'injury' && c.lead_player_id && !c.duplicate_of ? current.get(String(c.lead_player_id)) : null;
    if (c.duplicate_of) c.superseded_by = c.duplicate_of;
    else if (top && top.id !== c.id) c.superseded_by = top.id;
    else delete c.superseded_by;
  }
}

/**
 * Merge one pass of published articles into the stored index.
 * `articles` are finalized, gated, slugged articles; `feed` is the injury feed items array, or null
 * when the feed fetch failed (listing continuity is then left untouched).
 */
// Reader-facing card fields that must always equal the stored story. A card is a copy of its item; when a concurrent
// index writer (or any lost update) leaves an older copy behind, an unchanged or re-keyed pass restores it.
const DISPLAY_FIELDS = ['headline', 'deck', 'category', 'lead_player_id', 'lead_team_id', 'primary_subject', 'subject', 'entities'];
function displayDrift(prev, card) {
  return DISPLAY_FIELDS.filter((k) => card[k] !== undefined && JSON.stringify(prev[k]) !== JSON.stringify(card[k]));
}

export async function mergeArticles({ index, articles, started, now = Date.parse(started), feed = null, getItem = null, putItem, versionOf, cardOf, retainDays = 90, cap = 400 }) {
  const { cards, repairs } = await repairIndex(index, { getItem });
  const byId = new Map(cards.map((c) => [c.id, c]));
  const events = [];
  let written = 0;
  // Novelty ledger for this pass: every generated article is exactly one of these. Only `new_story` mints an article.
  const novelty = { new_story: 0, revision: 0, unchanged: 0, rekeyed: 0 };

  for (const a of articles) {
    const { prev, relistedAfter } = findPredecessor(a, [...byId.values()], { now });
    if (prev && prev.id !== a.id) a.id = prev.id;
    // The change key includes the story's charts (ids + plotted-value hashes): a card whose item lacks the charts the
    // current draft carries can never pass as unchanged.
    const visualKey = (a.visuals || []).map((v) => `${v.id}:${v.values_hash}`).join(',');
    const inHash = `${versionOf(a)}|${a.input_hash || ''}|${a.headline}|${a.deck}${visualKey ? `|v:${visualKey}` : ''}`;
    const iKey = injuryIdentity(a);
    // A continuing trend keeps its episode; only a trend with no live predecessor opens one.
    const storyKey = a.kind === 'trend' ? (prev && isEpisodeKey(prev.story_key) ? prev.story_key : trendKey(a)) : null;
    const trendFields = a.kind === 'trend' ? { market_type: trendMarketOf(a), trend_window: trendWindowOf(a).join(',') } : {};
    const lifecycle = { ...(iKey ? { injury_key: iKey } : {}), ...(storyKey ? { story_key: storyKey } : {}), ...trendFields };
    // Editorial origin is inherited, never re-stamped: a predecessor's (already repaired) origin wins.
    const firstPublished = prev ? articleFirstPublishedAt(prev) || started : started;

    if (prev && prev.input_hash === inHash) {
      // Unchanged story: no rewrite, no revision stamp. Card-only routing metadata added after it was written (its
      // newsroom desk) is filled in so the desks are complete without faking an update.
      const card = cardOf(a);
      const drift = displayDrift(prev, card);
      if (drift.length) repairs.push({ id: prev.id, repair: 'card_display_drift', fields: drift });
      byId.set(prev.id, { ...prev, ...Object.fromEntries(drift.map((k) => [k, card[k]])), first_published_at: firstPublished, ...lifecycle, ...(a.depth?.class && !prev.depth_class ? { depth_class: a.depth.class } : {}), ...(prev.desk === undefined && card.desk !== undefined ? { desk: card.desk, event_type: card.event_type ?? null } : {}) });
      novelty.unchanged += 1;
      continue;
    }
    // A changed input key with nothing a reader or the record would see differently (same body, headline, deck, facts and
    // source observation) is not a revision: re-key the card, keep the stored version.
    if (prev && getItem) {
      const stored = await getItem(prev.id).catch(() => null);
      // Visuals (their plotted-value hashes and section placement) are part of what a reader sees: a pass that adds or
      // changes a chart is a revision, never a silent re-key.
      const visualsOf = (x) => JSON.stringify([(x.visuals || []).map((v) => [v.id, v.values_hash]), (x.sections || []).map((sec) => sec.visuals || null)]);
      if (stored && JSON.stringify(stored.body) === JSON.stringify(a.body) && stored.headline === a.headline && stored.deck === a.deck && visualsOf(stored) === visualsOf(a) && sharedFactsUnchanged(stored, a) && (stored.provenance?.source_observed_at || null) === (a.provenance?.source_observed_at || null)) {
        const card = cardOf(a);
        const drift = displayDrift(prev, card);
        if (drift.length) repairs.push({ id: prev.id, repair: 'card_display_drift', fields: drift });
        byId.set(prev.id, { ...prev, ...Object.fromEntries(drift.map((k) => [k, card[k]])), input_hash: inHash, first_published_at: firstPublished, ...lifecycle });
        novelty.rekeyed += 1;
        continue;
      }
    }
    if (prev?.slug) a.slug = prev.slug; // a story keeps its URL when a revision rewrites its headline
    // The version goes live at the merge, which is never earlier than the moment it was generated (provenance:
    // source_observed_at ≤ generated_at ≤ published/revised). The run start can precede a late generation cutoff.
    const liveAt = latest([started, a.provenance?.generated_at]) || started;
    a.first_published_at = prev ? firstPublished : latest([firstPublished, liveAt]);
    a.revised_at = prev ? liveAt : null;
    // Revision history survives every rewrite. A regeneration by a better generator is an editorial upgrade, not a
    // correction; a change of timestamp semantics is recorded separately as a metadata correction.
    const history = [...(prev?.revisions || [])];
    if (prev) {
      if (a.provenance && !prev.provenance_contract) history.push({ at: liveAt, kind: 'metadata_correction', note: 'Source time now records when the source record was observed; the earlier version showed an estimated event time.' });
      const prevItem = getItem ? await getItem(prev.id).catch(() => null) : null;
      history.push({ at: liveAt, ...revisionKind(a, prev, versionOf(a), prevItem), generator: versionOf(a), ...(a.depth?.class ? { depth_class: a.depth.class } : {}) });
    }
    a.revisions = history.slice(-20);
    await putItem(a);
    byId.set(a.id, {
      ...cardOf(a),
      input_hash: inHash,
      first_published_at: a.first_published_at,
      revised_at: a.revised_at,
      revisions: a.revisions,
      facts_digest: factsDigest(a),
      ...(a.depth?.class ? { depth_class: a.depth.class } : {}),
      ...(a.provenance ? { provenance_contract: 'v1' } : {}),
      ...lifecycle,
      ...(prev?.listing_seen_at ? { listing_seen_at: prev.listing_seen_at } : {}),
      // Trend lifecycle state is owned by the trend desk pass (applyTrendDecisions); a rewrite never resets it.
      ...(prev?.trend_state ? { trend_state: prev.trend_state, trend_state_reason: prev.trend_state_reason, trend_state_at: prev.trend_state_at } : {}),
      ...(relistedAfter ? { relisted_after: relistedAfter } : {})
    });
    events.push({ id: a.id, kind: a.kind, event: prev ? 'revision' : relistedAfter ? 'new_event_relisted' : 'new_story', first_published_at: a.first_published_at });
    novelty[prev ? 'revision' : 'new_story'] += 1;
    written += 1;
  }

  const all = [...byId.values()];
  collapseBriefsOntoStructured(all, repairs);
  if (Array.isArray(feed)) trackInjuryListings(all, feed, started);
  assignSupersession(all);

  // Retire by the newest evidence a story still has (source clock, revision, or a listing still on the
  // feed) so a season-long listing is never retired and then re-created as a "new" story.
  const cutoff = now - retainDays * 86400e3;
  const alive = (c) => Math.max(ms(c.published_at) ?? 0, ms(c.revised_at) ?? 0, ms(c.listing_seen_at) ?? 0) > cutoff;
  const kept = all.filter(alive);
  const keptIds = new Set(kept.map((c) => c.id));
  const next = kept.filter((c) => !c.duplicate_of || keptIds.has(c.duplicate_of)).sort(byOriginDesc).slice(0, cap);
  return { index: next, written, repairs, events, novelty };
}
