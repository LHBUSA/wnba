// Persisted, fact-based event registry for the WNBA source wire — wnba-events/1.0.0.
//
// ONE canonical event per real-world event, with an id that never changes once minted.
//
// v1 recomputed clusters from scratch every run and named each cluster after its earliest member
// (`c_<item id>`). Adding a source whose report predates the current earliest member silently renamed the
// cluster — and every brief keyed to it became a "new" story. The registry fixes identity at the moment an event
// is first seen and stores it (KV `news:v1:events`): later reports join the existing event; they never rename it.
//
// Matching, in order (never keyed to a provider article id):
//   1. fact key — the facts of the event: roster move / injury / availability + the linked player set;
//      coaching / front-office + team. Same fact key within FACT_WINDOW_MS of the event's latest report = same
//      event, even from the same publisher (a team's "injury update" after its first announcement).
//   2. shared linked player + compatible lane + headline overlap (Jaccard ≥ 0.2), cross-publisher, within 48h.
//   3. headline Jaccard ≥ 0.55, cross-publisher, within 48h; or, for league-level events with no linked player,
//      the same specific event type and stemmed headline Jaccard ≥ 0.4 ("WNBA releases 2026 playoff schedule" /
//      "WNBA playoffs schedule 2026: dates released").
// A different fact (a new status, a different player, a roster move after an injury) is a new event.

import { tokens, jaccard } from './editorial.js';
import { laneOf, legacyType, eventMateriality } from './taxonomy.js';

export const EVENTS_VERSION = 'wnba-events/1.0.0';
export const FACT_WINDOW_MS = 72 * 3600e3;
export const SIMILAR_WINDOW_MS = 48 * 3600e3;

const ms = (x) => { const v = Date.parse(x || ''); return Number.isFinite(v) ? v : null; };
const ids = (ents, type) => [...new Set((ents || []).filter((e) => e?.type === type && e.id != null).map((e) => String(e.id)))].sort();
const GENERIC = new Set(['news', 'result', 'performance', 'preview', 'market', 'record', 'lineup']);

// Light stemming for league-level headline matching ("releases"/"released", "playoffs"/"playoff", "dates"/"date").
const stems = (headline) => new Set([...tokens(headline)].map((w) => w.replace(/(ing|ed|es|s)$/, '')).filter((w) => w.length > 2));

const withoutNames = (tk, it) => {
  const names = new Set(['wnba', ...(it.entities || []).flatMap((e) => [...tokens(e?.name || '')])]);
  return new Set([...tk].filter((w) => !names.has(w)));
};

/** The fact key of an item, or null when the item carries no verifiable fact identity. */
export function factKey(item) {
  const t = item.event_type;
  const players = ids(item.entities, 'player');
  const teams = ids(item.entities, 'team');
  const lane = laneOf(t);
  if (lane === 'roster' && players.length) return `roster:${players.join('+')}`;
  if ((t === 'injury' || t === 'availability') && players.length) return `${t}:${players.join('+')}`;
  if ((t === 'coaching' || t === 'front_office') && teams.length === 1) return `${t}:team:${teams[0]}`;
  if (t === 'awards' && players.length) return `awards:${players.join('+')}`;
  return null;
}

export function emptyRegistry() {
  return { version: EVENTS_VERSION, events: {}, item_event: {} };
}

/** Seed a registry from v1 clusters so every existing event (and the brief keyed to it) keeps its id. */
export function seedFromClusters(clusters, itemsById) {
  const reg = emptyRegistry();
  for (const c of clusters || []) {
    const members = (c.members || []).map((id) => itemsById[id]).filter(Boolean);
    if (!members.length) continue;
    const ev = newEvent(c.cluster_id, members[0]);
    for (const m of members) attach(ev, m);
    reg.events[ev.event_id] = ev;
    for (const m of members) reg.item_event[m.item_id] = ev.event_id;
  }
  return reg;
}

function newEvent(event_id, it) {
  return { event_id, event_type: it.event_type || 'news', fact_keys: [], players: [], teams: [], first_published_at: it.published_at, last_published_at: it.published_at, first_seen_at: it.first_captured_at || it.published_at, members: [] };
}

function attach(ev, it) {
  if (!ev.members.some((m) => m.item_id === it.item_id)) ev.members.push({ item_id: it.item_id, source_id: it.source_id, headline: String(it.headline || '').slice(0, 200), published_at: it.published_at, event_type: it.event_type || null });
  const fk = factKey(it);
  if (fk && !ev.fact_keys.includes(fk)) ev.fact_keys.push(fk);
  ev.players = [...new Set([...ev.players, ...ids(it.entities, 'player')])].sort();
  ev.teams = [...new Set([...ev.teams, ...ids(it.entities, 'team')])].sort();
  if (ms(it.published_at) !== null && (ms(ev.first_published_at) === null || ms(it.published_at) < ms(ev.first_published_at))) ev.first_published_at = it.published_at;
  if (ms(it.published_at) !== null && (ms(ev.last_published_at) === null || ms(it.published_at) > ms(ev.last_published_at))) ev.last_published_at = it.published_at;
  // A specific event type beats a generic one ("news" corroboration never downgrades "signing").
  if (GENERIC.has(ev.event_type) && it.event_type && !GENERIC.has(it.event_type)) ev.event_type = it.event_type;
}

const compatible = (a, b) => a === b || GENERIC.has(a) || GENERIC.has(b) || laneOf(a) === laneOf(b);

