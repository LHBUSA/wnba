// playoffs: WNBA postseason capture -> validated bracket snapshot (KV playoffs:v1:<season>).
//
// provider postseason games -> normalize teams/games/series -> derive rounds -> validate -> persist only valid.
//
// Cloudflare-egress facts (2026-09-25): scoreboard DATE RANGES answer 400 on both ESPN site hosts from
// Workers, single dates answer 200, and the shared fetcher's team-schedule recovery cannot see TBD
// placeholder games. So the scan is: league standings (seeds + season window) -> the scoreboard calendar
// for the postseason's first day (whitelisted game days) -> one single-date scoreboard per postseason game
// day -> season.type == 3 events. Core seasons/{y}/types/3/events is the completeness cross-check.
//
// Days whose games are all settled (final/canceled) and more than a day old are memoized in KV, so a
// finished round costs nothing to re-verify. A COMPLETE bracket is frozen: a later, less complete
// provider view can never overwrite it.

import { fetchJsonWithTimeout } from '../../shared/fetcher.js';
import { ESPN } from '../../shared/espn.js';
import { buildWnbaPlayoffs, seasonWindow, postseasonDays } from '../../shared/playoffs-wnba.js';
import { playoffsHot, playoffsSignature, BRACKET_STATUS } from '../../shared/playoffs.js';
import { etCompact, addDays } from '../../shared/time.js';
import logos from '../../../data/team-logos.json' with { type: 'json' };

export const PLAYOFFS_KEYS = Object.freeze({
  snapshot: (y) => `playoffs:v1:${y}`,
  checked: (y) => `playoffs:v1:checked:${y}`,
  day: (d) => `playoffs:v1:day:${d}`,
  current: 'playoffs:v1:current',
  seasons: 'playoffs:v1:seasons',
  status: 'playoffs:v1:status',
  hot: 'playoffs:v1:hot_until'
});

// Self-hosted logo derivatives (data/team-logos.json) as absolute URLs on the product domain: no provider host.
const LOGO = new Map(logos.teams.map((t) => [String(t.team_id), t.files?.['128'] ? `https://wnba.propbetedge.ai${t.files['128']}` : null]));
const logoFor = (id) => LOGO.get(String(id)) || null;

const SETTLED = new Set(['STATUS_FINAL', 'STATUS_CANCELED', 'STATUS_CANCELLED']);

/**
 * @param {object} env  WNBA_KV binding
 * @param {object} opts { season?: number (backfill a specific year), force?: boolean, now?: number, fetchJson?: fn }
 */
