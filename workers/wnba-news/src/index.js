// wnba-news — PropBetEdge WNBA independent newsroom lane (Cloudflare Worker + Cron).
//
// sources -> Cloudflare ingest -> normalized candidate -> relevance gate ->
// entity linking -> dedupe clusters -> (PBE Desk stories from structured records)
// -> KV edge store + Supabase (when bound) -> GET /v1/news -> frontend.
//
// Independent of NBA and of wnba-api's uptime: external news keeps flowing if
// wnba-api is down (entity dictionary falls back to its last good copy; Desk
// stories pause). Its own KV namespace, its own deploy, its own cron.

import { NEWS_SOURCES, PBE_SOURCE, AUDITED_NOT_INGESTED, SOURCE_REGISTRY_VERSION, publicItem, withheldBySourcePolicy } from './sources.js';
import { listedCard } from './legacy.js';
import { PARSE_VERSION } from './parse.js';
import { buildDictionary, EDITORIAL_VERSION } from './editorial.js';
import { classify, TAXONOMY_VERSION, LANES, EVENT_TYPES } from './taxonomy.js';
import { normalizeItem, KEEP_DAYS } from './ingest.js';
import { assignEvents, seedFromClusters, EVENTS_VERSION } from './events.js';
import { fetchSource, updateHealth, pool, UA, FETCH_VERSION } from './fetcher.js';
import { DESK_VERSION } from './pbe-desk.js';
import { runArticles } from './articles-run.js';
import { BRIEF_MAX_AGE_MS } from './briefs.js';
import { ARTICLE_VERSION } from './articles.js';
import { mediaFor, winbaPodium, winbaBoardMedia, MEDIA_MANIFEST_AT } from './media.js';
import videoChannels from '../../../data/video-channels.json';
import { runWinbaPasses } from './winba-run.js';
import { runCommissionPass } from './commission-run.js';
import { runVideoPass, servedVideo, allowedChannels, VIDEO_VERSION, VIDEO_PASS_MINUTES } from './video.js';

