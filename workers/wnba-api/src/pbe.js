// PBE WNBA read routes. Entitlement is decided BEFORE any protected read: a caller without WNBA Pro never causes
// a prediction document to be loaded, so there is nothing to leak into HTML, JSON or a CSS-hidden element.
//
// Public:   GET /v1/pbe/status        model identity, frozen receipt summary, runner mode, lock policy (no picks)
//           GET /v1/pbe/coverage      which upcoming games the model covers (ids + tip + phase only, no values)
//           GET /v1/track-record      official-ledger aggregate only
// WNBA Pro: GET /v1/pbe/picks         current calls (PRE-LOCK provisional, LOCKED official)
//           GET /v1/pbe/games/:id     one canonical call
//           GET /v1/pbe/teams/:id     that team's next call, oriented from the SAME canonical document
//           GET /v1/track-record/ledger  every official lock with its current grade revision
//
// Publication gate: PBE_PUBLISH must be 'true' (owner-approved, with the first official lock) before subscribers
// see values. Until then an entitled subscriber gets MODEL_IN_VALIDATION with no values, and only the owner's
// own verified session sees the SHADOW (dry-run) documents, each labelled as shadow.

import ARTIFACT from '../../../model/pbe-wnba-model-v1/artifact.json' with { type: 'json' };
import MANIFEST from '../../../model/pbe-wnba-model-v1/manifest.json' with { type: 'json' };
import RECEIPT from '../../../model/pbe-wnba-model-v1/validation_receipt.json' with { type: 'json' };
import { resolveAccount } from './account.js';
import { privateJson } from './auth.js';
import { orientDoc, lockPhase, trackRecordAggregate, LOCK_POLICY, CONTRACT } from '../../shared/pbe-runtime.js';

const KV = (ledger, kind, id) => `pbe:v1:${ledger}:${kind}${id ? `:${id}` : ''}`;

export function pbeVisibility(account, env) {
  if (!account.entitled) return { mode: 'locked' };
  if (env.PBE_PUBLISH === 'true') return { mode: 'full', ledger: 'official' };
  if (account.access === 'owner') return { mode: 'shadow', ledger: 'shadow' };
  return { mode: 'in_validation' };
}

/** Resolve the account and refuse before any protected read. Returns { account, vis } or a Response. */
async function gate(request, env) {
  const account = await resolveAccount(request, env);
  const vis = pbeVisibility(account, env);
  if (vis.mode === 'locked') {
    const status = account.state === 'signed_out' ? 401 : 403;
    return privateJson(request, { ok: false, error: { code: 'wnba_pro_required', message: 'PBE Picks are part of WNBA Pro.' }, data: { access: 'locked', state: account.state, entitlement_check: account.entitlement_check } }, status);
  }
  if (vis.mode === 'in_validation') {
    return privateJson(request, { ok: true, data: { access: 'granted', availability: 'MODEL_IN_VALIDATION', message: 'PBE WNBA model v1 is running in validation. Official calls appear here from the first owner-approved lock.', picks: [] } });
  }
  return { account, vis };
}

// ------------------------------------------------------------------ item shaping (entitled callers only)