function candidate(it, events) {
  const t = ms(it.published_at) ?? 0;
  const fk = factKey(it);
  const tk = tokens(it.headline);
  const players = ids(it.entities, 'player');
  let best = null;
  for (const ev of events) {
    const last = ms(ev.last_published_at) ?? 0;
    const first = ms(ev.first_published_at) ?? 0;
    // 1. Same facts: same event (same publisher allowed).
    if (fk && ev.fact_keys.includes(fk) && t - last <= FACT_WINDOW_MS && last - t <= FACT_WINDOW_MS) return { ev, rule: 'fact_key' };
    if (Math.abs(t - first) > SIMILAR_WINDOW_MS && Math.abs(t - last) > SIMILAR_WINDOW_MS) continue;
    const crossPublisher = !ev.members.some((m) => m.source_id === it.source_id);
    if (!crossPublisher) continue;
    // Two different facts are two events, however similar the words.
    const evFactLanes = new Set(ev.fact_keys.map((k) => k.split(':')[0]));
    if (fk && evFactLanes.has(fk.split(':')[0]) && !ev.fact_keys.includes(fk)) continue;
    const jac = Math.max(0, ...ev.members.map((m) => jaccard(tk, tokens(m.headline))));
    // League-level events carry no player to key on: the same specific event type plus stemmed headline overlap.
    const sameTypeNoFacts = !fk && !players.length && !GENERIC.has(it.event_type) && it.event_type === ev.event_type && !ev.fact_keys.length
      ? Math.max(0, ...ev.members.map((m) => jaccard(stems(it.headline), stems(m.headline))))
      : 0;
    const shared = players.length && players.some((p) => ev.players.includes(p));
    // A shared player is not a shared event: the overlap that counts is what the headlines say beyond the names
    // ("Reese named Player of the Week" and "Reese breaks WNBA record" share only "angel reese wnba").
    const topical = shared ? Math.max(0, ...ev.members.map((m) => jaccard(withoutNames(tk, it), withoutNames(tokens(m.headline), it)))) : 0;
    const score = shared && compatible(it.event_type, ev.event_type) && topical >= 0.2 ? 1 + topical : jac >= 0.55 ? jac : sameTypeNoFacts >= 0.4 ? sameTypeNoFacts : 0;
    if (score && (!best || score > best.score)) best = { ev, rule: shared ? 'shared_player' : jac >= 0.55 ? 'headline' : 'same_type_headline', score };
  }
  return best;
}

/**
 * Assign every item to a persisted event. Mutates nothing it is given; returns the next registry, clusters in the
 * v1 shape (so the feed, briefs and Supabase rows keep working) and what changed this run.
 */
export function assignEvents(items, registry, { keepMs = 21 * 86400e3, now = Date.now() } = {}) {
  const reg = registry?.version === EVENTS_VERSION ? structuredClone(registry) : emptyRegistry();
  const created = [];
  const joined = [];
  const sorted = [...items].sort((a, b) => String(a.published_at).localeCompare(String(b.published_at)) || String(a.item_id).localeCompare(String(b.item_id)));
  for (const it of sorted) {
    const known = reg.item_event[it.item_id];
    if (known && reg.events[known]) { attach(reg.events[known], it); continue; }
    const hit = candidate(it, Object.values(reg.events));
    if (hit) {
      attach(hit.ev, it);
      reg.item_event[it.item_id] = hit.ev.event_id;
      joined.push({ item_id: it.item_id, event_id: hit.ev.event_id, rule: hit.rule });
      continue;
    }
    let id = `c_${it.item_id}`;
    for (let n = 2; reg.events[id]; n += 1) id = `c_${it.item_id}_${n}`;
    const ev = newEvent(id, it);
    attach(ev, it);
    reg.events[id] = ev;
    reg.item_event[it.item_id] = id;
    created.push({ item_id: it.item_id, event_id: id, event_type: ev.event_type });
  }
  // Retention: an event leaves when its newest report is outside the window; its item mappings go with it.
  const present = new Set(items.map((i) => i.item_id));
  for (const [id, ev] of Object.entries(reg.events)) {
    ev.members = ev.members.filter((m) => present.has(m.item_id) || (ms(m.published_at) ?? 0) > now - keepMs);
    if (!ev.members.length || (ms(ev.last_published_at) ?? 0) < now - keepMs) delete reg.events[id];
  }
  for (const [itemId, evId] of Object.entries(reg.item_event)) if (!reg.events[evId]) delete reg.item_event[itemId];
  return { registry: reg, clusters: clustersOf(reg, items), created, joined };
}

/** v1-shaped clusters over the items currently stored. Canonical = earliest report; an official source wins. */
export function clustersOf(reg, items) {
  const byId = new Map(items.map((i) => [i.item_id, i]));
  const out = [];
  for (const ev of Object.values(reg.events)) {
    const members = ev.members.map((m) => byId.get(m.item_id)).filter(Boolean);
    if (!members.length) continue;
    const ordered = [...members].sort((a, b) => String(a.published_at).localeCompare(String(b.published_at)));
    const official = [...members].sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || String(a.published_at).localeCompare(String(b.published_at)))[0];
    const canon = official.priority === 1 ? official : ordered[0];
    const m = eventMateriality(members);
    out.push({
      cluster_id: ev.event_id,
      canonical_item_id: canon.item_id,
      headline: canon.headline,
      story_type: legacyType(ev.event_type),
      event_type: ev.event_type,
      lane: laneOf(ev.event_type),
      fact_keys: ev.fact_keys,
      first_seen_at: ev.first_published_at,
      last_report_at: ev.last_published_at,
      item_count: members.length,
      publishers: new Set(members.map((x) => x.source_id)).size,
      materiality: m ? { score: m.score, level: m.level, material: m.material } : null,
      members: members.map((x) => x.item_id)
    });
  }
  return out.sort((a, b) => String(b.first_seen_at).localeCompare(String(a.first_seen_at)));
}
