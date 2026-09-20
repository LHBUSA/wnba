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
import TEAM_LOGOS from '../../../data/team-logos.json' with { type: 'json' };
import { resolveAccount } from './account.js';
import { privateJson } from './auth.js';
import { orientDoc, lockPhase, trackRecordAggregate, LOCK_POLICY, CONTRACT, ELIGIBILITY } from '../../shared/pbe-runtime.js';

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
    ? { ...doc, generated_at: lock.source_generated_at, p_home: lock.p_home, p_away: 1 - lock.p_home, call: lock.call, no_call_reason: lock.no_call_reason, pick_team_id: lock.selected_team_id, pick_probability: lock.win_probability, confidence: lock.confidence, flags: lock.flags || [], reasoning: lock.reasoning, market: lock.market_at_lock, feature_hash: lock.feature_hash, model: lock.model, game: lock.game }
    : doc;
  const phase = phaseOf(src, lock);
  if (phase === 'NOT_LOCKED') {
    // Tip has passed without a recorded lock: there is no official call, and a stale provisional one is never shown.
    return { ledger, game: src.game, phase, call: null, reason: 'no_lock_recorded_before_tip' };
  }
  const side = src.pick_team_id === src.game.home_team_id ? 'home' : src.pick_team_id === src.game.away_team_id ? 'away' : null;
  const r = side ? src.reasoning?.[side] : null;
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
    flags: src.flags || [],
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

const OFFICIAL_LOCK_SELECT = 'prediction_id,contract,game_id,season,season_type,scheduled_tip_utc,home_team_id,away_team_id,neutral_site,call,no_call_reason,selected_team_id,selected_side,p_home,win_probability,confidence,feature_vector,feature_hash,model_id,artifact_sha256,feature_spec_sha256,reasoning,generated_at,locked_at,lock_policy,market_at_lock,market_devig_probability,pbe_edge_at_lock';

function officialLockDoc(row, doc = null) {
  return {
    schema: 'pbe-wnba-lock/1',
    ledger: 'official',
    contract: row.contract || CONTRACT,
    lock_policy: row.lock_policy || LOCK_POLICY.id,
    locked_at: row.locked_at,
    prediction_id: row.prediction_id,
    source_generated_at: row.generated_at,
    game: doc?.game || {
      game_id: String(row.game_id),
      season: row.season,
      season_type: row.season_type,
      scheduled_tip_utc: row.scheduled_tip_utc,
      neutral_site: Boolean(row.neutral_site),
      home_team_id: String(row.home_team_id),
      away_team_id: String(row.away_team_id),
      home: null,
      away: null
    },
    model: doc?.model || {
      model_id: row.model_id,
      artifact_sha256: row.artifact_sha256,
      feature_spec_sha256: row.feature_spec_sha256,
      feature_schema: null
    },
    call: row.call,
    no_call_reason: row.no_call_reason,
    flags: doc?.flags || [],
    eligibility: doc?.eligibility || null,
    p_home: row.p_home,
    selected_team_id: row.selected_team_id,
    selected_side: row.selected_side,
    win_probability: row.win_probability,
    confidence: row.confidence,
    feature_order: row.feature_vector?.order ?? doc?.feature_order ?? [],
    feature_vector: row.feature_vector?.values ?? doc?.feature_vector ?? [],
    feature_hash: row.feature_hash,
    reasoning: row.reasoning || doc?.reasoning || { home: { supporting: [], opposing: [], adjustments: [] }, away: { supporting: [], opposing: [], adjustments: [] } },
    market_at_lock: row.market_at_lock || { available: false, reason: 'no_market_at_lock', pbe_edge: null },
    pbe_edge_at_lock: row.pbe_edge_at_lock,
    mirrored_from_ledger: true
  };
}

