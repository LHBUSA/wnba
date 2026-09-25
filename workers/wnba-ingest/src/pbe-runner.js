// PBE WNBA runner — rows, scoring, observations, locks, grades. Dispatched every minute by wnba-ingest's cron.
//
// PBE_MODE (wrangler var):
//   off      (default) nothing runs
//   dry_run  SHADOW ledger only: KV keys pbe:v1:shadow:*. Nothing is written to Supabase. Shadow locks are never
//            public and never part of the official record; only the owner's verified session can read them.
//   armed    OFFICIAL ledger: Supabase tkmln wnba_pbe_* (observations, locks, grade revision 1) + KV mirror
//            pbe:v1:official:*. Refuses to run unless PBE_ARMED_BY (owner approval reference) and the Supabase
//            service binding secrets are set. Arming is an owner decision; this file does not arm anything.
//
// Hard rules:
//   - Never score unless the row store holds every final that ended before today's ET date for the current and
//     prior season (a missing game would silently change features).
//   - Sportsbook data is read only after the model probability exists (pbe-runtime marketComparison).
//   - A lock is taken once, from the latest pre-lock document, in the lock window; after tip nothing is locked.

import { cachedJson, fetchJsonWithTimeout } from '../../shared/fetcher.js';
import { ESPN } from '../../shared/espn.js';
import { teamGameRowFromSummary, etDateOf } from '../../shared/pbe-wnba-features.js';
import { buildPredictionDoc, observationRow, observationDue, lockPhase, scoringDue, lockDoc, gradeFromFinal, LOCK_POLICY, CONTRACT } from '../../shared/pbe-runtime.js';

export const ROWS_KEY = (season) => `pbe:rows:v1:${season}`;
const K = (ledger, kind, id) => `pbe:v1:${ledger}:${kind}${id ? `:${id}` : ''}`;
const ROWS_PER_RUN = 30;
const DOC_TTL_S = 7 * 86400;

// ------------------------------------------------------------------ season events + row store

/** Raw ESPN events for a calendar year (whole-year form; the ranged form 400s for past seasons). */
async function yearEvents(year, ttlS) {
  const r = await cachedJson({ url: `${ESPN.site}/scoreboard?dates=${year}&limit=1000`, ttlS, timeoutMs: 20000 });
  if (!r.body || !Array.isArray(r.body.events)) throw new Error(`scoreboard_${year}_unavailable:${r.error || 'no_body'}`);
  return r.body.events;
}

/** Same franchise rule as the training dataset: a team with >= 10 regular-season finals that season. */
export function franchiseSet(events, season) {
  const n = new Map();
  for (const e of events) {
    if (e.season?.year !== season || e.season?.type !== 2 || e.status?.type?.name !== 'STATUS_FINAL') continue;
    for (const c of e.competitions?.[0]?.competitors || []) n.set(String(c.id), (n.get(String(c.id)) || 0) + 1);
  }
  return new Set([...n].filter(([, c]) => c >= 10).map(([id]) => id));
}

export function eligibleFinals(events, season) {
  const fr = franchiseSet(events, season);
  return events.filter((e) => e.season?.year === season && (e.season?.type === 2 || e.season?.type === 3) && e.status?.type?.name === 'STATUS_FINAL'
    && (e.competitions?.[0]?.competitors || []).length === 2 && e.competitions[0].competitors.every((c) => fr.has(String(c.id))));
}

/** Append missing finals (bounded per run). Returns completeness against finals dated before `beforeEtDate`. */
export async function maintainRows(env, season, { beforeEtDate, fetchSummary = (id) => fetchJsonWithTimeout(`${ESPN.site}/summary?event=${id}`, { timeoutMs: 12000 }), events }) {
  const store = (await env.WNBA_KV.get(ROWS_KEY(season), 'json')) || { schema: 'pbe-rows-store/1', season, rows: [], event_ids: [] };
  const have = new Set(store.event_ids);
  const finals = eligibleFinals(events, season);
  const missing = finals.filter((e) => !have.has(String(e.id)));
  const errors = [];
  let added = 0;
  for (const e of missing.slice(0, ROWS_PER_RUN)) {
    try {
      const pair = teamGameRowFromSummary(await fetchSummary(e.id), { season, season_type: e.season.type });
      store.rows.push(...pair);
      store.event_ids.push(String(e.id));
      added += 1;
    } catch (err) {
      errors.push({ event_id: String(e.id), error: String(err.message || err).slice(0, 120) });
    }
  }
  if (added) {
    store.updated_at = new Date().toISOString();
    await env.WNBA_KV.put(ROWS_KEY(season), JSON.stringify(store));
  }
  const nowHave = new Set(store.event_ids);
  const required = finals.filter((e) => etDateOf(new Date(e.date).toISOString()) < beforeEtDate);
  const stillMissing = required.filter((e) => !nowHave.has(String(e.id))).map((e) => String(e.id));
  return { season, rows: store.rows, finals: finals.length, stored: store.event_ids.length, added, errors, complete: stillMissing.length === 0, missing_required: stillMissing.slice(0, 20), missing_required_count: stillMissing.length };
}

