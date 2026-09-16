// Premium read layer for wnba-api. Existing API behavior delegates byte-for-byte
// to the current Worker; this thin Cloudflare entrypoint owns only Player Load.
import current from './index.js';
import { playerLoad } from './player-load.js';
import { credentialedPreflight, privateJson } from './auth.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const m = path.match(/^\/v1\/player-load(?:\/([A-Za-z0-9_-]{1,40}))?$/);
    if (!m) return current.fetch(request, env, ctx);
    if (request.method === 'OPTIONS') return credentialedPreflight(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') return privateJson(request, { ok: false, error: { code: 'method_not_allowed' } }, 405);
    try {
      return await playerLoad({ request, env, params: m[1] ? { id: m[1] } : {} });
    } catch (e) {
      console.error('[wnba-api] player-load', e?.stack || e);
      return privateJson(request, { ok: false, error: { code: 'internal_error' } }, 500);
    }
  }
};