export async function playoffsTask(env, { season: forcedSeason = null, force = false, now = Date.now(), fetchJson = fetchJsonWithTimeout } = {}) {
  if (!env.WNBA_KV) return { skipped: 'no_kv' };
  const kv = env.WNBA_KV;
  const capturedAt = new Date(now).toISOString();

  const standingsUrl = `${ESPN.v2}/standings?level=1${forcedSeason ? `&season=${forcedSeason}` : ''}`;
  const standingsBody = await fetchJson(standingsUrl, { timeoutMs: 12000 });
  const season = Number(forcedSeason || standingsBody?.standings?.season);
  if (!Number.isInteger(season) || season < 2000) throw new Error('playoffs_no_season');
  const currentSeason = forcedSeason ? Number((await kv.get(PLAYOFFS_KEYS.current, 'json'))?.season || season) : season;

  const existing = await kv.get(PLAYOFFS_KEYS.snapshot(season), 'json');
  if (existing?.frozen && !force) {
    await kv.put(PLAYOFFS_KEYS.checked(season), JSON.stringify({ checked_at: capturedAt, signature_unchanged: true, frozen: true }));
    return { season, status: existing.status, frozen: true, fetched: 0 };
  }

  const window = seasonWindow(standingsBody, season);
  if (!window.postseason) throw new Error(`playoffs_no_postseason_window:${season}`);
  const startDay = window.postseason.start.slice(0, 10).replaceAll('-', '');
  const calendarBody = await fetchJson(`${ESPN.site}/scoreboard?dates=${startDay}&limit=100`, { timeoutMs: 12000 });
  const days = postseasonDays(calendarBody, window);

  const staleBefore = addDays(etCompact(new Date(now)), -1);
  let fetched = 0;
  let memo = 0;
  const events = [];
  for (const day of days) {
    let dayEvents = null;
    // force = re-verify against the provider: memoized settled days are refetched too.
    if (day < staleBefore && !force) dayEvents = await kv.get(PLAYOFFS_KEYS.day(day), 'json');
    if (dayEvents) { memo += 1; } else {
      const body = day === startDay ? calendarBody : await fetchJson(`${ESPN.site}/scoreboard?dates=${day}&limit=100`, { timeoutMs: 12000 });
      if (day !== startDay) fetched += 1;
      if (!Array.isArray(body?.events)) throw new Error(`playoffs_day_invalid:${day}`);
      dayEvents = body.events.filter((e) => Number(e?.season?.year) === season && Number(e?.season?.type) === 3);
      const settled = dayEvents.every((e) => SETTLED.has(e?.status?.type?.name));
      if (day < staleBefore && settled) await kv.put(PLAYOFFS_KEYS.day(day), JSON.stringify(dayEvents));
    }
    events.push(...dayEvents);
  }

  // Completeness: the core list of postseason event ids for the season.
  let coreIds = null;
  try {
    const core = await fetchJson(`${ESPN.core}/seasons/${season}/types/3/events?limit=200`, { timeoutMs: 12000 });
    coreIds = (core?.items || []).map((x) => String(x.$ref || '').match(/events\/(\d+)/)?.[1]).filter(Boolean);
  } catch (e) {
    coreIds = null;
  }
  const scanned = new Set(events.map((e) => String(e.id)));
  const missing = coreIds ? coreIds.filter((id) => !scanned.has(id)) : [];

  const result = buildWnbaPlayoffs({
    season,
    events,
    standingsBody,
    capturedAt,
    now,
    logoFor,
    provenance: {
      calendar_days_scanned: days.length,
      day_scoreboards_fetched: fetched + 1, // + the calendar/start-day scoreboard
      day_scoreboards_memoized: memo,
      core_event_count: coreIds ? coreIds.length : null,
      missing_event_ids: missing,
      standings_season: Number(standingsBody?.standings?.season) || null
    }
  });
  if (missing.length) result.warnings.push(`core_events_not_on_scoreboard:${missing.length}`);

  if (!result.ok) {
    await kv.put(PLAYOFFS_KEYS.status, JSON.stringify({ ok: false, season, at: capturedAt, errors: result.errors.slice(0, 40), warnings: result.warnings.slice(0, 40), kept: existing ? existing.updated_at : null }));
    const err = new Error(`playoffs_validation_failed:${result.errors.slice(0, 6).join(',')}`);
    err.result = result;
    throw err;
  }

  const snap = result.snapshot;
  // A frozen (complete) bracket is never replaced by a less complete provider view.
  if (existing?.status === BRACKET_STATUS.COMPLETE && snap.status !== BRACKET_STATUS.COMPLETE) {
    await kv.put(PLAYOFFS_KEYS.status, JSON.stringify({ ok: true, season, at: capturedAt, kept_frozen: true, warnings: ['complete_snapshot_kept_over_incomplete_view'] }));
    return { season, status: existing.status, kept_frozen: true, fetched };
  }

  const changed = !existing || playoffsSignature(existing) !== playoffsSignature(snap);
  if (changed) {
    // source_updated_at: when the truth last changed (this capture); captured_at moves on every verification.
    snap.source_updated_at = capturedAt;
    await kv.put(PLAYOFFS_KEYS.snapshot(season), JSON.stringify(snap));
  }
  await kv.put(PLAYOFFS_KEYS.checked(season), JSON.stringify({ checked_at: capturedAt, signature_unchanged: !changed, warnings: result.warnings.slice(0, 40) }));

  const seasons = new Set(((await kv.get(PLAYOFFS_KEYS.seasons, 'json')) || []).map(Number));
  if (!seasons.has(season)) { seasons.add(season); await kv.put(PLAYOFFS_KEYS.seasons, JSON.stringify([...seasons].sort((a, b) => b - a))); }
  if (season >= currentSeason) await kv.put(PLAYOFFS_KEYS.current, JSON.stringify({ season, updated_at: capturedAt, status: snap.status }));

  const hot = playoffsHot(changed ? snap : existing || snap, now);
  if (hot) await kv.put(PLAYOFFS_KEYS.hot, new Date(now + 10 * 60e3).toISOString(), { expirationTtl: 1200 });
  await kv.put(PLAYOFFS_KEYS.status, JSON.stringify({ ok: true, season, at: capturedAt, changed, status: snap.status, warnings: result.warnings.slice(0, 40) }));

  return {
    season,
    status: snap.status,
    changed,
    hot,
    games: snap.provenance.postseason_game_count,
    series: snap.provenance.series_count,
    days: days.length,
    fetched: snap.provenance.day_scoreboards_fetched,
    memoized: memo,
    missing_events: missing.length,
    warnings: result.warnings.length
  };
}

/** Cron gate: every 10 minutes, and every 2 minutes while a postseason game is live or near. */
export async function playoffsDue(env, minute) {
  if (minute % 10 === 3) return true;
  if (minute % 2 !== 1 || !env.WNBA_KV) return false;
  const until = await env.WNBA_KV.get(PLAYOFFS_KEYS.hot);
  return Boolean(until && Date.parse(until) > Date.now());
}