const round = (x, d = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

function marketView(m) {
  if (!m?.available) return { available: false, reason: m?.reason || 'no_market', captured_at: m?.captured_at || null };
  return {
    available: true, source: m.source, captured_at: m.captured_at, age_s: m.age_s, current: m.current, book_count: m.book_count,
    home: m.home && { consensus_moneyline: m.home.consensus_moneyline, implied_probability: m.home.implied_probability, devig_probability: m.home.devig_probability },
    away: m.away && { consensus_moneyline: m.away.consensus_moneyline, implied_probability: m.away.implied_probability, devig_probability: m.away.devig_probability },
    pick_side: m.pick_side,
    pbe_edge_pts: m.pbe_edge_pts
  };
}

function phaseOf(doc, lock, now = Date.now()) {
  if (lock) return 'LOCKED';
  const p = lockPhase(doc.game.scheduled_tip_utc, now);
  return p === 'pre_lock' ? 'PRE_LOCK' : 'NOT_LOCKED';
}

/** One call as served: the official lock if it exists, otherwise the provisional pre-lock document. */
function callItem(doc, lock, grade, ledger) {
  const src = lock
    ? { ...doc, generated_at: lock.source_generated_at, p_home: lock.p_home, p_away: 1 - lock.p_home, call: lock.call, no_call_reason: lock.no_call_reason, pick_team_id: lock.selected_team_id, pick_probability: lock.win_probability, confidence: lock.confidence, reasoning: lock.reasoning, market: lock.market_at_lock, feature_hash: lock.feature_hash, model: lock.model, game: lock.game }
    : doc;
  const phase = phaseOf(src, lock);
  if (phase === 'NOT_LOCKED') {
    // Tip has passed without a recorded lock: there is no official call, and a stale provisional one is never shown.
    return { ledger, game: src.game, phase, call: null, reason: 'no_lock_recorded_before_tip' };
  }
  const side = src.pick_team_id === src.game.home_team_id ? 'home' : src.pick_team_id === src.game.away_team_id ? 'away' : null;
  const r = side ? src.reasoning[side] : null;
  return {
    ledger,
    shadow: ledger === 'shadow',
    game: src.game,
    phase,
    call: src.call,
    no_call_reason: src.no_call_reason,
    pick_team_id: src.pick_team_id,
    p_home: src.p_home,
    p_away: 1 - src.p_home,
    pick_probability: src.pick_probability,
    confidence: src.confidence,
    market: marketView(src.market),
    reasoning: r ? { supporting: r.supporting.slice(0, 3), opposing: r.opposing.slice(0, 2), adjustments: r.adjustments } : null,
    model: src.model,
    feature_hash: src.feature_hash,
    generated_at: src.generated_at,
    locked_at: lock?.locked_at || null,
    lock_at: new Date(Date.parse(src.game.scheduled_tip_utc) - LOCK_POLICY.lock_minutes_before_tip * 60e3).toISOString(),
    lock_policy: LOCK_POLICY.id,
    grade: grade || null
  };
}

async function loadCall(env, ledger, gameId) {
  const [doc, lock, grade] = await Promise.all([
    env.WNBA_KV.get(KV(ledger, 'pred', gameId), 'json'),
    env.WNBA_KV.get(KV(ledger, 'lock', gameId), 'json'),
    env.WNBA_KV.get(KV(ledger, 'grade', gameId), 'json')
  ]);
  return { doc: doc || (lock ? { game: lock.game, reasoning: lock.reasoning } : null), lock, grade };
}

// ------------------------------------------------------------------ public

export async function pbeStatus({ env }) {
  const index = env.WNBA_KV ? await env.WNBA_KV.get(KV(env.PBE_PUBLISH === 'true' ? 'official' : 'shadow', 'index'), 'json') : null;
  const hold = RECEIPT.holdout?.logistic_chosen?.pooled || {};
  return json({
    ok: true,
    data: {
      model_id: ARTIFACT.model_id,
      model_type: ARTIFACT.model_type,
      artifact_sha256: MANIFEST.files['artifact.json'],
      feature_spec_sha256: MANIFEST.files['feature_spec.json'],
      validation_receipt_sha256: MANIFEST.files['validation_receipt.json'],
      training_window: MANIFEST.training_window,
      features: ARTIFACT.feature_order,
      holdout: { seasons: RECEIPT.protocol?.holdout_seasons, n: hold.n, log_loss: hold.log_loss, brier: hold.brier, accuracy: hold.accuracy, roc_auc: hold.roc_auc, calibration_slope: hold.calibration_slope },
      market_benchmark_note: 'On 2026 games with a sportsbook price, the de-vigged market predicted outcomes better than the model (log loss 0.579 vs 0.591, n=277). PBE Edge measures disagreement with the market, not proven value.',
      known_limits: RECEIPT.known_limits,
      runner_mode: env.PBE_MODE || 'off',
      published: env.PBE_PUBLISH === 'true',
      contract: CONTRACT,
      lock_policy: LOCK_POLICY,
      last_run_at: index?.generated_at || null
    }
  }, 60);
}

export async function pbeCoverage({ env }) {
  const ledger = env.PBE_PUBLISH === 'true' ? 'official' : 'shadow';
  const index = env.WNBA_KV ? await env.WNBA_KV.get(KV(ledger, 'index'), 'json') : null;
  const now = Date.now();
  const games = (index?.games || [])
    .filter((g) => Date.parse(g.scheduled_tip_utc) > now - 3 * 3600e3)
    .map((g) => ({ game_id: g.game_id, scheduled_tip_utc: g.scheduled_tip_utc, home_team_id: g.home_team_id, away_team_id: g.away_team_id, phase: g.locked ? 'LOCKED' : lockPhase(g.scheduled_tip_utc, now) === 'pre_lock' ? 'PRE_LOCK' : 'NOT_LOCKED' }));
  return json({ ok: true, data: { published: env.PBE_PUBLISH === 'true', availability: env.PBE_PUBLISH === 'true' ? 'LIVE' : 'MODEL_IN_VALIDATION', generated_at: index?.generated_at || null, games } }, 30);
}

export async function trackRecordPublic({ env }) {
  const official = await officialRows(env);
  if (!official.ok) {
    return json({ ok: true, data: { ledger_status: official.status, record: null, message: 'The official WNBA PBE ledger is not readable from this service yet.' } }, 30);
  }
  return json({ ok: true, data: { ledger_status: 'CONNECTED', contract: CONTRACT, record: trackRecordAggregate(official.rows), starts: 'The live record starts at 0-0 with the first official locked pick. Backtests are never counted here.' } }, 60);
}

// ------------------------------------------------------------------ protected

export async function pbePicks({ request, env }) {
  const g = await gate(request, env);
  if (g instanceof Response) return g;
  const index = await env.WNBA_KV.get(KV(g.vis.ledger, 'index'), 'json');
  const now = Date.now();
  const ids = (index?.games || []).filter((x) => Date.parse(x.scheduled_tip_utc) > now - 36 * 3600e3).map((x) => x.game_id);
  const calls = [];
  for (const id of ids) {
    const { doc, lock, grade } = await loadCall(env, g.vis.ledger, id);
    if (doc) calls.push(callItem(doc, lock, grade, g.vis.ledger));
  }
  calls.sort((a, b) => Date.parse(a.game.scheduled_tip_utc) - Date.parse(b.game.scheduled_tip_utc));
  return privateJson(request, { ok: true, data: { access: 'granted', availability: g.vis.mode === 'shadow' ? 'SHADOW_OWNER_ONLY' : 'LIVE', generated_at: index?.generated_at || null, picks: calls } });
}

export async function pbeGame({ request, env, params }) {
  const g = await gate(request, env);
  if (g instanceof Response) return g;
  const { doc, lock, grade } = await loadCall(env, g.vis.ledger, params.id);
  if (!doc) return privateJson(request, { ok: false, error: { code: 'no_call', message: 'No PBE call exists for this game.' } }, 404);
  return privateJson(request, { ok: true, data: callItem(doc, lock, grade, g.vis.ledger) });
}

export async function pbeTeam({ request, env, params }) {
  const g = await gate(request, env);
  if (g instanceof Response) return g;
  const index = await env.WNBA_KV.get(KV(g.vis.ledger, 'index'), 'json');
  const now = Date.now();
  const next = (index?.games || [])
    .filter((x) => (x.home_team_id === params.id || x.away_team_id === params.id) && Date.parse(x.scheduled_tip_utc) > now - 3 * 3600e3)
    .sort((a, b) => Date.parse(a.scheduled_tip_utc) - Date.parse(b.scheduled_tip_utc))[0];
  if (!next) return privateJson(request, { ok: true, data: { access: 'granted', team_id: params.id, call: null, reason: 'no_upcoming_covered_game' } });
  const { doc, lock, grade } = await loadCall(env, g.vis.ledger, next.game_id);
  if (!doc) return privateJson(request, { ok: true, data: { access: 'granted', team_id: params.id, call: null, reason: 'no_upcoming_covered_game' } });
  const item = callItem(doc, lock, grade, g.vis.ledger);
  if (!item.call) return privateJson(request, { ok: true, data: { access: 'granted', team_id: params.id, ...item } });
  // Orientation comes from the same canonical document (or its frozen lock) — never a second computation.
  const source = lock ? { ...doc, ...lockAsDoc(lock) } : doc;
  const oriented = orientDoc(source, params.id);
  return privateJson(request, { ok: true, data: { access: 'granted', ...item, oriented: { team_id: oriented.team_id, opponent_id: oriented.opponent_id, is_home: oriented.is_home, team_probability: oriented.team_probability, opponent_probability: oriented.opponent_probability, team_is_pick: oriented.team_is_pick, supporting: oriented.supporting, opposing: oriented.opposing, adjustments: oriented.adjustments } } });
}

function lockAsDoc(lock) {
  return { game: lock.game, model: lock.model, p_home: lock.p_home, p_away: 1 - lock.p_home, call: lock.call, no_call_reason: lock.no_call_reason, pick_team_id: lock.selected_team_id, pick_probability: lock.win_probability, confidence: lock.confidence, reasoning: lock.reasoning, market: lock.market_at_lock, feature_hash: lock.feature_hash, generated_at: lock.source_generated_at };
}

export async function trackRecordLedger({ request, env }) {
  const g = await gate(request, env);
  if (g instanceof Response) return g;
  if (g.vis.mode === 'shadow') {
    const index = await env.WNBA_KV.get(KV('shadow', 'index'), 'json');
    const rows = [];
    for (const x of index?.locked_history || []) {
      const [lock, grade] = await Promise.all([env.WNBA_KV.get(KV('shadow', 'lock', x), 'json'), env.WNBA_KV.get(KV('shadow', 'grade', x), 'json')]);
      if (lock) rows.push(ledgerRow(lock, grade));
    }
    return privateJson(request, { ok: true, data: { ledger: 'shadow', shadow: true, note: 'Dry-run shadow locks. Never part of the official record.', rows } });
  }
  const official = await officialRows(env, { detail: true });
  if (!official.ok) return privateJson(request, { ok: true, data: { ledger: 'official', ledger_status: official.status, rows: [] } });
  return privateJson(request, { ok: true, data: { ledger: 'official', ledger_status: 'CONNECTED', rows: official.rows.map((r) => r.row) } });
}

function ledgerRow(lock, grade) {
  return {
    game: lock.game, call: lock.call, selected_team_id: lock.selected_team_id, win_probability: lock.win_probability, confidence: lock.confidence,
    market_devig_probability: lock.market_at_lock?.pick?.devig_probability ?? null, consensus_moneyline: lock.market_at_lock?.pick?.consensus_moneyline ?? null,
    pbe_edge_pts: lock.market_at_lock?.pbe_edge_pts ?? null, locked_at: lock.locked_at, model_id: lock.model.model_id, grade: grade || null
  };
}

// ------------------------------------------------------------------ official ledger (Supabase tkmln, service role)

async function sb(env, path) {
  const res = await fetch(`${env.PBE_SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: env.PBE_SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.PBE_SUPABASE_SERVICE_ROLE_KEY}`, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`supabase_${res.status}`);
  return res.json();
}

async function officialRows(env, { detail = false } = {}) {
  if (!env.PBE_SUPABASE_URL || !env.PBE_SUPABASE_SERVICE_ROLE_KEY) return { ok: false, status: 'NOT_CONNECTED' };
  try {
    const locks = await sb(env, `wnba_pbe_locked_predictions?contract=eq.${CONTRACT}&select=prediction_id,game_id,scheduled_tip_utc,home_team_id,away_team_id,call,selected_team_id,win_probability,confidence,locked_at,model_id,market_devig_probability,pbe_edge_at_lock,market_at_lock&order=scheduled_tip_utc.desc&limit=2000`);
    const grades = locks.length ? await sb(env, 'wnba_pbe_current_grades?select=prediction_id,revision,result,home_score,away_score,winner_team_id,graded_at,correction_reason&limit=2000') : [];
    const byId = new Map(grades.map((x) => [x.prediction_id, x]));
    const rows = locks.map((l) => {
      const gr = byId.get(l.prediction_id) || null;
      return {
        call: l.call, win_probability: l.win_probability, grade: gr ? { result: gr.result } : null,
        row: detail ? {
          game: { game_id: l.game_id, scheduled_tip_utc: l.scheduled_tip_utc, home_team_id: l.home_team_id, away_team_id: l.away_team_id },
          call: l.call, selected_team_id: l.selected_team_id, win_probability: l.win_probability, confidence: l.confidence,
          market_devig_probability: l.market_devig_probability, consensus_moneyline: l.market_at_lock?.pick?.consensus_moneyline ?? null,
          pbe_edge_pts: l.pbe_edge_at_lock === null ? null : round(l.pbe_edge_at_lock * 100, 1), locked_at: l.locked_at, model_id: l.model_id,
          grade: gr ? { result: gr.result, revision: gr.revision, home_score: gr.home_score, away_score: gr.away_score, graded_at: gr.graded_at, correction_reason: gr.correction_reason } : null
        } : undefined
      };
    });
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, status: 'UNREACHABLE' };
  }
}

function json(body, maxAge = 0) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store', 'x-content-type-options': 'nosniff' } });
}
