// wnba-video-preview — QA harness for the official video lane.
//
// It imports the SAME modules the production newsroom Worker will run
// (../../wnba-news/src/videos.js and videos-run.js) and serves only the video
// routes, over its own KV namespace, with no cron. Nothing here can touch the
// production newsroom's items, clusters, articles, held queue or run history.
//
// Production ownership of the lane is wnba-news. Delete this Worker at merge.

import { runVideos } from '../../wnba-news/src/videos-run.js';
import { selectVideos, ALLOWED_CHANNELS, PENDING_CHANNELS, VIDEO_VERSION, VIDEO_TYPES, CHANNELS_GENERATED_AT } from '../../wnba-news/src/videos.js';

const SERVICE = 'wnba-video-preview';
const VERSION = '0.1.0';
const UA = 'PropBetEdge-WNBA-Video/1.0 (+https://wnba.propbetedge.ai/)';

async function apiGet(env, path) {
  if (!env.API) throw new Error('api_binding_missing');
  const res = await env.API.fetch(`https://wnba-api.internal${path}`, { headers: { 'user-agent': UA } });
  const body = await res.json();
  if (!body?.ok) throw new Error(`api_${path}_${body?.error?.code || res.status}`);
  return body.data;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    if (path === '/health') {
      const last = await env.NEWS_KV.get('vid:v1:last_run', 'json');
      return j({ ok: true, service: SERVICE, version: VERSION, generator: VIDEO_VERSION, preview: true, runtime: 'cloudflare-workers', scheduler: 'none (manual /run only)', kv: Boolean(env.NEWS_KV), api_binding: Boolean(env.API), youtube_api_key: Boolean(env.YOUTUBE_API_KEY), channels_allowlisted: ALLOWED_CHANNELS.length, last_run_at: last?.at || null, status: last?.status || 'NEVER_RUN', totals: last?.totals || null });
    }
    if (path === '/v1/videos') return videosRoute(env, url);
    if (path === '/v1/videos/channels') return videoChannelsRoute(env);
    if (path === '/v1/videos/runs') return j({ ok: true, data: { runs: (await env.NEWS_KV.get('vid:v1:runs', 'json')) || [] }, meta: { service: SERVICE, version: VERSION } });
    const pv = path.match(/^\/v1\/players\/(\d{3,12})\/videos$/);
    if (pv) return videosRoute(env, url, { player_id: pv[1] });
    const tv = path.match(/^\/v1\/teams\/(\d{1,8})\/videos$/);
    if (tv) return videosRoute(env, url, { team_id: tv[1] });
    const gv = path.match(/^\/v1\/games\/(\d{6,12})\/videos$/);
    if (gv) return videosRoute(env, url, { game_id: gv[1] });

    if (path === '/run' && request.method === 'POST') {
      if (!env.ADMIN_TOKEN || request.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`) return j({ ok: false, error: 'unauthorized' }, 401);
      return j({ ok: true, result: await runVideos(env, { apiGet: (p) => apiGet(env, p), force: true }) });
    }
    return j({ ok: false, error: 'not_found', routes: ['/health', '/v1/videos', '/v1/videos/channels', '/v1/videos/runs', '/v1/players/:id/videos', '/v1/teams/:id/videos', '/v1/games/:id/videos'] }, 404);
  }
};

async function videosRoute(env, url, fixed = {}) {
  const [store, last] = await Promise.all([
    env.NEWS_KV.get('vid:v1:items', 'json'),
    env.NEWS_KV.get('vid:v1:last_run', 'json')
  ]);
  const type = url.searchParams.get('type');
  const filters = {
    type: VIDEO_TYPES.includes(type) ? type : null,
    player_id: fixed.player_id || url.searchParams.get('player_id'),
    team_id: fixed.team_id || url.searchParams.get('team_id'),
    game_id: fixed.game_id || url.searchParams.get('game_id'),
    limit: Math.min(Number(url.searchParams.get('limit') || 12), 60)
  };
  const sel = selectVideos(store || {}, filters);
  return j({
    ok: true,
    data: { items: sel.items, total: sel.total, pool: sel.pool, filters },
    meta: {
      service: SERVICE, version: VERSION, generator: VIDEO_VERSION, types: VIDEO_TYPES,
      channels_allowlisted: ALLOWED_CHANNELS.length, discovery: last?.discovery || null,
      last_run_at: last?.at || null,
      freshness: last?.at ? (Date.now() - Date.parse(last.at) > 6 * 3600e3 ? 'STALE' : 'CURRENT') : 'UNAVAILABLE',
      rights: 'Official WNBA, WNBA team and league-authorised channels only. PropBetEdge never downloads or rehosts video: playback runs in YouTube’s own privacy-enhanced player, with YouTube controls and branding intact, and the publisher is credited on every card.',
      served_at: new Date().toISOString()
    }
  }, 200, 60);
}

async function videoChannelsRoute(env) {
  const last = await env.NEWS_KV.get('vid:v1:last_run', 'json');
  const runById = new Map((last?.channels || []).map((r) => [r.channel_id, r]));
  return j({
    ok: true,
    data: {
      channels: ALLOWED_CHANNELS.map((c) => ({ provider: c.provider, channel_id: c.channel_id, name: c.name, channel_class: c.channel_class, team_id: c.team_id || null, source_verified: c.source_verified, verification: c.verification, last_run: runById.get(c.channel_id) || null })),
      pending: PENDING_CHANNELS,
      allowlist_generated_at: CHANNELS_GENERATED_AT,
      totals: last?.totals || null
    },
    meta: { service: SERVICE, version: VERSION, generator: VIDEO_VERSION, last_run_at: last?.at || null, served_at: new Date().toISOString() }
  }, 200, 300);
}

function cors(res) {
  res.headers.set('access-control-allow-origin', '*');
  res.headers.set('access-control-allow-methods', 'GET, OPTIONS');
  return res;
}
function j(body, status = 200, maxAge = 0) {
  return cors(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store' } }));
}
