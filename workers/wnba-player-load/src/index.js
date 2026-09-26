// WNBA Player Load Intelligence background lane.
// Cloudflare Cron is the ONLY scheduler. No GitHub Actions, no Vercel Functions.
// Reads existing WNBA final-game archives/reference/availability from the shared
// KV namespace and writes one derived Pro snapshot back to KV.

import { fetchJsonWithTimeout } from '../../shared/fetcher.js';
import { ESPN, normalizeScoreboard } from '../../shared/espn.js';
import { etCompact, addDays } from '../../shared/time.js';
import { buildPlayerLoadSnapshot, PLAYER_LOAD_VERSION } from '../../shared/player-load.js';
import { readWindowGames } from '../../shared/archive-reader.js';

const SERVICE = 'wnba-player-load';
const VERSION = '1.0.4'; // 1.0.4: reads only archived games inside the lookback window (bounded reader, no slice(-500))
const SNAPSHOT_KEY = 'player-load:v1:latest';
const STATUS_KEY = 'player-load:v1:status';
const REFRESH_MS = 15 * 60e3;
const WINDOW_DAYS = 28;
const UPCOMING_DAYS = 8;
const RECOVERY_RETRY_MS = 60e3;
const RUNNING_STALE_MS = 2 * 60e3;

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runScheduled(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return reply({ ok: false, error: 'method_not_allowed' }, 405);
    if (url.pathname !== '/health' && url.pathname !== '/status') return reply({ ok: false, error: 'not_found' }, 404);

    const [snap, status] = env.WNBA_KV
      ? await Promise.all([env.WNBA_KV.get(SNAPSHOT_KEY, 'json'), env.WNBA_KV.get(STATUS_KEY, 'json')])
      : [null, null];

    // Bootstrap/recovery safety net: Cloudflare Cron remains the scheduler, but a
    // health probe can kick one background rebuild when a first-deploy snapshot is
    // missing or a previous attempt failed. RUNNING is written before the expensive
    // work begins, preventing repeated health probes from fanning out rebuilds.
    const now = Date.now();
    const lastAttempt = status?.last_attempt_at ? Date.parse(status.last_attempt_at) : 0;
    const runningStale = status?.state === 'RUNNING' && (!lastAttempt || now - lastAttempt >= RUNNING_STALE_MS);
    const errorRetryDue = status?.state === 'ERROR' && (!lastAttempt || now - lastAttempt >= RECOVERY_RETRY_MS);
    const bootstrapKicked = Boolean(env.WNBA_KV && !snap && (!status || errorRetryDue || runningStale));
    if (bootstrapKicked && ctx?.waitUntil) ctx.waitUntil(runScheduled(env));

    return reply({
      ok: true,
      service: SERVICE,
      version: VERSION,
      runtime: 'cloudflare-workers',
      scheduler: 'cloudflare-cron',
      cron: '* * * * *',
      refresh_interval_s: Math.round(REFRESH_MS / 1000),
      kv: Boolean(env.WNBA_KV),
      bootstrap_kicked: bootstrapKicked,
      status: status || null,
      snapshot: snap ? {
        schema: snap.schema,
        generated_at: snap.generated_at,
        players: snap.summary?.players ?? 0,
        heavy_or_extreme: snap.summary?.heavy_or_extreme ?? 0,
        coverage: snap.coverage || null
      } : null
    });
  }
};

async function writeStatus(env, patch) {
  if (!env.WNBA_KV) return;
  const prev = await env.WNBA_KV.get(STATUS_KEY, 'json').catch(() => null);
  await env.WNBA_KV.put(STATUS_KEY, JSON.stringify({
    ...(prev || {}),
    service: SERVICE,
    version: VERSION,
    ...patch
  }));
}

async function runScheduled(env) {
  const attemptedAt = new Date().toISOString();
  await writeStatus(env, {
    state: 'RUNNING',
    last_attempt_at: attemptedAt,
    last_error: null
  });

  try {
    const result = await refresh(env);
    const snapshotGeneratedAt = result?.generated_at || null;
    await writeStatus(env, {
      state: result?.skipped ? 'HEALTHY_SKIPPED_FRESH' : 'HEALTHY',
      last_attempt_at: attemptedAt,
      last_success_at: new Date().toISOString(),
      last_error: null,
      snapshot_generated_at: snapshotGeneratedAt,
      last_result: result || null
    });
    return result;
  } catch (e) {
    const message = String(e?.message || e || 'unknown_error').slice(0, 300);
    const body = e?.body ? String(e.body).replace(/\s+/g, ' ').slice(0, 220) : '';
    const detail = body ? `${message} · ${body}` : message;
    await writeStatus(env, {
      state: 'ERROR',
      last_attempt_at: attemptedAt,
      last_error_at: new Date().toISOString(),
      last_error: detail
    }).catch(() => {});
    console.error(`[${SERVICE}] scheduled refresh failed: ${detail}`);
    throw e;
  }
}