const SERVICE = 'wnba-news';
const VERSION = '2.0.0';
export const CRON_MINUTES = 5;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      // A slow pass must not overlap the next five-minute tick and race it on the same KV keys.
      const lease = await env.NEWS_KV.get('news:v1:lease', 'json');
      if (lease?.at && Date.now() - Date.parse(lease.at) < 4 * 60e3) return;
      await env.NEWS_KV.put('news:v1:lease', JSON.stringify({ at: new Date().toISOString() }), { expirationTtl: 600 });
      try { await runIngest(env, 'cron'); } finally { await env.NEWS_KV.delete('news:v1:lease'); }
    })());
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (path === '/health') return health(env);
    if (path === '/v1/news') return feed(env, url);
    if (path === '/v1/news/sources') return sourcesRoute(env);
    if (path === '/v1/news/runs') return runsRoute(env);
    if (path === '/v1/articles') return articlesRoute(env, url);
    if (path === '/v1/articles/held') return heldRoute(env);
    if (path === '/v1/articles/videos') return videosRoute(env);
    const am = path.match(/^\/v1\/articles\/([a-z0-9-]{6,120})$/);
    if (am) return articleRoute(env, am[1]);
    const m = path.match(/^\/v1\/news\/story\/(pbe_[a-f0-9]{18})$/);
    if (m) return storyRoute(env, m[1]);
    if (path === '/run' && request.method === 'POST') {
      if (!env.ADMIN_TOKEN || request.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`) return j({ ok: false, error: 'unauthorized' }, 401);
      if (url.searchParams.get('video') === 'force') return j({ ok: true, result: await runVideoPass(env, { channelsDoc: videoChannels, teams: ((await env.NEWS_KV.get('dict:v1', 'json')) || {}).teams || [], intlGet: env.INTL ? (p) => intlGet(env, p) : null, force: true }) });
      return j({ ok: true, result: await runIngest(env, 'manual', { forceArticles: url.searchParams.get('articles') === 'force' || url.searchParams.get('backfill') === 'international', backfillInternational: url.searchParams.get('backfill') === 'international', forceWinba: url.searchParams.get('winba') === 'force', winbaPeriod: url.searchParams.get('winba_period') || null, winbaRefreeze: url.searchParams.get('winba_refreeze') === '1', winbaBackfill: url.searchParams.get('winba_backfill') === '1', winbaAcceptRankCorrection: url.searchParams.get('winba_accept_rank_correction') === '1', winbaFixCopy: url.searchParams.get('winba_fix_copy') === '1', winbaFixFrozenAt: url.searchParams.get('winba_fix_frozen_at') === '1', commission: url.searchParams.get('commission') || null, commissionForce: url.searchParams.get('commission_force') === '1' }) });
    }
    return j({ ok: false, error: 'not_found', routes: ['/health', '/v1/articles', '/v1/articles/:slug', '/v1/articles/held', '/v1/articles/videos', '/v1/news (external source wire)', '/v1/news/sources', '/v1/news/runs'] }, 404);
  }
};

// ---------------------------------------------------------------- ingest

async function apiGet(env, path) {
  if (!env.API) throw new Error('api_binding_missing');
  const res = await env.API.fetch(`https://wnba-api.internal${path}`, { headers: { 'user-agent': UA } });
  const body = await res.json();
  if (!body?.ok) throw new Error(`api_${path}_${body?.error?.code || res.status}`);
  return body.data;
}

async function intlGet(env, path) {
  const res = await env.INTL.fetch(`https://wnba-international.internal${path}`, { headers: { 'user-agent': UA } });
  const body = await res.json();
  if (!body?.ok) throw new Error(`intl_${path}_${body?.error?.code || res.status}`);
  return body.data;
}

async function dictionary(env) {
  try {
    const d = await apiGet(env, '/v1/players');
    const teams = [];
    const seen = new Set();
    for (const p of d.players) if (p.team && !seen.has(p.team.team_id)) { seen.add(p.team.team_id); teams.push(p.team); }
    const dict = { captured_at: new Date().toISOString(), players: d.players.map((p) => ({
      athlete_id: p.athlete_id, name: p.name, team_id: p.team_id,
      // The WinBA Index names positional leaders and first-season players, so
      // the dictionary carries both. Absent values stay absent, never 0.
      position: p.position ?? null,
      experience_years: p.experience_years ?? null
    })), teams };
    await env.NEWS_KV.put('dict:v1', JSON.stringify(dict));
    return { dict, fresh: true };
  } catch (e) {
    const last = await env.NEWS_KV.get('dict:v1', 'json');
    if (last) return { dict: last, fresh: false, error: e.message };
    throw new Error(`no_entity_dictionary:${e.message}`);
  }
}

async function runIngest(env, trigger, { forceArticles = false, backfillInternational = false, forceWinba = false, winbaPeriod = null, winbaRefreeze = false, winbaBackfill = false, winbaAcceptRankCorrection = false, winbaFixCopy = false, winbaFixFrozenAt = false, commission = null, commissionForce = false } = {}) {
  const startedAt = new Date().toISOString();
  const now = Date.parse(startedAt);
  const { dict: rawDict, fresh: dictFresh, error: dictError } = await dictionary(env);
  const dict = buildDictionary(rawDict);
  const [storeRaw, intlRaw, validatorsRaw, healthRaw, registryRaw, legacyClusters] = await Promise.all([
    env.NEWS_KV.get('news:v1:items', 'json'),
    // International lane: national-team / FIBA / Olympic items. The WNBA relevance guard is unchanged — these items
    // do not enter the WNBA feed unless they already qualify — but they are kept, attributed, for the international desk.
    env.NEWS_KV.get('news:v1:intl-items', 'json'),
    env.NEWS_KV.get('news:v1:http', 'json'),
    env.NEWS_KV.get('news:v1:source-health', 'json'),
    env.NEWS_KV.get('news:v1:events', 'json'),
    env.NEWS_KV.get('news:v1:clusters', 'json')
  ]);
  const store = storeRaw || {};
  const intlStore = intlRaw || {};
  const validators = validatorsRaw || {};
  const health = healthRaw || {};
  const runs = [];

  // Fetch every source in parallel (bounded); each is isolated, so one slow or failing publisher costs only itself.
  const fetched = await pool(NEWS_SOURCES, 8, (src) => fetchSource(src, { validators: validators[src.source_id], now }));
  const touched = new Map();

  for (let i = 0; i < NEWS_SOURCES.length; i += 1) {
    const src = NEWS_SOURCES[i];
    const f = fetched[i];
    const run = { source_id: src.source_id, at: startedAt, status: f.status, http_status: f.http_status, ms: f.ms, fetched: f.items.length, accepted: 0, new: 0, duplicates_url: 0, rejected: 0, rejected_samples: [], parse_errors: f.parse_errors || 0, ...(f.error ? { error: f.error } : {}), ...(f.reason ? { reason: f.reason } : {}) };
    if (f.validators) validators[src.source_id] = f.validators;
    const tq = { publisher: 0, date_only: 0, capture: 0 };
    for (const raw of f.items) {
      const n = await normalizeItem(raw, src, dict, { startedAt, now });
      if (n.reject) { if (n.reject === 'outside_window') run.outside_window = (run.outside_window || 0) + 1; else run.rejected += 1; continue; }
      const { id, rel } = n;
      const prev = store[id] || intlStore[id] || null;
      const record = { ...n.record, published_at: raw.published_at || prev?.published_at || startedAt, first_captured_at: prev?.first_captured_at || startedAt };
      tq[record.timestamp_quality] += 1;
      if (!run.latest_item_at || record.published_at > run.latest_item_at) run.latest_item_at = record.published_at;
      if (n.international) {
        intlStore[id] = { ...record, lane: 'international', wnba_accepted: rel.accept };
        run.international = (run.international || 0) + 1;
      }
      if (!rel.accept) {
        run.rejected += 1;
        // A rule change can un-accept an item we stored earlier; it leaves the feed.
        if (store[id]) { delete store[id]; run.withdrawn = (run.withdrawn || 0) + 1; }
        if (run.rejected_samples.length < 6) run.rejected_samples.push({ headline: raw.headline, reasons: rel.reasons });
        continue;
      }
      run.accepted += 1;
      if (store[id]) run.duplicates_url += 1; else run.new += 1;
      store[id] = record;
      touched.set(id, run);
    }
    run.timestamp_quality = tq;
    runs.push(run);
  }

  // Classify stored items whose type/materiality predates the current taxonomy version (v1 items, or items that
  // have dropped off their feed since a rule change), so every event is scored by the same rules.
  const srcById = new Map(NEWS_SOURCES.map((s) => [s.source_id, s]));
  for (const it of Object.values(store)) {
    if (it.event_type && it.materiality && it.taxonomy === TAXONOMY_VERSION) continue;
    const tax = classify(it, { entities: it.entities || [], source: srcById.get(it.source_id) || { priority: it.priority }, timestampQuality: it.timestamp_quality || 'publisher' });
    Object.assign(it, { event_type: tax.event_type, lane: tax.lane, story_type: tax.story_type, materiality: tax.materiality, taxonomy: TAXONOMY_VERSION, timestamp_quality: it.timestamp_quality || 'publisher' });
  }

  // Retention window, then persisted fact-based event identity over what remains.
  const cutoff = now - KEEP_DAYS * 86400e3;
  for (const [k, v] of Object.entries(store)) if (Date.parse(v.published_at) < cutoff) delete store[k];
  for (const [k, v] of Object.entries(intlStore)) if (Date.parse(v.published_at) < cutoff) delete intlStore[k];
  const list = Object.values(store);
  const byId = Object.fromEntries(list.map((x) => [x.item_id, x]));
  // First run on the registry: v1 clusters seed it, so every existing event — and the brief keyed to it — keeps its id.
  const registryIn = registryRaw || (legacyClusters ? seedFromClusters(legacyClusters, byId) : null);
  const { registry, clusters, created, joined } = assignEvents(list, registryIn, { now, keepMs: KEEP_DAYS * 86400e3 });
  for (const c of clusters) for (const m of c.members) if (byId[m]) byId[m].cluster_id = c.cluster_id;
  const clusterById = new Map(clusters.map((c) => [c.cluster_id, c]));
  for (const e of created) { const r = touched.get(e.item_id); if (r) r.new_events = (r.new_events || 0) + 1; }
  for (const e of joined) { const r = touched.get(e.item_id); if (r) r.joined_events = (r.joined_events || 0) + 1; }

  for (const run of runs) health[run.source_id] = updateHealth(health[run.source_id], srcById.get(run.source_id), run, { now, cronMinutes: CRON_MINUTES });

  await Promise.all([
    env.NEWS_KV.put('news:v1:intl-items', JSON.stringify(intlStore)),
    env.NEWS_KV.put('news:v1:items', JSON.stringify(store)),
    env.NEWS_KV.put('news:v1:clusters', JSON.stringify(clusters)),
    env.NEWS_KV.put('news:v1:events', JSON.stringify(registry)),
    env.NEWS_KV.put('news:v1:http', JSON.stringify(validators)),
    env.NEWS_KV.put('news:v1:source-health', JSON.stringify(health))
  ]);

  // Breaking path: a new material roster/injury/league event from an official source (or corroborated high
  // materiality) runs the article pass now instead of waiting for the regular ten-minute article cadence.
  const breaking = created
    .map((e) => clusterById.get(e.event_id))
    // Only a fresh event can be breaking: a backlog post surfaced by a newly added source never triggers a pass.
    // Only sources cleared for public use can trigger it (sources under policy review never create stories).
    .filter((c) => c?.materiality?.material && now - Date.parse(c.first_seen_at) <= BRIEF_MAX_AGE_MS && ['roster', 'injuries', 'league'].includes(c.lane) && c.materiality.level === 'high' && c.members.some((m) => byId[m] && publicItem(byId[m])))
    .map((c) => ({ event_id: c.cluster_id, event_type: c.event_type, headline: c.headline }));

  // PropBetEdge newsroom — in-house articles from structured records (needs wnba-api).
  let articles;
  try {
    articles = await runArticles(env, { apiGet: (p) => apiGet(env, p), intlGet: env.INTL ? (p) => intlGet(env, p) : null, dict: { ...dict, teamsList: rawDict.teams || [] }, externalItems: list, force: forceArticles, breaking: breaking.length > 0, backfillInternational, mediaFor });
  } catch (e) {
    articles = { error: e.message };
  }
  const desk = { status: articles?.error ? 'FAIL' : articles?.errors?.length ? 'DEGRADED' : 'PASS', articles };

  // WinBA editorial lanes, strictly after the article pass: substance is already
  // decided, gated and written, so the metric cannot influence what publishes.
  // A failure here leaves every story exactly as the newsroom wrote it.
  let winba;
  try {
    winba = await runWinbaPasses(env, {
      apiGet: (p) => apiGet(env, p), dict, at: startedAt, force: forceWinba, indexPeriod: winbaPeriod, mediaFor, winbaPodium, winbaBoardMedia, refreeze: winbaRefreeze, backfill: winbaBackfill, acceptRankCorrection: winbaAcceptRankCorrection, fixCopy: winbaFixCopy, fixFrozenAt: winbaFixFrozenAt
    });
  } catch (e) {
    winba = { error: String(e.message || e).slice(0, 160) };
  }

  // Commissioned features: manual editorial, and explicit only. Nothing in this
  // lane runs on a cron — an editor names the commission on the request, and the
  // pass reads the frozen monthly boards the Index lane has already published.
  let commissioned = null;
  if (commission) {
    try {
      commissioned = await runCommissionPass(env, { key: commission, apiGet: (p) => apiGet(env, p), at: startedAt, force: commissionForce, mediaFor, winbaBoardMedia });
    } catch (e) {
      commissioned = { error: String(e.message || e).slice(0, 200) };
    }
  }

  // Official game highlights: its own bounded pass on its own cadence; a failure never touches the articles.
  let video;
  try {
    video = await runVideoPass(env, { channelsDoc: videoChannels, teams: rawDict.teams || [], intlGet: env.INTL ? (p) => intlGet(env, p) : null });
  } catch (e) {
    video = { error: String(e.message || e).slice(0, 160) };
  }
  const deskStore = {};

  await persistSupabase(env, store, clusters, deskStore).catch((e) => runs.push({ source_id: 'supabase', status: 'FAIL', error: e.message }));

  const status = {
    at: startedAt, trigger, version: VERSION, editorial: EDITORIAL_VERSION, taxonomy: TAXONOMY_VERSION, events_version: EVENTS_VERSION, fetch: FETCH_VERSION, parser: PARSE_VERSION, registry: SOURCE_REGISTRY_VERSION, desk_version: DESK_VERSION,
    dictionary: { fresh: dictFresh, error: dictError || null, players: rawDict.players?.length || 0, captured_at: rawDict.captured_at },
    sources: runs.map(({ rejected_samples, ...r }) => ({ ...r, rejected_samples: rejected_samples.slice(0, 3) })),
    events: { created: created.length, joined: joined.length, breaking },
    desk,
    totals: { items: list.length, events: clusters.length, clusters: clusters.length, material_events: clusters.filter((c) => c.materiality?.material).length, articles_published: articles?.published_total ?? null, sources: NEWS_SOURCES.length, sources_ok: runs.filter((r) => ['PASS', 'NOT_MODIFIED', 'SKIPPED'].includes(r.status)).length },
    article_version: ARTICLE_VERSION,
    winba,
    ...(commissioned ? { commissioned } : {}),
    video,
    supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
  };
  await env.NEWS_KV.put('news:v1:status', JSON.stringify(status));
  const hist = (await env.NEWS_KV.get('news:v1:runs', 'json')) || [];
  await env.NEWS_KV.put('news:v1:runs', JSON.stringify([{ ...status, sources: status.sources.map(({ rejected_samples, ...r }) => r) }, ...hist].slice(0, 48)));
  return status;
}

async function persistSupabase(env, store, clusters, deskStore) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const up = async (table, rows, onConflict) => {
    if (!rows.length) return;
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows)
    });
    if (!res.ok) throw new Error(`supabase_${table}_${res.status}:${(await res.text()).slice(0, 200)}`);
  };
  await up('wnba_news_sources', [...NEWS_SOURCES, PBE_SOURCE].map((s) => ({ source_id: s.source_id, name: s.name, kind: s.kind, home_url: s.home_url || null, feed_url: s.feed_url || null, usage_policy: s.usage_policy, attribution: s.attribution, wnba_scope: s.wnba_scope, active: true, updated_at: new Date().toISOString() })), 'source_id');
  await up('wnba_news_clusters', clusters.map((c) => ({ cluster_id: c.cluster_id, canonical_item_id: c.canonical_item_id, headline: c.headline, story_type: c.story_type, entities: [], item_count: c.item_count, first_seen_at: c.first_seen_at, updated_at: new Date().toISOString() })), 'cluster_id');
  const items = Object.values(store);
  await up('wnba_news_items', items.map((i) => ({ item_id: i.item_id, source_id: i.source_id, canonical_url: i.canonical_url, headline: i.headline, summary: i.summary, byline: i.byline, published_at: i.published_at, source_updated_at: i.source_updated_at, first_captured_at: i.first_captured_at, last_captured_at: i.last_captured_at, story_type: i.story_type, relevance: i.relevance, relevance_reasons: i.relevance_reasons, entities: i.entities, cluster_id: i.cluster_id || null, rights: i.rights, status: 'published' })), 'item_id');
  await up('wnba_news_entities', items.flatMap((i) => i.entities.map((e) => ({ item_id: i.item_id, entity_type: e.type, entity_id: e.id, match_method: e.method }))), 'item_id,entity_type,entity_id');
  await up('wnba_pbe_stories', Object.values(deskStore).map((s) => ({ story_id: s.story_id, kind: s.kind, headline: s.headline, body: s.body, entities: s.entities, evidence: s.evidence, generator_version: s.generator_version, published_at: s.published_at, updated_at: new Date().toISOString(), status: 'published' })), 'story_id');
}