async function officialLockWindow(env, { now = Date.now(), pastHours = 36, withGrades = true } = {}) {
  if (!env.PBE_SUPABASE_URL || !env.PBE_SUPABASE_SERVICE_ROLE_KEY) return [];
  try {
    const since = new Date(now - pastHours * 3600e3).toISOString();
    const locks = await sb(env, `wnba_pbe_locked_predictions?contract=eq.${CONTRACT}&scheduled_tip_utc=gte.${encodeURIComponent(since)}&select=${OFFICIAL_LOCK_SELECT}&order=scheduled_tip_utc.asc&limit=200`);
    if (!withGrades || !locks.length) return locks.map((lock) => ({ lock, grade: null }));
    const grades = await sb(env, 'wnba_pbe_current_grades?select=prediction_id,revision,result,home_score,away_score,winner_team_id,graded_at,correction_reason&limit=2000');
    const byPrediction = new Map(grades.map((grade) => [String(grade.prediction_id), grade]));
    return locks.map((lock) => ({ lock, grade: byPrediction.get(String(lock.prediction_id)) || null }));
  } catch {
    // KV remains a last-good serving path if the durable ledger is temporarily unreachable.
    return [];
  }
}

async function officialLockByGame(env, gameId) {
  if (!env.PBE_SUPABASE_URL || !env.PBE_SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const locks = await sb(env, `wnba_pbe_locked_predictions?contract=eq.${CONTRACT}&game_id=eq.${encodeURIComponent(gameId)}&select=${OFFICIAL_LOCK_SELECT}&limit=1`);
    if (!locks.length) return null;
    const lock = locks[0];
    const grades = await sb(env, `wnba_pbe_current_grades?prediction_id=eq.${encodeURIComponent(lock.prediction_id)}&select=prediction_id,revision,result,home_score,away_score,winner_team_id,graded_at,correction_reason&limit=1`);
    return { lock, grade: grades[0] || null };
  } catch {
    return null;
  }
}

function mergeOfficialGames(indexGames, entries) {
  const games = [...(indexGames || [])];
  for (const entry of entries) {
    const row = entry.lock;
    const id = String(row.game_id);
    if (games.some((g) => String(g.game_id) === id)) {
      const existing = games.find((g) => String(g.game_id) === id);
      existing.locked = true;
      continue;
    }
    games.push({
      game_id: id,
      scheduled_tip_utc: row.scheduled_tip_utc,
      home_team_id: String(row.home_team_id),
      away_team_id: String(row.away_team_id),
      locked: true
    });
  }
  return games.sort((a, b) => Date.parse(a.scheduled_tip_utc) - Date.parse(b.scheduled_tip_utc));
}

async function loadCallAuthoritative(env, ledger, gameId, ledgerEntry = null) {
  let { doc, lock, grade } = await loadCall(env, ledger, gameId);
  if (ledger === 'official' && ledgerEntry?.lock) {
    // The immutable Supabase row wins over every mutable discovery/index/cache layer.
    lock = officialLockDoc(ledgerEntry.lock, doc);
    grade = ledgerEntry.grade || grade;
    if (!doc) doc = { game: lock.game, reasoning: lock.reasoning };
  }
  return { doc, lock, grade };
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
      // As reported by the runner itself (wnba-ingest writes its mode into the ledger index every pass).
      runner_mode: index?.mode || 'not_running',
      published: env.PBE_PUBLISH === 'true',
      contract: CONTRACT,
      eligibility: { contract_id: ELIGIBILITY.contract_id, status: ELIGIBILITY.status, no_call_below: ELIGIBILITY.rule.no_call_below, reason: ELIGIBILITY.rule.reason, metadata_flags: ELIGIBILITY.metadata_flags.map((f) => ({ flag: f.flag, when: f.when, display: f.display, effect: f.effect })), holdout_caveat: ELIGIBILITY.holdout_caveats.interpretation },
      lock_policy: { ...LOCK_POLICY, status: 'EXPERIMENTAL_SHADOW' },
      last_run_at: index?.generated_at || null
    }
  }, 60);
}

