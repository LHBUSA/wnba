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

  const due = [];
  for (const g of upcoming) {
    const phase = lockPhase(g.start_utc, now);
    const hasPred = await env.WNBA_KV.get(K(ledger, 'pred', g.event_id));
    const locked = await env.WNBA_KV.get(K(ledger, 'lock', g.event_id));
    if (locked) continue;
    if (phase === 'lock_due' || !hasPred || scoringDue(g.start_utc, minute, now)) due.push({ g, phase });
  }

  const summary = { mode, ledger, run_id: runId, upcoming: upcoming.length, scored: 0, observations: 0, locks: 0, grades: 0, rows: null, skipped: [] };

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
          const lock = lockDoc(doc, { now, ledger });
          if (mode === 'armed') {
            try {
              const inserted = await sbInsert(env, 'wnba_pbe_locked_predictions', lockRowFromObservation(observation, doc));
              lock.prediction_id = inserted.prediction_id;
              lock.locked_at = inserted.locked_at;
            } catch (e) {
              if (e.code !== '23505') throw e; // someone already locked this game: the database kept the first
              summary.skipped.push(`already_locked:${g.event_id}`);
              continue;
            }
          }
          await env.WNBA_KV.put(K(ledger, 'lock', g.event_id), JSON.stringify(lock));
          if (!index.locked_history.includes(g.event_id)) index.locked_history.push(g.event_id);
          summary.locks += 1;
        }
       } catch (e) {
        // One game's failure never blocks the others; an armed-ledger write failure is surfaced, not swallowed.
        if (mode === 'armed') throw e;
        summary.skipped.push(`error:${g.event_id}:${String(e.message || e).slice(0, 80)}`);
       }
      }
    }
  }

  // grading: locked games whose tip is > 2h ago and not graded yet
  for (const id of index.locked_history) {
    if (await env.WNBA_KV.get(K(ledger, 'grade', id))) continue;
    const lock = await env.WNBA_KV.get(K(ledger, 'lock', id), 'json');
    if (!lock || lock.call !== 'PICK' || now < Date.parse(lock.game.scheduled_tip_utc) + 2 * 3600e3) continue;
    const e = events.find((x) => String(x.id) === id) || null;
    const c = e?.competitions?.[0];
    const status = e?.status?.type?.name || null;
    const h = c?.competitors?.find((x) => x.homeAway === 'home');
    const a = c?.competitors?.find((x) => x.homeAway === 'away');
    if (status !== 'STATUS_FINAL' || !h || !a) continue;
    const reference = { provider: 'espn', event_id: id, status, url: `${ESPN.site}/scoreboard?dates=${year}`, captured_at: new Date(now).toISOString() };
    const grade = gradeFromFinal(lock, { status, home_score: Number(h.score), away_score: Number(a.score), reference });
    if (!grade) continue;
    let stored = { ...grade, revision: 1, graded_at: new Date(now).toISOString(), ledger };
    if (mode === 'armed') {
      if (!lock.prediction_id) continue;
      const row = await sbInsert(env, 'wnba_pbe_grade_revisions', { prediction_id: lock.prediction_id, revision: 1, result: grade.result, home_score: grade.home_score, away_score: grade.away_score, winner_team_id: grade.winner_team_id, result_reference: reference, graded_by: runId });
      stored = { ...stored, grade_id: row.grade_id, graded_at: row.graded_at };
    }
    await env.WNBA_KV.put(K(ledger, 'grade', id), JSON.stringify(stored));
    summary.grades += 1;
  }

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
  await env.WNBA_KV.put(indexKey, JSON.stringify(index));
  return summary;
}