// ---------------------------------------------------------------- read API

async function feed(env, url) {
  const [store, clusters, desk, status, intlStore] = await Promise.all([
    env.NEWS_KV.get('news:v1:items', 'json'),
    env.NEWS_KV.get('news:v1:clusters', 'json'),
    env.NEWS_KV.get('news:v1:desk', 'json'),
    env.NEWS_KV.get('news:v1:status', 'json'),
    env.NEWS_KV.get('news:v1:intl-items', 'json')
  ]);
  const limit = Math.min(Number(url.searchParams.get('limit') || 40), 100);
  const type = url.searchParams.get('type');
  const player = url.searchParams.get('player');
  const team = url.searchParams.get('team');
  const game = url.searchParams.get('game');
  const lane = url.searchParams.get('lane'); // pbe | external | international
  const deskFilter = url.searchParams.get('desk'); // injuries | roster | league | international | games | market | other
  const materialOnly = url.searchParams.get('material') === '1';
  const match = (ents) => (!player || ents.some((e) => e.type === 'player' && e.id === player)) && (!team || ents.some((e) => e.type === 'team' && e.id === team)) && (!game || ents.some((e) => e.type === 'game' && e.id === game));

  const items = store || {};
  const out = [];
  // v1 PBE Desk blurbs are superseded by /v1/articles (full in-house articles).
  if (false) {
    for (const s of Object.values(desk || {})) {
      if (type && s.kind !== type) continue;
      if (!match(s.entities)) continue;
      out.push({ lane: 'pbe', id: s.story_id, kind: s.kind, headline: s.headline, body: s.body, published_at: s.published_at, captured_at: s.first_captured_at, entities: s.entities, evidence: s.evidence, attribution: s.attribution, generator_version: s.generator_version });
    }
  }
  if (lane === 'international') {
    for (const it of Object.values(intlStore || {})) {
      if (!publicItem(it)) continue;
      if (type && it.story_type !== type) continue;
      if (!match(it.entities || [])) continue;
      out.push({ lane: 'international', id: it.item_id, kind: it.story_type, event_type: it.event_type || null, headline: it.headline, url: it.canonical_url, source: { id: it.source_id, name: it.source_name, kind: it.source_kind, attribution: it.attribution }, byline: it.byline, published_at: it.published_at, source_updated_at: it.source_updated_at, captured_at: it.first_captured_at, entities: it.entities || [], wnba_accepted: Boolean(it.wnba_accepted) });
    }
  } else if (lane !== 'pbe') {
    for (const c of clusters || []) {
      // Public surfaces show only sources cleared for public use; an event reported only by sources under policy review is not listed.
      const members = c.members.map((m) => items[m]).filter(Boolean).filter(publicItem);
      const canon = members.find((m) => m.item_id === c.canonical_item_id) || [...members].sort((x, y) => (x.priority ?? 9) - (y.priority ?? 9) || String(x.published_at).localeCompare(String(y.published_at)))[0];
      if (!canon) continue;
      const ents = dedupeEntities(members.flatMap((m) => m.entities));
      if (type && canon.story_type !== type && c.event_type !== type) continue;
      if (deskFilter && c.lane !== deskFilter) continue;
      if (materialOnly && !c.materiality?.material) continue;
      if (!match(ents)) continue;
      out.push({
        lane: 'external',
        id: canon.item_id,
        cluster_id: c.cluster_id,
        event_id: c.cluster_id,
        kind: canon.story_type,
        event_type: c.event_type || canon.event_type || null,
        desk: c.lane || canon.lane || null,
        materiality: members.length === c.members.length ? c.materiality || null : null,
        publishers: new Set(members.map((m) => m.source_id)).size,
        headline: canon.headline,
        summary: canon.summary,
        url: canon.canonical_url,
        source: { id: canon.source_id, name: canon.source_name, kind: canon.source_kind, attribution: canon.attribution },
        byline: canon.byline,
        published_at: canon.published_at,
        source_updated_at: canon.source_updated_at,
        captured_at: canon.first_captured_at,
        relevance: canon.relevance,
        relevance_reasons: canon.relevance_reasons,
        entities: ents,
        also_covered_by: members.filter((m) => m.item_id !== canon.item_id).map((m) => ({ source: m.source_name, url: m.canonical_url, headline: m.headline, published_at: m.published_at }))
      });
    }
  }
  out.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
  return j({
    ok: true,
    data: { items: out.slice(0, limit), total: out.length, filters: { type, player, team, game, lane, desk: deskFilter, material: materialOnly } },
    meta: {
      service: SERVICE,
      version: VERSION,
      last_ingest_at: status?.at || null,
      freshness: status?.at ? (Date.now() - Date.parse(status.at) > 45 * 60e3 ? 'STALE' : 'CURRENT') : 'UNAVAILABLE',
      sources: (status?.sources || []).map((s) => ({ source_id: s.source_id, status: s.status, accepted: s.accepted, rejected: s.rejected })),
      desk: status?.desk || null,
      rights: 'External items: headline, link and publisher summary only; open on the publisher’s site. PBE Desk stories are PropBetEdge-written from the cited evidence.',
      served_at: new Date().toISOString()
    }
  }, 200, 30);
}