// ------------------------------------------------------------------ market lookup (snapshot written by the odds task)

export function findMarketEvent(latest, game) {
  if (!latest?.events?.length) return null;
  const byId = latest.events.find((e) => e.game_id && String(e.game_id) === game.event_id);
  if (byId) return byId;
  const tip = Date.parse(game.start_utc);
  return latest.events.find((e) => String(e.home_team_id) === game.home_id && String(e.away_team_id) === game.away_id && Math.abs(Date.parse(e.commence_time) - tip) < 6 * 3600e3) || null;
}

// ------------------------------------------------------------------ official ledger writer (armed only)

async function sbInsert(env, table, row) {
  const res = await fetch(`${env.PBE_SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: env.PBE_SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.PBE_SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(10000)
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`supabase_${table}_${res.status}:${text.slice(0, 200)}`);
    err.status = res.status;
    err.code = (() => { try { return JSON.parse(text).code; } catch { return null; } })();
    throw err;
  }
  return JSON.parse(text)[0];
}

/** An insert refused because the prediction is already graded: unique index (23505) or the revision trigger (P0001). */
export function gradeAlreadyInLedger(e) {
  return e?.code === '23505' || (e?.code === 'P0001' && /must follow revision/.test(String(e?.message || '')));
}

async function sbSelect(env, path) {
  const res = await fetch(`${env.PBE_SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: env.PBE_SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.PBE_SUPABASE_SERVICE_ROLE_KEY}`, accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`supabase_select_${res.status}:${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** KV mirror of a lock the database already holds. Every frozen value comes from the ledger row, never from a newer document.
 * doc is optional: Supabase is the system of record and reconciliation must still work after the provisional KV doc expires. */
export function lockDocFromLedgerRow(row, doc, ledger) {
  const game = doc?.game || {
    game_id: String(row.game_id),
    season: row.season,
    season_type: row.season_type,
    scheduled_tip_utc: row.scheduled_tip_utc,
    neutral_site: Boolean(row.neutral_site),
    home_team_id: String(row.home_team_id),
    away_team_id: String(row.away_team_id),
    home: null,
    away: null
  };
  const model = doc?.model || {
    model_id: row.model_id,
    artifact_sha256: row.artifact_sha256,
    feature_spec_sha256: row.feature_spec_sha256,
    feature_schema: null
  };
  return {
    schema: 'pbe-wnba-lock/1',
    ledger,
    contract: row.contract || CONTRACT,
    lock_policy: row.lock_policy || LOCK_POLICY.id,
    locked_at: row.locked_at,
    prediction_id: row.prediction_id,
    source_generated_at: row.generated_at,
    game,
    model,
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
    reasoning: row.reasoning,
    market_at_lock: row.market_at_lock || { available: false, reason: 'no_market_at_lock', pbe_edge: null },
    pbe_edge_at_lock: row.pbe_edge_at_lock,
    mirrored_from_ledger: true
  };
}

/** Reconcile recent immutable Supabase locks into the KV serving index.
 * Supabase wins even when a Worker request dies after the database commit. */
export async function reconcileOfficialLocks(env, index, { now = Date.now(), days = 7 } = {}) {
  const since = new Date(now - days * 86400e3).toISOString();
  const rows = await sbSelect(env, `wnba_pbe_locked_predictions?contract=eq.${CONTRACT}&scheduled_tip_utc=gte.${encodeURIComponent(since)}&select=*&order=scheduled_tip_utc.asc&limit=200`);
  let mirrored = 0;
  let indexed = 0;
  for (const row of rows) {
    const id = String(row.game_id);
    let lock = await env.WNBA_KV.get(K('official', 'lock', id), 'json');
    if (!lock || !lock.prediction_id) {
      const doc = await env.WNBA_KV.get(K('official', 'pred', id), 'json');
      lock = lockDocFromLedgerRow(row, doc, 'official');
      await env.WNBA_KV.put(K('official', 'lock', id), JSON.stringify(lock), { expirationTtl: 30 * 86400 });
      mirrored += 1;
    }
    if (!index.locked_history.includes(id)) {
      index.locked_history.push(id);
      indexed += 1;
    }
  }
  return { rows: rows.length, mirrored, indexed };
}

function lockRowFromObservation(obs, doc) {
  return {
    contract: CONTRACT,
    game_id: obs.game_id, season: obs.season, season_type: obs.season_type, scheduled_tip_utc: obs.scheduled_tip_utc,
    home_team_id: obs.home_team_id, away_team_id: obs.away_team_id, neutral_site: obs.neutral_site,
    call: obs.call, no_call_reason: obs.no_call_reason,
    selected_team_id: obs.pick_team_id, selected_side: obs.pick_team_id ? (obs.pick_team_id === obs.home_team_id ? 'home' : 'away') : null,
    p_home: obs.p_home, win_probability: obs.pick_probability, confidence: obs.confidence,
    feature_vector: obs.feature_vector, feature_hash: obs.feature_hash,
    model_id: obs.model_id, artifact_sha256: doc.model.artifact_sha256, feature_spec_sha256: doc.model.feature_spec_sha256,
    reasoning: obs.reasoning, generated_at: obs.generated_at, lock_policy: LOCK_POLICY.id, source_observation_id: obs.observation_id,
    market_at_lock: obs.market, market_devig_probability: obs.call === 'PICK' ? obs.market_devig_probability : null,
    pbe_edge_at_lock: obs.call === 'PICK' && obs.market_devig_probability !== null ? obs.pbe_edge : null
  };
}

// ------------------------------------------------------------------ lock-policy evidence (shadow measurement only)

// Injury-feed state for both teams at T-60, T-30, T-15 and T-0. Nothing here changes a prediction or a lock; it is
// the evidence the owner reviews before any lock time is made permanent (owner decision 5).
export const AVAIL_CHECKPOINTS = [60, 30, 15, 0];
export const NEAR_TIP_MINUTES = 75;

export function checkpointsDue(tipIso, recorded, now = Date.now()) {
  const tip = Date.parse(tipIso);
  if (!Number.isFinite(tip) || now > tip + 20 * 60e3) return [];
  return AVAIL_CHECKPOINTS.filter((c) => now >= tip - c * 60e3 && !recorded.includes(String(c)));
}

export function teamAvailability(snapshot, teamIds) {
  const ids = new Set(teamIds.map(String));
  return Object.entries(snapshot?.items || {})
    .filter(([, v]) => ids.has(String(v.team_id)))
    .map(([key, v]) => ({ key, athlete_id: v.athlete_id || null, team_id: String(v.team_id), status: v.status || null, source_updated_at: v.source_updated_at || null }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function diffAvailability(before, after) {
  const b = new Map((before || []).map((p) => [p.key, p]));
  const a = new Map((after || []).map((p) => [p.key, p]));
  const changes = [];
  for (const [k, p] of a) {
    const q = b.get(k);
    if (!q) changes.push({ key: k, team_id: p.team_id, kind: 'added', status_after: p.status });
    else if (q.status !== p.status) changes.push({ key: k, team_id: p.team_id, kind: 'status_changed', status_before: q.status, status_after: p.status });
    else if (q.source_updated_at !== p.source_updated_at) changes.push({ key: k, team_id: p.team_id, kind: 'source_updated', status_after: p.status });
  }
  for (const [k, q] of b) if (!a.has(k)) changes.push({ key: k, team_id: q.team_id, kind: 'removed', status_before: q.status });
  return changes;
}

async function recordCheckpoints(env, games, now, ledger = 'shadow') {
  let recorded = 0;
  let snapshot = null;
  for (const g of games) {
    const key = `pbe:v1:shadow:availchk:${g.game_id}`;
    const doc = (await env.WNBA_KV.get(key, 'json')) || { schema: 'pbe-availability-checkpoints/2', game: g, checkpoints: {} };
    const due = checkpointsDue(g.scheduled_tip_utc, Object.keys(doc.checkpoints), now);
    if (!due.length) continue;
    snapshot ||= await env.WNBA_KV.get('avail:v1:snapshot', 'json');
    const players = teamAvailability(snapshot, [g.home_team_id, g.away_team_id]);
    // The prediction as it stood at this checkpoint (the latest pre-lock document, or the frozen lock after it).
    const pred = (await env.WNBA_KV.get(`pbe:v1:${ledger}:lock:${g.game_id}`, 'json')) || (await env.WNBA_KV.get(`pbe:v1:${ledger}:pred:${g.game_id}`, 'json'));
    const prediction = pred ? {
      source: pred.schema?.startsWith('pbe-wnba-lock') ? 'lock' : 'pre_lock_document',
      generated_at: pred.source_generated_at || pred.generated_at || null,
      call: pred.call, p_home: pred.p_home, pick_team_id: pred.selected_team_id ?? pred.pick_team_id ?? null,
      pick_probability: pred.win_probability ?? pred.pick_probability ?? null,
      pbe_edge: (pred.market_at_lock || pred.market)?.pbe_edge ?? null,
      market_captured_at: (pred.market_at_lock || pred.market)?.captured_at ?? null,
      feature_hash: pred.feature_hash, flags: pred.flags || []
    } : null;
    for (const c of due) {
      doc.checkpoints[String(c)] = { recorded_at: new Date(now).toISOString(), minutes_before_tip: Math.round((Date.parse(g.scheduled_tip_utc) - now) / 60e3), feed_captured_at: snapshot?.captured_at || null, feed_age_s: snapshot?.captured_at ? Math.round((now - Date.parse(snapshot.captured_at)) / 1000) : null, players, prediction };
      recorded += 1;
    }
    await env.WNBA_KV.put(key, JSON.stringify(doc), { expirationTtl: 120 * 86400 });
  }
  return recorded;
}

// ------------------------------------------------------------------ postgame final resolution

function assertFinalIdentity(lock, homeId, awayId, id) {
  if (String(homeId || '') !== String(lock?.game?.home_team_id || '')
    || String(awayId || '') !== String(lock?.game?.away_team_id || '')) {
    throw new Error(`grade_final_identity_mismatch:${id}`);
  }
}

function finalFromArchivedGame(archive, lock, id) {
  const game = archive?.summary?.game;
  if (!game || String(game.game_id || '') !== String(id)) return null;
  if (game.status?.name !== 'STATUS_FINAL' || game.status?.completed !== true) return null;
  if (!game.home || !game.away) return null;
  assertFinalIdentity(lock, game.home.team_id, game.away.team_id, id);
  const homeScore = Number(game.home.score);
  const awayScore = Number(game.away.score);
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) return null;
  return {
    status: 'STATUS_FINAL',
    home_score: homeScore,
    away_score: awayScore,
    reference: {
      provider: 'espn',
      source: 'live_archive',
      event_id: String(id),
      url: `${ESPN.site}/summary?event=${encodeURIComponent(id)}`,
      captured_at: archive.archived_at || null
    }
  };
}

function finalFromScoreboardEvent(event, lock, id, now) {
  const c = event?.competitions?.[0];
  const status = event?.status?.type?.name || c?.status?.type?.name || null;
  if (status !== 'STATUS_FINAL') return null;
  const home = c?.competitors?.find((x) => x.homeAway === 'home');
  const away = c?.competitors?.find((x) => x.homeAway === 'away');
  if (!home || !away) return null;
  assertFinalIdentity(lock, home.id, away.id, id);
  const homeScore = Number(typeof home.score === 'object' ? home.score?.value ?? home.score?.displayValue : home.score);
  const awayScore = Number(typeof away.score === 'object' ? away.score?.value ?? away.score?.displayValue : away.score);
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) return null;
  return {
    status: 'STATUS_FINAL',
    home_score: homeScore,
    away_score: awayScore,
    reference: {
      provider: 'espn',
      source: 'season_scoreboard',
      event_id: String(id),
      status,
      url: `${ESPN.site}/scoreboard`,
      captured_at: new Date(now).toISOString()
    }
  };
}

function finalFromRawSummary(summary, lock, id, now) {
  const header = summary?.header;
  const c = header?.competitions?.[0];
  if (!c || String(header?.id || c?.id || '') !== String(id)) return null;
  const status = c?.status?.type?.name || null;
  if (status !== 'STATUS_FINAL' || c?.status?.type?.completed !== true) return null;
  const home = c?.competitors?.find((x) => x.homeAway === 'home');
  const away = c?.competitors?.find((x) => x.homeAway === 'away');
  if (!home || !away) return null;
  assertFinalIdentity(lock, home.id, away.id, id);
  const homeScore = Number(typeof home.score === 'object' ? home.score?.value ?? home.score?.displayValue : home.score);
  const awayScore = Number(typeof away.score === 'object' ? away.score?.value ?? away.score?.displayValue : away.score);
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) return null;
  return {
    status: 'STATUS_FINAL',
    home_score: homeScore,
    away_score: awayScore,
    reference: {
      provider: 'espn',
      source: 'direct_summary_fallback',
      event_id: String(id),
      status,
      url: `${ESPN.site}/summary?event=${encodeURIComponent(id)}`,
      captured_at: new Date(now).toISOString()
    }
  };
}

async function resolveLockedFinal(env, { id, lock, events, now, minute, fetchSummary }) {
  // The live lane runs before PBE every minute and archives a final from the
  // per-day scoreboard + direct summary. Reuse that exact truth first so the
  // website, PBE record and downstream Free Picks ledger cannot diverge.
  const archive = await env.WNBA_KV.get(`game:v1:final:${id}`, 'json');
  const archived = finalFromArchivedGame(archive, lock, id);
  if (archived) return archived;

  // Preserve the existing whole-season scoreboard path as a cheap second lane.
  const event = events.find((x) => String(x.id) === String(id)) || null;
  const scoreboard = finalFromScoreboardEvent(event, lock, id, now);
  if (scoreboard) return scoreboard;

  // If both cached lanes miss a completed game, probe the game itself every
  // five minutes once it is plausibly late enough to be final. This is only a
  // fallback and never grades a non-final summary.
  const tip = Date.parse(lock?.game?.scheduled_tip_utc || 0);
  if (!Number.isFinite(tip) || now < tip + 75 * 60e3 || minute % 5 !== 0) return null;
  const raw = await (fetchSummary
    ? fetchSummary(id)
    : fetchJsonWithTimeout(`${ESPN.site}/summary?event=${encodeURIComponent(id)}`, { timeoutMs: 12000 }));
  return finalFromRawSummary(raw, lock, id, now);
}

// ------------------------------------------------------------------ the task

export function modeOf(env) {
  const mode = env.PBE_MODE || 'off';
  if (!['off', 'dry_run', 'armed'].includes(mode)) throw new Error(`invalid PBE_MODE ${mode}`);
  if (mode === 'armed' && !(env.PBE_ARMED_BY && env.PBE_SUPABASE_URL && env.PBE_SUPABASE_SERVICE_ROLE_KEY)) throw new Error('PBE_MODE=armed requires PBE_ARMED_BY and the PBE Supabase secrets; refusing to run');
  return { mode, ledger: mode === 'armed' ? 'official' : 'shadow' };
}

export async function pbeTask(env, { now = Date.now(), minute = new Date(now).getUTCMinutes(), fetchSummary, eventsFor } = {}) {
  const { mode, ledger } = modeOf(env);
  if (mode === 'off') return { skipped: 'PBE_MODE=off' };
  if (!env.WNBA_KV) throw new Error('WNBA_KV not bound');
  const runId = `pbe-${new Date(now).toISOString()}`;
  const todayEt = etDateOf(new Date(now).toISOString());
  const year = Number(todayEt.slice(0, 4));
  const loadEvents = eventsFor || ((y, ttl) => yearEvents(y, ttl));
  const events = await loadEvents(year, 300);

  const indexKey = K(ledger, 'index');
  const index = (await env.WNBA_KV.get(indexKey, 'json')) || { games: [], locked_history: [] };

  // upcoming games inside the scoring window, same franchise rule as training
  const fr = franchiseSet(events, year);
  const upcoming = events
    .filter((e) => (e.season?.type === 2 || e.season?.type === 3) && e.status?.type?.name === 'STATUS_SCHEDULED')
    .map((e) => {
      const c = e.competitions?.[0] || {};
      const h = c.competitors?.find((x) => x.homeAway === 'home');
      const a = c.competitors?.find((x) => x.homeAway === 'away');
      return h && a ? { event_id: String(e.id), season: e.season.year, season_type: e.season.type, start_utc: new Date(e.date).toISOString(), neutral: Boolean(c.neutralSite), home_id: String(h.id), away_id: String(a.id), home: { team_id: String(h.id), abbr: h.team?.abbreviation || null, name: h.team?.displayName || null }, away: { team_id: String(a.id), abbr: a.team?.abbreviation || null, name: a.team?.displayName || null } } : null;
    })
    .filter((g) => g && fr.has(g.home_id) && fr.has(g.away_id))
    .filter((g) => { const m = (Date.parse(g.start_utc) - now) / 60e3; return m > 0 && m <= LOCK_POLICY.scoring_window_hours * 60; })
    .sort((a, b) => Date.parse(a.start_utc) - Date.parse(b.start_utc));

  const summary = { mode, ledger, run_id: runId, upcoming: upcoming.length, scored: 0, observations: 0, locks: 0, grades: 0, reconciled_locks: 0, ledger_locks_seen: 0, rows: null, skipped: [], errors: [] };

  // Supabase is authoritative in armed mode. Repair any lock that committed there but missed its KV/index
  // mirror BEFORE deciding whether an upcoming game still needs a lock and before grading old locks.
  if (mode === 'armed') {
    try {
      const rec = await reconcileOfficialLocks(env, index, { now });
      summary.reconciled_locks = rec.mirrored;
      summary.ledger_locks_seen = rec.rows;
      if (rec.indexed) summary.skipped.push(`lock_index_recovered:${rec.indexed}`);
    } catch (e) {
      summary.errors.push({ game_id: null, stage: 'lock_reconcile', phase: 'ledger', error: String(e.message || e).slice(0, 300) });
    }
  }

  const due = [];
  for (const g of upcoming) {
    const phase = lockPhase(g.start_utc, now);
    const hasPred = await env.WNBA_KV.get(K(ledger, 'pred', g.event_id));
    const locked = await env.WNBA_KV.get(K(ledger, 'lock', g.event_id));
    if (locked) continue;
    if (phase === 'lock_due' || !hasPred || scoringDue(g.start_utc, minute, now)) due.push({ g, phase });
  }

  if (due.length) {
    const prior = await maintainRows(env, year - 1, { beforeEtDate: todayEt, fetchSummary, events: await loadEvents(year - 1, 86400) });
    const current = await maintainRows(env, year, { beforeEtDate: todayEt, fetchSummary, events });
    summary.rows = { [year - 1]: { stored: prior.stored, finals: prior.finals, complete: prior.complete, missing: prior.missing_required_count }, [year]: { stored: current.stored, finals: current.finals, complete: current.complete, missing: current.missing_required_count } };
    if (!prior.complete || !current.complete) {
      summary.skipped.push('rows_incomplete');
    } else {
      const leagueRows = [...prior.rows, ...current.rows];
      const latest = await env.WNBA_KV.get('odds:v1:latest', 'json');
      for (const { g, phase } of due) {
       let stage = 'score';
       try {
        const asOf = new Date(now).toISOString();
        const marketEvent = findMarketEvent(latest, g);
        const doc = await buildPredictionDoc({ game: g, leagueRows, asOf, marketEvent, marketCapturedAt: marketEvent ? latest.captured_at : null, runId, mode, now });
        await env.WNBA_KV.put(K(ledger, 'pred', g.event_id), JSON.stringify(doc), { expirationTtl: DOC_TTL_S });
        summary.scored += 1;

        const lastKey = K(ledger, 'lastobs', g.event_id);
        const last = await env.WNBA_KV.get(lastKey, 'json');
        const obsDue = observationDue(doc, last, now);
        let observation = null;
        if (obsDue.due || phase === 'lock_due') {
          stage = 'observation';
          const row = observationRow(doc);
          if (mode === 'armed') {
            observation = await sbInsert(env, 'wnba_pbe_prediction_observations', row);
          } else {
            const key = K('shadow', 'obs', g.event_id);
            const list = (await env.WNBA_KV.get(key, 'json')) || [];
            observation = { ...row, observation_id: `shadow-${list.length + 1}`, recorded_at: asOf, reason: obsDue.reason };
            list.push(observation);
            await env.WNBA_KV.put(key, JSON.stringify(list.slice(-300)), { expirationTtl: 30 * 86400 });
          }
          await env.WNBA_KV.put(lastKey, JSON.stringify({ feature_hash: doc.feature_hash, market_captured_at: doc.market.captured_at || null, generated_at: doc.generated_at, observation_id: observation.observation_id }), { expirationTtl: DOC_TTL_S });
          summary.observations += 1;
        }

        if (phase === 'lock_due') {
          stage = 'lock';
          let lock = lockDoc(doc, { now, ledger });
          if (mode === 'armed') {
            try {
              const inserted = await sbInsert(env, 'wnba_pbe_locked_predictions', lockRowFromObservation(observation, doc));
              lock.prediction_id = inserted.prediction_id;
              lock.locked_at = inserted.locked_at;
            } catch (e) {
              if (e.code !== '23505') throw e;
              // The database already holds this game's lock and kept the first. Mirror THAT row: a lock that
              // exists in the ledger but not in KV would otherwise be invisible and re-attempted every minute.
              stage = 'lock_mirror';
              const [existing] = await sbSelect(env, `wnba_pbe_locked_predictions?game_id=eq.${encodeURIComponent(g.event_id)}&contract=eq.${CONTRACT}&select=*&limit=1`);
              if (!existing) throw e;
              lock = lockDocFromLedgerRow(existing, doc, ledger);
              summary.skipped.push(`already_locked_mirrored:${g.event_id}`);
            }
          }
          await env.WNBA_KV.put(K(ledger, 'lock', g.event_id), JSON.stringify(lock));
          if (!index.locked_history.includes(g.event_id)) index.locked_history.push(g.event_id);
          summary.locks += 1;
        }
       } catch (e) {
        // One game's failure never blocks the others, in either mode: a throw here used to abort every later
        // game in the same minute, so one bad lock took its whole tip-time slot down with it. An armed-ledger
        // failure is still surfaced, not swallowed: it is recorded on the index and re-thrown after the pass.
        const message = String(e.message || e).slice(0, 300);
        if (mode === 'armed') summary.errors.push({ game_id: g.event_id, stage, phase, error: message });
        else summary.skipped.push(`error:${g.event_id}:${message.slice(0, 80)}`);
       }
      }
    }
  }

  // grading: every official lock follows the same final truth the live site sees.
  // The live archive is authoritative for freshness; the season scoreboard and a
  // direct game-summary probe are recovery lanes. A pick grades as soon as a
  // source says STATUS_FINAL — no arbitrary two-hour delay.
  //
  // The official ledger remains authoritative. If the DB write succeeded but the
  // KV mirror did not, the next pass reads back revision 1 and repairs KV instead
  // of retrying forever on the unique constraint.
  for (const id of index.locked_history) {
    if (await env.WNBA_KV.get(K(ledger, 'grade', id))) continue;
    try {
      const lock = await env.WNBA_KV.get(K(ledger, 'lock', id), 'json');
      const tip = Date.parse(lock?.game?.scheduled_tip_utc || 0);
      if (!lock || lock.call !== 'PICK' || !Number.isFinite(tip) || now < tip) continue;
      const final = await resolveLockedFinal(env, { id, lock, events, now, minute, fetchSummary });
      const grade = gradeFromFinal(lock, final);
      if (!grade) continue;
      const reference = grade.result_reference;
      let stored = { ...grade, revision: 1, graded_at: new Date(now).toISOString(), ledger };

      if (mode === 'armed') {
        let predictionId = lock.prediction_id || null;
        if (!predictionId) {
          const [ledgerLock] = await sbSelect(env, `wnba_pbe_locked_predictions?game_id=eq.${encodeURIComponent(id)}&contract=eq.${CONTRACT}&select=prediction_id&limit=1`);
          predictionId = ledgerLock?.prediction_id || null;
          if (!predictionId) throw new Error(`grade_missing_prediction_id:${id}`);
          lock.prediction_id = predictionId;
          lock.mirrored_from_ledger = true;
          await env.WNBA_KV.put(K(ledger, 'lock', id), JSON.stringify(lock));
          summary.skipped.push(`lock_prediction_id_recovered:${id}`);
        }

        let row;
        try {
          row = await sbInsert(env, 'wnba_pbe_grade_revisions', { prediction_id: predictionId, revision: 1, result: grade.result, home_score: grade.home_score, away_score: grade.away_score, winner_team_id: grade.winner_team_id, result_reference: reference, graded_by: runId });
        } catch (e) {
          // The ledger already holds a grade. Production answers with the BEFORE INSERT trigger's P0001
          // ("revision 1 must follow revision N"), which fires before the unique index can raise 23505.
          if (!gradeAlreadyInLedger(e)) throw e;
          const [latest] = await sbSelect(env, `wnba_pbe_grade_revisions?prediction_id=eq.${encodeURIComponent(predictionId)}&select=*&order=revision.desc&limit=1`);
          if (!latest) throw e;
          if (Number(latest.revision) === 1) {
            const same = latest.result === grade.result
              && Number(latest.home_score) === grade.home_score
              && Number(latest.away_score) === grade.away_score
              && String(latest.winner_team_id || '') === String(grade.winner_team_id || '');
            if (!same) throw new Error(`grade_revision_1_conflict:${id}`);
          }
          // A later revision is an audited correction chain in the ledger; the mirror reflects the newest revision.
          row = latest;
          stored = { ...stored, revision: Number(latest.revision), result: latest.result, home_score: Number(latest.home_score), away_score: Number(latest.away_score), winner_team_id: latest.winner_team_id == null ? null : String(latest.winner_team_id), result_reference: latest.result_reference ?? stored.result_reference };
          summary.skipped.push(`already_graded_mirrored:${id}:r${latest.revision}`);
        }
        stored = { ...stored, grade_id: row.grade_id, graded_at: row.graded_at };
      }

      await env.WNBA_KV.put(K(ledger, 'grade', id), JSON.stringify(stored));
      summary.grades += 1;
    } catch (e) {
      const message = String(e.message || e).slice(0, 300);
      if (mode === 'armed') summary.errors.push({ game_id: id, stage: 'grade', phase: 'postgame', error: message });
      else summary.skipped.push(`grade_error:${id}:${message.slice(0, 80)}`);
    }
  }

  // Lock-policy evidence: injury-feed checkpoints around every covered tip, and faster feed polling near tips.
  const nearTip = upcoming.some((g) => (Date.parse(g.start_utc) - now) / 60e3 <= NEAR_TIP_MINUTES);
  if (nearTip) await env.WNBA_KV.put('pbe:v1:near_tip_until', new Date(now + 3 * 60e3).toISOString(), { expirationTtl: 600 });
  const checkpointGames = [...upcoming.map((g) => ({ game_id: g.event_id, scheduled_tip_utc: g.start_utc, home_team_id: g.home_id, away_team_id: g.away_id })), ...(index.games || []).filter((x) => !upcoming.some((u) => u.event_id === x.game_id))]
    .filter((g) => { const m = (Date.parse(g.scheduled_tip_utc) - now) / 60e3; return m <= NEAR_TIP_MINUTES && m >= -20; });
  summary.availability_checkpoints = await recordCheckpoints(env, checkpointGames, now, ledger);

  index.generated_at = new Date(now).toISOString();
  index.mode = mode;
  const games = upcoming.map((g) => ({ game_id: g.event_id, scheduled_tip_utc: g.start_utc, home_team_id: g.home_id, away_team_id: g.away_id, locked: index.locked_history.includes(g.event_id) }));
  // Locked games stay listed for 36h after tip so the picks page shows the call through its result.
  for (const id of index.locked_history.slice(-60)) {
    if (games.some((x) => x.game_id === id)) continue;
    const lock = await env.WNBA_KV.get(K(ledger, 'lock', id), 'json');
    if (lock && Date.parse(lock.game.scheduled_tip_utc) > now - 36 * 3600e3) games.push({ game_id: id, scheduled_tip_utc: lock.game.scheduled_tip_utc, home_team_id: lock.game.home_team_id, away_team_id: lock.game.away_team_id, locked: true });
  }
  index.games = games.sort((a, b) => Date.parse(a.scheduled_tip_utc) - Date.parse(b.scheduled_tip_utc));
  index.last_summary = summary;
  // Armed failures stay readable after the minute that produced them (the task status is overwritten every pass).
  if (summary.errors.length) index.last_errors = { at: index.generated_at, run_id: runId, errors: summary.errors };
  await env.WNBA_KV.put(indexKey, JSON.stringify(index));
  if (summary.errors.length) {
    const err = new Error(`pbe_armed_errors:${summary.errors.map((x) => `${x.game_id}@${x.stage}:${x.error}`).join(' || ').slice(0, 900)}`);
    err.summary = summary;
    throw err;
  }
  return summary;
}