export async function pbeCoverage({ env }) {
  const ledger = env.PBE_PUBLISH === 'true' ? 'official' : 'shadow';
  const index = env.WNBA_KV ? await env.WNBA_KV.get(KV(ledger, 'index'), 'json') : null;
  const now = Date.now();
  const official = ledger === 'official' ? await officialLockWindow(env, { now, pastHours: 3, withGrades: false }) : [];
  const games = mergeOfficialGames(index?.games, official)
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

// ------------------------------------------------------------------ public sampler

const TEAM_IDENTITY = new Map((TEAM_LOGOS || []).map((team) => [String(team.team_id), team]));

function sampleTeam(id, team = {}) {
  const local = TEAM_IDENTITY.get(String(id || '')) || {};
  return {
    team_id: String(id || ''),
    name: team?.name || team?.display_name || team?.displayName || local.name || null,
    short_name: team?.short_name || team?.shortDisplayName || local.name || null,
    abbr: team?.abbr || team?.abbreviation || local.abbr || null,
    logo: team?.logo || team?.logo_url || team?.logos?.[0]?.href || (id ? `https://wnba.propbetedge.ai/media/teams/${id}/128.webp` : null)
  };
}

function etDay(value) {
  const d = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Tiny first-party top-of-funnel contract. It exposes the first two official
 * locked game calls published for the current ET day after PBE_PUBLISH is live.
 * Those two free identities stay fixed for the day instead of rotating as games tip.
 * It never returns reasoning,
 * feature vectors, hashes, full market ladders, historical rows or more than
 * two selections. WNBA Pro remains the full board.
 */
export async function pbeFreeSample({ env }) {
  const generated_at = new Date().toISOString();
  const empty = (published, reason = null) => json({
    ok: true,
    data: {
      contract: 'pbe-free-sample-v1',
      sport: 'WNBA',
      generated_at,
      published,
      reason,
      count: 0,
      picks: [],
      full_product_url: 'https://wnba.propbetedge.ai/pbe-picks'
    }
  }, 30);

  if (env.PBE_PUBLISH !== 'true') return empty(false, 'model_not_published');
  if (!env.WNBA_KV) return empty(true, 'ledger_unavailable');

  const index = await env.WNBA_KV.get(KV('official', 'index'), 'json');
  const now = Date.now();
  // Pull a wide enough durable window to cover the entire current ET day, then
  // freeze the public sampler to the first two official locks of that day.
  // This keeps a morning/early-afternoon free pick visible after tip instead of
  // silently replacing it with later games and breaking the public record.
  const official = await officialLockWindow(env, { now, pastHours: 30, withGrades: false });
  const byGame = new Map(official.map((entry) => [String(entry.lock.game_id), entry]));
  const today = etDay(now);
  const dailyLocked = official
    .filter((entry) => etDay(entry.lock.scheduled_tip_utc) === today && entry.lock.call === 'PICK' && entry.lock.selected_team_id)
    .sort((a, b) => (
      Date.parse(a.lock.locked_at || a.lock.scheduled_tip_utc)
      - Date.parse(b.lock.locked_at || b.lock.scheduled_tip_utc)
    ))
    .slice(0, 2);
  const ids = dailyLocked.length
    ? dailyLocked.map((entry) => String(entry.lock.game_id))
    : mergeOfficialGames(index?.games, official)
      .filter((x) => Date.parse(x.scheduled_tip_utc) > now - 3 * 3600e3)
      .map((x) => String(x.game_id));

  const picks = [];
  for (const id of ids) {
    if (picks.length >= 2) break;
    const { doc, lock, grade } = await loadCallAuthoritative(env, 'official', id, byGame.get(String(id)) || null);
    if (!doc) continue;
    const item = callItem(doc, lock, grade, 'official');
    if (item.call !== 'PICK' || !['PRE_LOCK', 'LOCKED'].includes(item.phase) || !item.pick_team_id) continue;

    const game = item.game || {};
    const side = item.market?.pick_side;
    const quote = side && item.market?.available ? item.market?.[side] : null;
    const pickIsHome = String(item.pick_team_id) === String(game.home_team_id);
    const pickTeam = pickIsHome ? sampleTeam(game.home_team_id, game.home) : sampleTeam(game.away_team_id, game.away);
    const opponent = pickIsHome ? sampleTeam(game.away_team_id, game.away) : sampleTeam(game.home_team_id, game.home);

    picks.push({
      phase: item.phase,
      game_id: String(game.game_id || id),
      scheduled_tip_utc: game.scheduled_tip_utc || null,
      home: sampleTeam(game.home_team_id, game.home),
      away: sampleTeam(game.away_team_id, game.away),
      pick_team: pickTeam,
      opponent,
      model_probability: item.pick_probability,
      confidence: item.confidence,
      odds: quote?.consensus_moneyline ?? null,
      market_probability: quote?.devig_probability ?? null,
      edge_pts: item.market?.pbe_edge_pts ?? null,
      market_captured_at: item.market?.captured_at ?? null,
      market_current: item.market?.current === true,
      locked_at: item.locked_at || null,
      model_id: item.model?.model_id || null
    });
  }

  return json({
    ok: true,
    data: {
      contract: 'pbe-free-sample-v1',
      sport: 'WNBA',
      generated_at: index?.generated_at || generated_at,
      published: true,
      count: picks.length,
      picks,
      full_product_url: 'https://wnba.propbetedge.ai/pbe-picks'
    }
  }, 30);
}

// ------------------------------------------------------------------ protected

export async function pbePicks({ request, env }) {
  const g = await gate(request, env);
  if (g instanceof Response) return g;
  const index = await env.WNBA_KV.get(KV(g.vis.ledger, 'index'), 'json');
  const now = Date.now();
  const official = g.vis.ledger === 'official' ? await officialLockWindow(env, { now, pastHours: 36, withGrades: true }) : [];
  const byGame = new Map(official.map((entry) => [String(entry.lock.game_id), entry]));
  const ids = mergeOfficialGames(index?.games, official)
    .filter((x) => Date.parse(x.scheduled_tip_utc) > now - 36 * 3600e3)
    .map((x) => String(x.game_id));
  const calls = [];
  for (const id of ids) {
    const { doc, lock, grade } = await loadCallAuthoritative(env, g.vis.ledger, id, byGame.get(String(id)) || null);
    if (doc) calls.push(callItem(doc, lock, grade, g.vis.ledger));
  }
  calls.sort((a, b) => Date.parse(a.game.scheduled_tip_utc) - Date.parse(b.game.scheduled_tip_utc));
  return privateJson(request, { ok: true, data: { access: 'granted', availability: g.vis.mode === 'shadow' ? 'SHADOW_OWNER_ONLY' : 'LIVE', generated_at: index?.generated_at || null, picks: calls } });
}

export async function pbeGame({ request, env, params }) {
  const g = await gate(request, env);
  if (g instanceof Response) return g;
  const entry = g.vis.ledger === 'official' ? await officialLockByGame(env, params.id) : null;
  const { doc, lock, grade } = await loadCallAuthoritative(env, g.vis.ledger, params.id, entry);
  if (!doc) return privateJson(request, { ok: false, error: { code: 'no_call', message: 'No PBE call exists for this game.' } }, 404);
  return privateJson(request, { ok: true, data: callItem(doc, lock, grade, g.vis.ledger) });
}

export async function pbeTeam({ request, env, params }) {
  const g = await gate(request, env);
  if (g instanceof Response) return g;
  const index = await env.WNBA_KV.get(KV(g.vis.ledger, 'index'), 'json');
  const now = Date.now();
  const official = g.vis.ledger === 'official' ? await officialLockWindow(env, { now, pastHours: 3, withGrades: true }) : [];
  const byGame = new Map(official.map((entry) => [String(entry.lock.game_id), entry]));
  const next = mergeOfficialGames(index?.games, official)
    .filter((x) => (String(x.home_team_id) === String(params.id) || String(x.away_team_id) === String(params.id)) && Date.parse(x.scheduled_tip_utc) > now - 3 * 3600e3)
    .sort((a, b) => Date.parse(a.scheduled_tip_utc) - Date.parse(b.scheduled_tip_utc))[0];
  if (!next) return privateJson(request, { ok: true, data: { access: 'granted', team_id: params.id, call: null, reason: 'no_upcoming_covered_game' } });
  const { doc, lock, grade } = await loadCallAuthoritative(env, g.vis.ledger, next.game_id, byGame.get(String(next.game_id)) || null);
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