function dedupeEntities(list) {
  const m = new Map();
  for (const e of list) if (!m.has(`${e.type}:${e.id}`)) m.set(`${e.type}:${e.id}`, e);
  return [...m.values()];
}

async function articlesRoute(env, url) {
  const index = ((await env.NEWS_KV.get('art:v1:index', 'json')) || []).filter((c) => !withheldBySourcePolicy(c));
  const last = await env.NEWS_KV.get('art:v1:last_run', 'json');
  const limit = Math.min(Number(url.searchParams.get('limit') || 40), 400);
  const cat = url.searchParams.get('kind');
  const team = url.searchParams.get('team');
  const player = url.searchParams.get('player');
  const game = url.searchParams.get('game');
  const has = (c, t, id) => (c.entities || []).some((e) => e && e.type === t && e.id === id);
  const list = index.filter((c) => listedCard(c) && (!cat || c.kind === cat || c.desk === cat || (cat === 'performance' && c.kind === 'result')) && (!team || has(c, 'team', team) || c.lead_team_id === team) && (!player || has(c, 'player', player)) && (!game || has(c, 'game', game)));
  const links = (await env.NEWS_KV.get('video:v1:links', 'json'))?.decisions || {};
  return j({ ok: true, data: { items: list.slice(0, limit).map(({ input_hash, ...c }) => ({ ...c, media: mediaFor(c), video: cardVideo(links[c.id]) })), total: list.length }, meta: { service: SERVICE, version: VERSION, generator: ARTICLE_VERSION, media_manifest_at: MEDIA_MANIFEST_AT, last_run_at: last?.at || null, freshness: last?.at ? (Date.now() - Date.parse(last.at) > 90 * 60e3 ? 'STALE' : 'CURRENT') : 'UNAVAILABLE', served_at: new Date().toISOString() } }, 200, 30);
}

