// WNBA Pro Player Load read surface. Entitlement is decided BEFORE the paid
// snapshot is read from KV, matching the PBE Picks server-side access contract.

import { resolveAccount } from './account.js';
import { privateJson } from './auth.js';

const KEY = 'player-load:v1:latest';

export async function playerLoad({ request, env, params = {} }) {
  const account = await resolveAccount(request, env);
  if (!account.entitled) {
    const status = account.state === 'signed_out' ? 401 : 403;
    return privateJson(request, {
      ok: false,
      error: { code: 'wnba_pro_required', message: 'Player Load Intelligence is part of WNBA Pro.' },
      data: { access: 'locked', state: account.state, entitlement_check: account.entitlement_check }
    }, status);
  }
  if (!env.WNBA_KV) return privateJson(request, { ok: false, error: { code: 'player_load_unavailable', message: 'Player Load storage is unavailable.' } }, 503);

  const snapshot = await env.WNBA_KV.get(KEY, 'json');
  if (!snapshot) return privateJson(request, { ok: false, error: { code: 'player_load_warming', message: 'Player Load is building its first snapshot.' } }, 503);
  const ageS = Math.max(0, Math.round((Date.now() - Date.parse(snapshot.generated_at)) / 1000));
  const base = {
    access: 'granted',
    availability: 'LIVE',
    generated_at: snapshot.generated_at,
    age_s: ageS,
    stale: ageS > 3600,
    schema: snapshot.schema,
    disclaimer: snapshot.disclaimer,
    methodology: snapshot.methodology,
    coverage: snapshot.coverage,
    source: snapshot.source
  };

  if (params.id) {
    const player = (snapshot.players || []).find((p) => String(p.athlete_id) === String(params.id));
    if (!player) return privateJson(request, { ok: false, error: { code: 'player_load_not_found', message: 'No current Player Load record exists for this player.' } }, 404);
    return privateJson(request, { ok: true, data: { ...base, player } });
  }
  return privateJson(request, { ok: true, data: { ...base, summary: snapshot.summary, players: snapshot.players || [] } });
}
