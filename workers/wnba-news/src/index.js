// wnba-news — PropBetEdge WNBA independent newsroom lane (Cloudflare Worker + Cron).
//
// sources -> Cloudflare ingest -> normalized candidate -> relevance gate ->
// entity linking -> dedupe clusters -> (PBE Desk stories from structured records)
// -> KV edge store + Supabase (when bound) -> GET /v1/news -> frontend.
//
// Independent of NBA and of wnba-api's uptime: external news keeps flowing if
// wnba-api is down (entity dictionary falls back to its last good copy; Desk
// stories pause). Its own KV namespace, its own deploy, its own cron.

import { NEWS_SOURCES, PBE_SOURCE } from './sources.js';
import { parseRss, parseEspnNews, parseWnbaCom, canonicalUrl } from './parse.js';
import { buildDictionary, linkEntities, relevance, clusterItems, itemId, EDITORIAL_VERSION } from './editorial.js';
import { availabilityStories, transactionStories, resultStory, clinchStories, DESK_VERSION } from './pbe-desk.js';

const SERVICE = 'wnba-news';
const VERSION = '1.0.0';
const KEEP_DAYS = 21;
const UA = 'PropBetEdge-WNBA-News/1.0 (+https://wnba.propbetedge.ai/news)';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runIngest(env, 'cron'));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (path === '/health') return health(env);
    if (path === '/v1/news') return feed(env, url);
    if (path === '/v1/news/sources') return sourcesRoute(env);
    if (path === '/v1/news/runs') return runsRoute(env);
    const m = path.match(/^\/v1\/news\/story\/(pbe_[a-f0-9]{18})$/);
    if (m) return storyRoute(env, m[1]);
    if (path === '/run' && request.method === 'POST') {
      if (!env.ADMIN_TOKEN || request.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`) return j({ ok: false, error: 'unauthorized' }, 401);
      return j({ ok: true, result: await runIngest(env, 'manual') });
    }
    return j({ ok: false, error: 'not_found', routes: ['/health', '/v1/news', '/v1/news/sources', '/v1/news/runs', '/v1/news/story/:id'] }, 404);
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

async function dictionary(env) {
  try {
    const d = await apiGet(env, '/v1/players');
    const teams = [];
    const seen = new Set();
    for (const p of d.players) if (p.team && !seen.has(p.team.team_id)) { seen.add(p.team.team_id); teams.push(p.team); }
    const dict = { captured_at: new Date().toISOString(), players: d.players.map((p) => ({ athlete_id: p.athlete_id, name: p.name, team_id: p.team_id })), teams };
    await env.NEWS_KV.put('dict:v1', JSON.stringify(dict));
    return { dict, fresh: true };
  } catch (e) {
    const last = await env.NEWS_KV.get('dict:v1', 'json');
    if (last) return { dict: last, fresh: false, error: e.message };
    throw new Error(`no_entity_dictionary:${e.message}`);
  }
}

async function fetchSource(src) {
  const res = await fetch(src.feed_url, { headers: { 'user-agent': UA, accept: src.format === 'espn_json' ? 'application/json' : 'application/rss+xml, application/xml, text/html;q=0.8' }, signal: AbortSignal.timeout(12000), redirect: 'follow' });
  const text = await res.text();
  if (!res.ok) throw new Error(`http_${res.status}`);
  if (src.format === 'espn_json') return parseEspnNews(JSON.parse(text));
  if (src.format === 'wnba_next_data') return parseWnbaCom(text);
  return parseRss(text);
}

async function runIngest(env, trigger) {
  const startedAt = new Date().toISOString();
  const { dict: rawDict, fresh: dictFresh, error: dictError } = await dictionary(env);
  const dict = buildDictionary(rawDict);
  const store = (await env.NEWS_KV.get('news:v1:items', 'json')) || {};
  const runs = [];

  for (const src of NEWS_SOURCES) {
    const run = { source_id: src.source_id, at: startedAt, status: 'PASS', fetched: 0, accepted: 0, new: 0, duplicates_url: 0, rejected: 0, rejected_samples: [] };
    try {
      const items = await fetchSource(src);
      run.fetched = items.length;
      for (const raw of items) {
        const canonical = canonicalUrl(raw.url);
        if (!canonical) { run.rejected += 1; continue; }
        const id = await itemId(canonical);
        const entities = linkEntities(raw, dict);
        const rel = relevance(raw, entities, src);
        if (!rel.accept) {
          run.rejected += 1;
          if (run.rejected_samples.length < 6) run.rejected_samples.push({ headline: raw.headline, reasons: rel.reasons });
          continue;
        }
        run.accepted += 1;
        const prev = store[id];
        if (prev) run.duplicates_url += 1; else run.new += 1;
        store[id] = {
          item_id: id,
          source_id: src.source_id,
          source_name: src.name,
          source_kind: src.kind,
          attribution: src.attribution,
          priority: src.priority,
          canonical_url: canonical,
          headline: raw.headline,
          summary: raw.summary,
          byline: raw.byline,
          published_at: raw.published_at || prev?.published_at || startedAt,
          source_updated_at: raw.updated_at || null,
          first_captured_at: prev?.first_captured_at || startedAt,
          last_captured_at: startedAt,
          story_type: rel.type,
          relevance: rel.score,
          relevance_reasons: rel.reasons,
          entities,
          rights: 'headline_link_summary'
        };
      }
      if (!items.length) run.status = 'DEGRADED';
    } catch (e) {
      run.status = 'FAIL';
      run.error = e.message;
    }
    runs.push(run);
  }

  // Retention window, then dedupe clusters over what remains.
  const cutoff = Date.now() - KEEP_DAYS * 86400e3;
  for (const [k, v] of Object.entries(store)) if (Date.parse(v.published_at) < cutoff) delete store[k];
  const list = Object.values(store);
  const clusters = clusterItems(list);
  const byId = Object.fromEntries(list.map((x) => [x.item_id, x]));
  for (const c of clusters) for (const m of c.members) if (byId[m]) byId[m].cluster_id = c.cluster_id;
  await env.NEWS_KV.put('news:v1:items', JSON.stringify(store));
  await env.NEWS_KV.put('news:v1:clusters', JSON.stringify(clusters));

  // PropBetEdge Desk — owned stories from structured records (needs wnba-api).
  const desk = { status: 'PASS', generated: 0, new: 0, errors: [] };
  const deskStore = (await env.NEWS_KV.get('news:v1:desk', 'json')) || {};
  try {
    const teamsById = new Map((rawDict.teams || []).map((t) => [String(t.team_id), t]));
    const stories = [];
    const inj = await apiGet(env, '/v1/injuries').catch((e) => { desk.errors.push(e.message); return null; });
    if (inj?.changes?.length) stories.push(...(await availabilityStories(inj.changes.slice(0, 40), teamsById)));
    const tx = await apiGet(env, '/v1/transactions').catch((e) => { desk.errors.push(e.message); return null; });
    if (tx?.items) stories.push(...(await transactionStories(tx.items, new Date(Date.now() - 72 * 3600e3).toISOString())));
    const today = etCompact();
    const sched = await apiGet(env, `/v1/schedule?from=${addDays(today, -2)}&to=${today}`).catch((e) => { desk.errors.push(e.message); return null; });
    const finals = (sched?.games || []).filter((g) => g.status?.state === 'post' && g.status?.completed);
    for (const g of finals.slice(0, 8)) {
      const existing = Object.values(deskStore).find((s) => s.kind === 'result' && s.entities.some((e) => e.type === 'game' && e.id === g.game_id));
      if (existing) continue;
      const live = await apiGet(env, `/v1/games/${g.game_id}/live`).catch((e) => { desk.errors.push(e.message); return null; });
      const s = live ? await resultStory(live) : null;
      if (s) stories.push(s);
    }
    const st = await apiGet(env, '/v1/standings').catch((e) => { desk.errors.push(e.message); return null; });
    if (st?.is_current) {
      const prevMarks = await env.NEWS_KV.get('desk:v1:clinch_marks', 'json');
      const cl = await clinchStories(st, prevMarks);
      stories.push(...cl.stories);
      await env.NEWS_KV.put('desk:v1:clinch_marks', JSON.stringify(cl.marks));
    }
    for (const s of stories) {
      desk.generated += 1;
      if (!deskStore[s.story_id]) {
        desk.new += 1;
        deskStore[s.story_id] = { ...s, source_id: PBE_SOURCE.source_id, attribution: PBE_SOURCE.attribution, generator_version: DESK_VERSION, first_captured_at: startedAt };
      }
    }
    for (const [k, v] of Object.entries(deskStore)) if (Date.parse(v.published_at) < cutoff) delete deskStore[k];
    await env.NEWS_KV.put('news:v1:desk', JSON.stringify(deskStore));
    if (desk.errors.length) desk.status = 'DEGRADED';
  } catch (e) {
    desk.status = 'FAIL';
    desk.errors.push(e.message);
  }

  await persistSupabase(env, store, clusters, deskStore).catch((e) => runs.push({ source_id: 'supabase', status: 'FAIL', error: e.message }));

  const status = { at: startedAt, trigger, version: VERSION, editorial: EDITORIAL_VERSION, desk_version: DESK_VERSION, dictionary: { fresh: dictFresh, error: dictError || null, players: rawDict.players?.length || 0, captured_at: rawDict.captured_at }, sources: runs, desk, totals: { items: list.length, clusters: clusters.length, desk_stories: Object.keys(deskStore).length }, supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) };
  await env.NEWS_KV.put('news:v1:status', JSON.stringify(status));
  const hist = (await env.NEWS_KV.get('news:v1:runs', 'json')) || [];
  await env.NEWS_KV.put('news:v1:runs', JSON.stringify([status, ...hist].slice(0, 48)));
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
  const [store, clusters, desk, status] = await Promise.all([
    env.NEWS_KV.get('news:v1:items', 'json'),
    env.NEWS_KV.get('news:v1:clusters', 'json'),
    env.NEWS_KV.get('news:v1:desk', 'json'),
    env.NEWS_KV.get('news:v1:status', 'json')
  ]);
  const limit = Math.min(Number(url.searchParams.get('limit') || 40), 100);
  const type = url.searchParams.get('type');
  const player = url.searchParams.get('player');
  const team = url.searchParams.get('team');
  const game = url.searchParams.get('game');
  const lane = url.searchParams.get('lane'); // pbe | external
  const match = (ents) => (!player || ents.some((e) => e.type === 'player' && e.id === player)) && (!team || ents.some((e) => e.type === 'team' && e.id === team)) && (!game || ents.some((e) => e.type === 'game' && e.id === game));

  const items = store || {};
  const out = [];
  if (lane !== 'external') {
    for (const s of Object.values(desk || {})) {
      if (type && s.kind !== type) continue;
      if (!match(s.entities)) continue;
      out.push({ lane: 'pbe', id: s.story_id, kind: s.kind, headline: s.headline, body: s.body, published_at: s.published_at, captured_at: s.first_captured_at, entities: s.entities, evidence: s.evidence, attribution: s.attribution, generator_version: s.generator_version });
    }
  }
  if (lane !== 'pbe') {
    for (const c of clusters || []) {
      const canon = items[c.canonical_item_id] || items[c.members[0]];
      if (!canon) continue;
      const members = c.members.map((m) => items[m]).filter(Boolean);
      const ents = dedupeEntities(members.flatMap((m) => m.entities));
      if (type && canon.story_type !== type) continue;
      if (!match(ents)) continue;
      out.push({
        lane: 'external',
        id: canon.item_id,
        cluster_id: c.cluster_id,
        kind: canon.story_type,
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
    data: { items: out.slice(0, limit), total: out.length, filters: { type, player, team, game, lane } },
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

async function storyRoute(env, id) {
  const desk = (await env.NEWS_KV.get('news:v1:desk', 'json')) || {};
  const s = desk[id];
  if (!s) return j({ ok: false, error: 'not_found' }, 404);
  return j({ ok: true, data: s, meta: { service: SERVICE, version: VERSION } }, 200, 60);
}

async function sourcesRoute(env) {
  const status = await env.NEWS_KV.get('news:v1:status', 'json');
  return j({ ok: true, data: { sources: [...NEWS_SOURCES, PBE_SOURCE].map((s) => ({ ...s, last_run: status?.sources?.find((r) => r.source_id === s.source_id) || null })), cadence: 'Cloudflare Cron every 10 minutes', editorial: EDITORIAL_VERSION, desk: DESK_VERSION }, meta: { service: SERVICE, version: VERSION, last_ingest_at: status?.at || null } }, 200, 60);
}

async function runsRoute(env) {
  const runs = (await env.NEWS_KV.get('news:v1:runs', 'json')) || [];
  return j({ ok: true, data: { runs: runs.slice(0, 12) }, meta: { service: SERVICE, version: VERSION } }, 200, 30);
}

async function health(env) {
  const status = await env.NEWS_KV.get('news:v1:status', 'json');
  return j({ ok: true, service: SERVICE, version: VERSION, runtime: 'cloudflare-workers', scheduler: 'cloudflare-cron */10', kv: Boolean(env.NEWS_KV), api_binding: Boolean(env.API), supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY), last_ingest_at: status?.at || null, totals: status?.totals || null });
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