async function articleRoute(env, slugOrId) {
  const id = /^[a-f0-9]{12}$/.test(slugOrId) ? slugOrId : null;
  let a = id ? await env.NEWS_KV.get(`art:v1:item:${id}`, 'json') : null;
  if (!a) {
    const index = (await env.NEWS_KV.get('art:v1:index', 'json')) || [];
    const hit = index.find((c) => c.slug === slugOrId)
      || index.find((c) => (c.aliases || []).includes(slugOrId))
      || index.find((c) => slugOrId.endsWith(`-${c.id.slice(0, 6)}`));
    if (hit) a = await env.NEWS_KV.get(`art:v1:item:${hit.id}`, 'json');
  }
  if (!a) return j({ ok: false, error: 'not_found' }, 404);
  if (withheldBySourcePolicy({ kind: a.kind, sources: [...new Set((a.evidence || []).map((e) => e.publisher || e.source))] })) return j({ ok: false, error: 'not_found', reason: 'withheld_source_policy_review' }, 404);
  const index = (await env.NEWS_KV.get('art:v1:index', 'json')) || [];
  // The index is the lifecycle authority. A collapsed duplicate URL serves its canonical story, and the
  // canonical editorial origin/revision clocks win over whatever an older item payload stored.
  let card = index.find((c) => c.id === a.id);
  if (card?.duplicate_of) {
    const canonical = await env.NEWS_KV.get(`art:v1:item:${card.duplicate_of}`, 'json');
    if (canonical) { a = canonical; card = index.find((c) => c.id === a.id); }
  }
  if (card) a = { ...a, first_published_at: card.first_published_at || a.first_published_at, revised_at: card.revised_at ?? a.revised_at ?? null, revisions: card.revisions ?? a.revisions ?? [], quality_state: card.quality_state || null, quality_review: card.quality_review || null };
  const ents = new Set((a.entities || []).filter(Boolean).filter((e) => e.type !== 'game').map((e) => `${e.type}:${e.id}`));
  if (card?.status === 'external_coverage' && !a.external_coverage) a = { ...a, status: 'external_coverage', external_coverage: { at: card.demoted_at || null, reason: card.coverage_review?.reason || null, source_url: a.context?.brief?.source_url || null, source_name: a.context?.brief?.source_name || null } };
  const links = (await env.NEWS_KV.get('video:v1:links', 'json'))?.decisions || {};
  const related = index.filter((c) => c.id !== a.id && listedCard(c) && !withheldBySourcePolicy(c) && (c.entities || []).some((e) => e && ents.has(`${e.type}:${e.id}`))).slice(0, 6).map(({ input_hash, ...c }) => ({ ...c, media: mediaFor(c), video: cardVideo(links[c.id]) }));
  // A retired or external-coverage page is kept as a record; it is not enriched with video.
  const video = card?.quality_state === 'retired_from_index' || a.status === 'external_coverage' ? null : servedVideo(links[a.id]);
  return j({ ok: true, data: { article: { ...a, media: mediaFor(a), video }, related }, meta: { service: SERVICE, version: VERSION, generator: a.generator, served_at: new Date().toISOString() } }, 200, 60);
}

