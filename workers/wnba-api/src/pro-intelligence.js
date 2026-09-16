import { resolveAccount } from './account.js';
import { privateJson } from './auth.js';

async function gatePro(request, env, label) {
  const account = await resolveAccount(request, env);
  if (account.entitled) return account;
  const status = account.state === 'signed_out' ? 401 : 403;
  return privateJson(request, {
    ok: false,
    error: { code: 'wnba_pro_required', message: `${label} is part of WNBA Pro.` },
    data: { access: 'locked', state: account.state, entitlement_check: account.entitlement_check }
  }, status);
}

function sbHeaders(env) {
  return {
    apikey: env.PBE_SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.PBE_SUPABASE_SERVICE_ROLE_KEY}`,
    accept: 'application/json'
  };
}

export async function edgeTimeline({ request, env, gameId }) {
  const account = await gatePro(request, env, 'PBE Edge Timeline');
  if (account instanceof Response) return account;
  if (!/^\d{6,12}$/.test(String(gameId || ''))) return privateJson(request, { ok: false, error: { code: 'invalid_game_id', message: 'A canonical WNBA game id is required.' } }, 400);
  if (!(env.PBE_SUPABASE_URL && env.PBE_SUPABASE_SERVICE_ROLE_KEY)) return privateJson(request, { ok: false, error: { code: 'timeline_unavailable', message: 'The PBE observation ledger is not configured on this Worker.' } }, 503);

  const url = new URL(`${env.PBE_SUPABASE_URL}/rest/v1/wnba_pbe_prediction_observations`);
  url.searchParams.set('game_id', `eq.${gameId}`);
  url.searchParams.set('select', 'observation_id,recorded_at,generated_at,game_id,scheduled_tip_utc,home_team_id,away_team_id,model_id,call,no_call_reason,p_home,pick_team_id,pick_probability,confidence,feature_hash,market_devig_probability,pbe_edge');
  url.searchParams.set('order', 'recorded_at.asc');
  url.searchParams.set('limit', '240');

  let res;
  try {
    res = await fetch(url, { headers: sbHeaders(env), signal: AbortSignal.timeout(10000) });
  } catch (e) {
    return privateJson(request, { ok: false, error: { code: 'timeline_unavailable', message: e?.name === 'TimeoutError' ? 'The PBE observation ledger timed out.' : 'The PBE observation ledger could not be reached.' } }, 503);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[wnba-api] edge timeline', res.status, text.slice(0, 200));
    return privateJson(request, { ok: false, error: { code: 'timeline_unavailable', message: 'The PBE observation ledger could not be read.' } }, 503);
  }
  const rows = await res.json();
  const observations = (Array.isArray(rows) ? rows : []).map((r) => ({
    observation_id: r.observation_id,
    recorded_at: r.recorded_at,
    generated_at: r.generated_at,
    game_id: r.game_id,
    scheduled_tip_utc: r.scheduled_tip_utc,
    home_team_id: r.home_team_id,
    away_team_id: r.away_team_id,
    model_id: r.model_id,
    call: r.call,
    no_call_reason: r.no_call_reason,
    p_home: Number.isFinite(Number(r.p_home)) ? Number(r.p_home) : null,
    pick_team_id: r.pick_team_id,
    pick_probability: Number.isFinite(Number(r.pick_probability)) ? Number(r.pick_probability) : null,
    confidence: r.confidence,
    feature_hash: r.feature_hash,
    market_devig_probability: Number.isFinite(Number(r.market_devig_probability)) ? Number(r.market_devig_probability) : null,
    pbe_edge_pts: Number.isFinite(Number(r.pbe_edge)) ? Math.round(Number(r.pbe_edge) * 1000) / 10 : null
  }));
  return privateJson(request, { ok: true, data: { access: 'granted', game_id: String(gameId), observations, count: observations.length } });
}

async function emailHash(email) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(email || '').trim().toLowerCase()));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function watchKey(email) {
  return `pro-watch:v1:${await emailHash(email)}`;
}

function cleanWatchlist(body) {
  const raw = Array.isArray(body?.team_ids) ? body.team_ids : [];
  const team_ids = [...new Set(raw.map((x) => String(x).trim()).filter((x) => /^\d{1,8}$/.test(x)))].slice(0, 6);
  const n = Number(body?.edge_threshold_pts);
  const edge_threshold_pts = Number.isFinite(n) ? Math.max(0, Math.min(25, Math.round(n * 2) / 2)) : 5;
  return { team_ids, edge_threshold_pts };
}

export async function proWatchlist({ request, env }) {
  const account = await gatePro(request, env, 'Watchlist & Live Alerts');
  if (account instanceof Response) return account;
  if (!env.WNBA_KV) return privateJson(request, { ok: false, error: { code: 'watchlist_unavailable', message: 'Watchlist storage is unavailable.' } }, 503);
  const key = await watchKey(account.email);

  if (request.method === 'GET' || request.method === 'HEAD') {
    const saved = await env.WNBA_KV.get(key, 'json');
    return privateJson(request, { ok: true, data: { access: 'granted', team_ids: saved?.team_ids || [], edge_threshold_pts: saved?.edge_threshold_pts ?? 5, updated_at: saved?.updated_at || null } });
  }
  if (request.method !== 'POST') return privateJson(request, { ok: false, error: { code: 'method_not_allowed', message: 'Use GET or POST.' } }, 405);

  let body;
  try { body = await request.json(); } catch { return privateJson(request, { ok: false, error: { code: 'invalid_json', message: 'Watchlist body must be valid JSON.' } }, 400); }
  const clean = cleanWatchlist(body);
  const stored = { ...clean, updated_at: new Date().toISOString(), schema: 'wnba-pro-watchlist/1' };
  await env.WNBA_KV.put(key, JSON.stringify(stored));
  return privateJson(request, { ok: true, data: { access: 'granted', ...stored } });
}
