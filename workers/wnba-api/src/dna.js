// GET /v1/dna/meta, /v1/dna/index, /v1/dna/players/:id — WNBA Player DNA V1 (docs/WNBA_PLAYER_DNA_V1.md §12).
//
// Public (owner decision 2026-09-26, same as NBA /v1/dna/*). Prepared data only: every body is the
// document the wnba-ingest `dna` task stored in KV (dna:v1:meta, dna:v1:index, dna:v1:player:<id>).
// Nothing is computed per request; the only decoration is the player photo from the existing photo
// providers (the same photoFor every other player surface uses).

import { FRESHNESS, SOURCES, meta, ok, json } from '../../shared/envelope.js';
import { DNA_KV, DNA_SCHEMAS, DNA_UNAVAILABLE } from '../../shared/player-dna-views.js';
import { PLAYER_DNA_VERSION } from '../../shared/player-dna.js';
import { photoFor } from './photos.js';

// Derived nightly and on each newly archived final; 24h without a new derive while games are archived is stale.
export const DNA_STALE_AFTER_S = 36 * 3600;
const MAX_AGE = 300;

function base(ctx, path, extra = {}) {
  return meta({ service: ctx.service, version: ctx.version, route: path, source: SOURCES.pbe, ...extra });
}

function unavailable(ctx, path, kind, { status, reason, detail, extra = {}, semantics }) {
  return json({
    ok: false,
    error: { code: reason, message: detail },
    data: { schema: DNA_SCHEMAS[kind], version: PLAYER_DNA_VERSION, state: 'UNAVAILABLE', reason, detail, unavailable: [...DNA_UNAVAILABLE], ...extra },
    meta: base(ctx, path, { freshness: FRESHNESS.UNAVAILABLE, semantics })
  }, { status, maxAge: 30 });
}

function served(ctx, path, kind, doc) {
  return ok(doc, base(ctx, path, {
    fetchedAt: doc.captured_at,
    freshness: FRESHNESS.CACHED,
    staleAfterS: DNA_STALE_AFTER_S,
    cache: 'kv',
    semantics: `DNA_${kind.toUpperCase()}`,
    season: doc.season ? { year: doc.season } : null
  }), { maxAge: MAX_AGE });
}

async function read(env, key) {
  return env.WNBA_KV ? env.WNBA_KV.get(key, 'json') : null;
}

export async function dnaMetaRoute({ env, path }, ctx) {
  const doc = await read(env, DNA_KV.meta);
  if (!doc) return unavailable(ctx, path, 'meta', { status: 503, reason: 'not_derived', detail: 'Player DNA has not been derived yet', semantics: 'DNA_NOT_DERIVED' });
  return served(ctx, path, 'meta', doc);
}

export async function dnaIndexRoute({ env, path }, ctx) {
  const doc = await read(env, DNA_KV.index);
  if (!doc) return unavailable(ctx, path, 'index', { status: 503, reason: 'not_derived', detail: 'Player DNA has not been derived yet', semantics: 'DNA_NOT_DERIVED' });
  return served(ctx, path, 'index', { ...doc, players: (doc.players || []).map((p) => ({ ...p, headshot: photoFor(p.id) })) });
}

export async function dnaPlayerRoute({ env, path, params }, ctx) {
  const id = String(params.id || '');
  if (!/^\d{1,12}$/.test(id)) {
    return unavailable(ctx, path, 'player', { status: 400, reason: 'bad_request', detail: 'player id must be a numeric ESPN athlete id', semantics: 'DNA_BAD_REQUEST' });
  }
  const doc = await read(env, DNA_KV.player(id));
  if (!doc) {
    return unavailable(ctx, path, 'player', {
      status: 404,
      reason: 'no_snapshot',
      detail: 'No Player DNA for this player (no archived WNBA regular-season or postseason appearance, or not derived yet)',
      extra: { player: { id, espn_athlete_id: id } },
      semantics: 'DNA_NO_SNAPSHOT'
    });
  }
  return served(ctx, path, 'player', { ...doc, player: { ...doc.player, headshot: photoFor(id) } });
}