/** Cards carry only the verified playback identity needed for a poster-first inline player.
 * No YouTube request happens on list pages; the browser still waits for an explicit play click. */
function cardVideo(decision) {
  const v = servedVideo(decision);
  return v ? {
    provider: v.provider,
    video_id: v.video_id,
    title: v.title,
    channel_name: v.channel_name,
    duration_s: v.duration_s ?? null
  } : null;
}

/** Audit: every story's video decision with its reason and match evidence. */
async function videosRoute(env) {
  const [links, status] = await Promise.all([env.NEWS_KV.get('video:v1:links', 'json'), env.NEWS_KV.get('video:v1:status', 'json')]);
  const index = (await env.NEWS_KV.get('art:v1:index', 'json')) || [];
  const rows = index.map((c) => ({ id: c.id, slug: c.slug, kind: c.kind, headline: c.headline, listed: listedCard(c), decision: links?.decisions?.[c.id] || null, served: Boolean(servedVideo(links?.decisions?.[c.id])) }));
  return j({ ok: true, data: { rows, channels: allowedChannels(videoChannels).map((c) => ({ channel_id: c.channel_id, name: c.name, handle: c.handle, channel_class: c.channel_class, namespace: c.namespace, team_scope: c.team_scope || null, verification: { method: c.verification?.method, checked_at: c.verification?.checked_at, official_site_link: c.verification?.checks?.official_site_link?.link || null } })), status }, meta: { service: SERVICE, version: VERSION, video: VIDEO_VERSION, cadence_minutes: VIDEO_PASS_MINUTES, links_at: links?.at || null, served_at: new Date().toISOString() } }, 200, 60);
}