async function loadRecentArchives(env, now) {
  // Only archived finals whose tip falls inside the lookback window are read (bounded reader in
  // workers/shared/archive-reader.js; fails closed on an unreadable game, never drops one silently).
  return readWindowGames(env.WNBA_KV, { now, windowDays: WINDOW_DAYS });
}

async function loadUpcomingSchedule(now) {
  const today = etCompact(new Date(now));
  const days = Array.from({ length: UPCOMING_DAYS + 1 }, (_, i) => addDays(today, i));
  // Daily scoreboard reads are intentionally used instead of one broad range.
  // ESPN has returned HTTP 400 for the former 28-day-back/8-day-forward request.
  const boards = await Promise.all(days.map((day) => fetchJsonWithTimeout(`${ESPN.site}/scoreboard?dates=${day}&limit=100`, { timeoutMs: 12000 })));
  const seen = new Set();
  const games = [];
  for (const raw of boards) {
    for (const g of normalizeScoreboard(raw).games) {
      if (!g?.game_id || seen.has(g.game_id)) continue;
      seen.add(g.game_id);
      if (g.status?.state === 'pre' && Date.parse(g.start_utc) > now) games.push(g);
    }
  }
  games.sort((a, b) => Date.parse(a.start_utc) - Date.parse(b.start_utc));
  return games;
}

async function refresh(env, { force = false } = {}) {
  if (!env.WNBA_KV) throw new Error('player_load_kv_unconfigured');
  const existing = await env.WNBA_KV.get(SNAPSHOT_KEY, 'json');
  if (!force && existing?.generated_at && Date.now() - Date.parse(existing.generated_at) < REFRESH_MS) {
    return { skipped: 'fresh_snapshot', generated_at: existing.generated_at };
  }

  const now = Date.now();
  const [{ games: recentGames, indexTotal, scanned, read }, upcoming] = await Promise.all([
    loadRecentArchives(env, now),
    loadUpcomingSchedule(now)
  ]);
  if (!recentGames.length) throw new Error(`player_load_no_recent_archived_finals:indexed=${indexTotal}:scanned=${scanned}`);

  const [ref, availability] = await Promise.all([
    env.WNBA_KV.get('ref:v1:athletes', 'json'),
    env.WNBA_KV.get('avail:v1:snapshot', 'json')
  ]);
  const snapshot = buildPlayerLoadSnapshot({
    now,
    games: recentGames,
    upcomingGames: upcoming,
    athletes: ref?.athletes || [],
    teams: ref?.teams || [],
    availability
  });
  snapshot.coverage = {
    window_days: WINDOW_DAYS,
    upcoming_days: UPCOMING_DAYS,
    archive_index_total: indexTotal,
    archives_scanned: scanned,
    finals_archived_recent: recentGames.length,
    upcoming_games: upcoming.length,
    reference_captured_at: ref?.captured_at || null,
    availability_captured_at: availability?.captured_at || null
  };
  snapshot.source = {
    schedule: 'ESPN WNBA daily scoreboards normalized by PropBetEdge',
    minutes: 'PropBetEdge persisted final WNBA box scores',
    availability: 'ESPN WNBA injury feed normalized by PropBetEdge (context only)'
  };
  await env.WNBA_KV.put(SNAPSHOT_KEY, JSON.stringify(snapshot));
  console.log(`[${SERVICE}] ${PLAYER_LOAD_VERSION} players=${snapshot.summary.players} finals=${recentGames.length} upcoming=${upcoming.length}`);
  return { generated_at: snapshot.generated_at, players: snapshot.summary.players, finals_archived_recent: recentGames.length, upcoming_games: upcoming.length, archive_index_total: indexTotal, archives_read: read };
}

export { refresh, runScheduled };
