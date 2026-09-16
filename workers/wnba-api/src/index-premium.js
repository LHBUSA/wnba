// Premium read layer for wnba-api. Existing API behavior delegates byte-for-byte
// to the current Worker; this Cloudflare entrypoint owns the additive WNBA Pro surfaces.
import current from './index.js';
import { playerLoad } from './player-load.js';
import { edgeTimeline, proWatchlist } from './pro-intelligence.js';
import { credentialedPreflight, privateJson } from './auth.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    const loadMatch = path.match(/^\/v1\/player-load(?:\/([A-Za-z0-9_-]{1,40}))?$/);
    const timelineMatch = path.match(/^\/v1\/pro\/edge-timeline\/(\d{6,12})$/);
    const watchlistMatch = path === '/v1/pro/watchlist';
    if (!loadMatch && !timelineMatch && !watchlistMatch) return current.fetch(request, env, ctx);

    if (request.method === 'OPTIONS') return credentialedPreflight(request);
    try {
      if (loadMatch) {
        if (request.method !== 'GET' && request.method !== 'HEAD') return privateJson(request, { ok: false, error: { code: 'method_not_allowed' } }, 405);
        return await playerLoad({ request, env, params: loadMatch[1] ? { id: loadMatch[1] } : {} });
      }
      if (timelineMatch) {
        if (request.method !== 'GET' && request.method !== 'HEAD') return privateJson(request, { ok: false, error: { code: 'method_not_allowed' } }, 405);
        return await edgeTimeline({ request, env, gameId: timelineMatch[1] });
      }
      return await proWatchlist({ request, env });
    } catch (e) {
      console.error('[wnba-api] premium route', path, e?.stack || e);
      return privateJson(request, { ok: false, error: { code: 'internal_error' } }, 500);
    }
  }
};
