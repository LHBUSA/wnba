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
//   trend   team + the exact game window the trend measures. The same ten games re-run on a new
//           day is a revision, not a new story.
//   others  the generator id (game id, brief cluster id, transaction date+moves) is already stable.

export const RELIST_GAP_MS = 12 * 3600e3;

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

/** `trend:team:gameIds` — for a generated article (raw input_hash) or a stored card (story_key, else legacy input_hash). */
export const trendKey = (x, { stored = false } = {}) => {
  if (x?.kind !== 'trend' || !x?.lead_team_id) return null;
  if (x.story_key) return x.story_key;
  const window = stored ? String(x.input_hash || '').split('|')[1] : x.input_hash;
  return window ? `trend:${x.lead_team_id}:${window}` : null;
};

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
    if (c.kind === 'trend' && !c.story_key) { const k = trendKey(c, { stored: true }); if (k) c.story_key = k; }
  }
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
    const key = trendKey(a);
    const same = key ? cards.filter((c) => c.kind === 'trend' && c.story_key === key && !c.duplicate_of).sort((x, y) => (ms(y.updated_at) ?? 0) - (ms(x.updated_at) ?? 0)) : [];
    return { prev: same[0] || null, relistedAfter: null };
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
export async function mergeArticles({ index, articles, started, now = Date.parse(started), feed = null, getItem = null, putItem, versionOf, cardOf, retainDays = 90, cap = 400 }) {
  const { cards, repairs } = await repairIndex(index, { getItem });
  const byId = new Map(cards.map((c) => [c.id, c]));
  const events = [];
  let written = 0;

  for (const a of articles) {
    const { prev, relistedAfter } = findPredecessor(a, [...byId.values()], { now });
    if (prev && prev.id !== a.id) a.id = prev.id;
    const inHash = `${versionOf(a)}|${a.input_hash || ''}|${a.headline}|${a.deck}`;
    const iKey = injuryIdentity(a);
    const storyKey = a.kind === 'trend' ? trendKey(a) : null;
    const lifecycle = { ...(iKey ? { injury_key: iKey } : {}), ...(storyKey ? { story_key: storyKey } : {}) };
    // Editorial origin is inherited, never re-stamped: a predecessor's (already repaired) origin wins.
    const firstPublished = prev ? articleFirstPublishedAt(prev) || started : started;

    if (prev && prev.input_hash === inHash) {
      // Unchanged story: no rewrite, no revision stamp. Card-only routing metadata added after it was written (its
      // newsroom desk) is filled in so the desks are complete without faking an update.
      const card = cardOf(a);
      byId.set(prev.id, { ...prev, first_published_at: firstPublished, ...lifecycle, ...(prev.desk === undefined && card.desk !== undefined ? { desk: card.desk, event_type: card.event_type ?? null } : {}) });
      continue;
    }
    if (prev?.slug) a.slug = prev.slug; // a story keeps its URL when a revision rewrites its headline
    a.first_published_at = firstPublished;
    a.revised_at = prev ? started : null;
    // Revision history survives every rewrite. A regeneration by a better generator is an editorial upgrade, not a
    // correction; a change of timestamp semantics is recorded separately as a metadata correction.
    const history = [...(prev?.revisions || [])];
    if (prev) {
      if (a.provenance && !prev.provenance_contract) history.push({ at: started, kind: 'metadata_correction', note: 'Source time now records when the source record was observed; the earlier version showed an estimated event time.' });
      history.push({ at: started, kind: a.context?.regeneration === 'editorial_upgrade' ? 'editorial_upgrade' : 'data_update', generator: versionOf(a) });
    }
    a.revisions = history.slice(-20);
    await putItem(a);
    byId.set(a.id, {
      ...cardOf(a),
      input_hash: inHash,
      first_published_at: a.first_published_at,
      revised_at: a.revised_at,
      revisions: a.revisions,
      ...(a.provenance ? { provenance_contract: 'v1' } : {}),
      ...lifecycle,
      ...(prev?.listing_seen_at ? { listing_seen_at: prev.listing_seen_at } : {}),
      ...(relistedAfter ? { relisted_after: relistedAfter } : {})
    });
    events.push({ id: a.id, kind: a.kind, event: prev ? 'revision' : relistedAfter ? 'new_event_relisted' : 'new_story', first_published_at: a.first_published_at });
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
  return { index: next, written, repairs, events };
}
