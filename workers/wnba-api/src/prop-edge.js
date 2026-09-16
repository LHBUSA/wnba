import { resolveAccount } from './account.js';
import { privateJson } from './auth.js';

const KEY = 'prop-edge:v1:latest';

export async function propEdge({ request, env }) {
  const account = await resolveAccount(request, env);
  if (!account.entitled) {
    const status = account.state === 'signed_out' ? 401 : 403;
    return privateJson(request, {
      ok: false,
      error: { code: 'wnba_pro_required', message: 'PBE Prop Edge is part of WNBA Pro.' },
      data: { access: 'locked', state: account.state, entitlement_check: account.entitlement_check }
    }, status);
  }
  if (!env.WNBA_KV) return privateJson(request, { ok: false, error: { code: 'prop_edge_unavailable', message: 'PBE Prop Edge storage is unavailable.' } }, 503);

  const snapshot = await env.WNBA_KV.get(KEY, 'json');
  if (!snapshot) return privateJson(request, {
    ok: false,
    error: { code: 'prop_edge_warming', message: 'PBE Prop Edge is building its first tracking snapshot.' }
  }, 503);

  const ageS = Math.max(0, Math.round((Date.now() - Date.parse(snapshot.generated_at)) / 1000));
  return privateJson(request, {
    ok: true,
    data: {
      access: 'granted',
      availability: 'LIVE',
      generated_at: snapshot.generated_at,
      source_captured_at: snapshot.source_captured_at,
      age_s: ageS,
      stale: ageS > 6 * 3600,
      model: snapshot.model,
      coverage: snapshot.coverage,
      summary: snapshot.summary,
      rows: snapshot.rows || []
    }
  });
}
