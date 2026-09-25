// GET /v1/playoffs[?season=YYYY] — the normalized postseason bracket (pbe-playoffs/1.0.0).
//
// Reads only the snapshot wnba-ingest validated and persisted (KV playoffs:v1:<season>); user traffic never
// reaches the provider. Freshness is judged from the last successful verification, and a prior season is
// always labelled PRIOR_SEASON_*, never current. A missing or failed capture is reported, not papered over.

import { FRESHNESS, SOURCES, meta, ok, fail, ageSeconds } from '../../shared/envelope.js';
import { playoffsStaleAfterS, playoffsSemantics } from '../../shared/playoffs.js';

const K = {
  snapshot: (y) => `playoffs:v1:${y}`,
  checked: (y) => `playoffs:v1:checked:${y}`,
  current: 'playoffs:v1:current',
  seasons: 'playoffs:v1:seasons',
  status: 'playoffs:v1:status'
};

const ESPN_DERIVED = { ...SOURCES.espn, name: 'ESPN (PropBetEdge-derived bracket)' };

export async function playoffs({ env, url, path }, { service, version }) {
  const base = (extra) => meta({ service, version, route: path, source: ESPN_DERIVED, ...extra });
  const seasonParam = url.searchParams.get('season');
  if (seasonParam && !/^\d{4}$/.test(seasonParam)) return fail('bad_request', 'season must be YYYY', base({ freshness: FRESHNESS.ERROR }), 400);
  if (!env.WNBA_KV) return fail('not_configured', 'Playoff snapshot store not bound', base({ freshness: FRESHNESS.NOT_CONFIGURED }), 503);

  const [pointer, seasons, runStatus] = await Promise.all([
    env.WNBA_KV.get(K.current, 'json'),
    env.WNBA_KV.get(K.seasons, 'json'),
    env.WNBA_KV.get(K.status, 'json')
  ]);
  const currentSeason = pointer?.season ? Number(pointer.season) : null;
  const year = seasonParam ? Number(seasonParam) : currentSeason;
  if (!year) return fail('playoffs_unavailable', 'No postseason snapshot has been captured yet', base({ freshness: FRESHNESS.UNAVAILABLE, semantics: 'NO_SNAPSHOT_YET' }), 503);

  const [snap, checked] = await Promise.all([env.WNBA_KV.get(K.snapshot(year), 'json'), env.WNBA_KV.get(K.checked(year), 'json')]);
  if (!snap) {
    return fail('season_not_captured', `No postseason snapshot for ${year}`, base({ freshness: FRESHNESS.UNAVAILABLE, semantics: 'NO_SNAPSHOT_FOR_SEASON', season: { year } }), 404);
  }

  const isCurrentSeason = currentSeason !== null && year === currentSeason;
  const verifiedAt = checked?.checked_at || snap.updated_at;
  const staleAfterS = playoffsStaleAfterS(snap);
  const age = ageSeconds(verifiedAt);
  const stale = staleAfterS !== null && age !== null && age > staleAfterS;
  const freshness = stale ? FRESHNESS.STALE : FRESHNESS.CACHED;

  const degraded = [];
  if (runStatus && runStatus.ok === false && Number(runStatus.season) === year) degraded.push(`last_capture_rejected:${(runStatus.errors || [])[0] || 'unknown'}`);
  const missing = snap.provenance?.missing_event_ids || [];
  if (missing.length) degraded.push(`postseason_events_missing:${missing.length}`);
  if (!snap.seeds?.length) degraded.push('seeds_unavailable');

  const semantics = playoffsSemantics(snap, { isCurrentSeason, stale });
  return ok(
    {
      ...snap,
      updated_at: verifiedAt,
      truth_changed_at: snap.source_updated_at || snap.updated_at,
      freshness,
      is_current_season: isCurrentSeason,
      current_season: currentSeason,
      available_seasons: Array.isArray(seasons) ? seasons : currentSeason ? [currentSeason] : []
    },
    base({
      fetchedAt: verifiedAt,
      sourceUpdatedAt: snap.source_updated_at || null,
      freshness,
      staleAfterS,
      cache: 'snapshot',
      semantics,
      season: { year, type: 3, label: `${year} Postseason` },
      degraded
    }),
    { maxAge: snap.status === 'COMPLETE' ? 300 : 20 }
  );
}