async function heldRoute(env) {
  return j({ ok: true, data: { held: (await env.NEWS_KV.get('art:v1:held', 'json')) || [], last_run: await env.NEWS_KV.get('art:v1:last_run', 'json') }, meta: { service: SERVICE, version: VERSION } }, 200, 30);
}

async function storyRoute(env, id) {
  const desk = (await env.NEWS_KV.get('news:v1:desk', 'json')) || {};
  const s = desk[id];
  if (!s) return j({ ok: false, error: 'not_found' }, 404);
  return j({ ok: true, data: s, meta: { service: SERVICE, version: VERSION } }, 200, 60);
}

async function sourcesRoute(env) {
  const [status, healthMap] = await Promise.all([env.NEWS_KV.get('news:v1:status', 'json'), env.NEWS_KV.get('news:v1:source-health', 'json')]);
  const hm = healthMap || {};
  const sources = [...NEWS_SOURCES, PBE_SOURCE].map((s) => {
    const h = hm[s.source_id] || null;
    return { ...s, last_run: status?.sources?.find((r) => r.source_id === s.source_id) || null, health: h ? { ...h, totals_24h: h.totals_24h ? { ...h.totals_24h, buckets: undefined } : null } : null };
  });
  const polled = sources.filter((s) => s.health);
  const summary = {
    sources: NEWS_SOURCES.length,
    ok: polled.filter((s) => ['PASS', 'NOT_MODIFIED', 'SKIPPED'].includes(s.health.last_status)).length,
    failing: polled.filter((s) => s.health.last_status === 'FAIL').map((s) => s.source_id),
    degraded: polled.filter((s) => s.health.last_status === 'DEGRADED').map((s) => s.source_id),
    stale_fetch: polled.filter((s) => s.health.staleness === 'STALE_FETCH').map((s) => s.source_id),
    quiet: polled.filter((s) => s.health.staleness === 'QUIET').map((s) => s.source_id),
    by_tier: Object.fromEntries(['official', 'national', 'womens_media', 'local_beat', 'analysis'].map((t) => [t, NEWS_SOURCES.filter((s) => s.tier === t).length])),
    events_last_run: status?.events || null,
    totals: status?.totals || null
  };
  return j({ ok: true, data: { summary, sources, not_ingested: AUDITED_NOT_INGESTED, cadence: `Cloudflare Cron every ${CRON_MINUTES} minutes (article pass every 10 minutes, immediately on a new material official event)`, registry: SOURCE_REGISTRY_VERSION, editorial: EDITORIAL_VERSION, taxonomy: TAXONOMY_VERSION, events: EVENTS_VERSION, fetch: FETCH_VERSION, lanes: LANES, event_types: Object.fromEntries(Object.entries(EVENT_TYPES).map(([k, v]) => [k, { lane: v.lane, label: v.label }])), desk: DESK_VERSION }, meta: { service: SERVICE, version: VERSION, last_ingest_at: status?.at || null, served_at: new Date().toISOString() } }, 200, 60);
}

async function runsRoute(env) {
  const runs = (await env.NEWS_KV.get('news:v1:runs', 'json')) || [];
  return j({ ok: true, data: { runs: runs.slice(0, 12) }, meta: { service: SERVICE, version: VERSION } }, 200, 30);
}

async function health(env) {
  const status = await env.NEWS_KV.get('news:v1:status', 'json');
  return j({ ok: true, service: SERVICE, version: VERSION, runtime: 'cloudflare-workers', scheduler: `cloudflare-cron */${CRON_MINUTES}`, kv: Boolean(env.NEWS_KV), api_binding: Boolean(env.API), supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY), last_ingest_at: status?.at || null, totals: status?.totals || null });
}

// ---------------------------------------------------------------- utils

function etCompact(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replaceAll('-', '');
}
function addDays(s, n) {
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + n));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
function cors(res) {
  res.headers.set('access-control-allow-origin', '*');
  res.headers.set('access-control-allow-methods', 'GET, OPTIONS');
  return res;
}
function j(body, status = 200, maxAge = 0) {
  return cors(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store' } }));
}
