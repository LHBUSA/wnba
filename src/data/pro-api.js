import { PRIVATE_BASE } from './api.js';

async function privateJson(path, { method = 'GET', body, timeoutMs = 12000 } = {}) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${PRIVATE_BASE}${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      signal: ctrl.signal,
      headers: body ? { accept: 'application/json', 'content-type': 'application/json' } : { accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    clearTimeout(timer);
    const json = await res.json().catch(() => null);
    if (!json) return { ok: false, status: res.status, data: null, error: { code: `http_${res.status}` } };
    return { ...json, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: { code: e.name === 'AbortError' ? 'timeout' : 'network', message: e.message } };
  }
}

export const proApi = {
  pbeTimeline: (id) => privateJson(`/v1/pro/edge-timeline/${encodeURIComponent(id)}`),
  watchlist: () => privateJson('/v1/pro/watchlist'),
  saveWatchlist: (body) => privateJson('/v1/pro/watchlist', { method: 'POST', body })
};
