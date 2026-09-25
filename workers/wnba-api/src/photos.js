// Player photo authority for the API.
//
// Resolution walks a provider chain (WNBA_PHOTO_PROVIDER_ORDER, default
// "commons,avatar" so an unconfigured Worker behaves exactly as before):
//
//   wnba     cdn.wnba.com headshot, hotlinked. Needs a WNBA player id in
//            data/player-headshots.json; none are mapped yet, so it is inert.
//   espn     a.espncdn.com headshot, hotlinked. Only for athletes whose ESPN
//            roster entry carried a headshot (scripts/photos/s1_roster.py).
//            Both ESPN renditions are landscape (full 600x436, combiner 350x254).
//   commons  the Git-versioned, rights-reviewed Wikimedia Commons crops served
//            from /media/players (data/player-photos.json, status "approved").
//   avatar   no image; the frontend draws initials.
//
// External providers are marked rights "external_editorial" and are never
// mirrored. `licensed` always carries the Commons entry (or null) so surfaces
// that must stay licensed-only (JSON-LD, newsroom) can ignore the hotlinks.

import manifest from '../../../data/player-photos.json' with { type: 'json' };
import headshots from '../../../data/player-headshots.json' with { type: 'json' };

const approved = new Map();
for (const p of manifest.players || []) {
  if (p.status === 'approved' && p.image && p.espn_athlete_id) approved.set(String(p.espn_athlete_id), p);
}
const external = headshots.players || {};

const DEFAULT_ORDER = ['commons', 'avatar'];
const PROVIDERS = new Set(['wnba', 'espn', 'commons', 'avatar']);
let cfg = { order: DEFAULT_ORDER, wnba: false, espn: false, commons: true };

const flag = (v, dflt) => (v == null || v === '' ? dflt : /^(1|true|yes|on)$/i.test(String(v).trim()));

/** Read the photo env flags. Called per request from the fetch/scheduled entry points. */
export function configurePhotos(env = {}) {
  const order = String(env.WNBA_PHOTO_PROVIDER_ORDER || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => PROVIDERS.has(s));
  cfg = {
    order: order.length ? [...new Set(order)] : DEFAULT_ORDER,
    wnba: flag(env.WNBA_ENABLE_WNBA_CDN, false),
    espn: flag(env.WNBA_ENABLE_ESPN_HEADSHOTS, false),
    commons: flag(env.WNBA_ENABLE_COMMONS, true)
  };
}

function commonsSource(p) {
  const img = p.image;
  return {
    provider: 'commons',
    rights: 'licensed',
    portrait: `/media/players/${p.espn_athlete_id}/portrait.webp`,
    square: `/media/players/${p.espn_athlete_id}/square.webp`,
    width: img.crops?.portrait?.out_w ?? null,
    height: img.crops?.portrait?.out_h ?? null,
    attribution: img.attribution_text,
    license: img.license_short,
    license_url: img.license_url || null,
    source_page: img.source_page_url,
    capture_date: img.capture_date || null,
    identity: img.identity_confidence,
    verified_at: img.verified_at
  };
}

function externalSource(provider, portrait, square, width, height, attribution) {
  return {
    provider,
    rights: 'external_editorial',
    portrait,
    square,
    width,
    height,
    attribution,
    license: null,
    license_url: null,
    source_page: null,
    capture_date: null,
    identity: 'provider_id',
    verified_at: null
  };
}

function resolve(provider, id) {
  const x = external[id];
  if (provider === 'wnba' && cfg.wnba && x?.wnba_player_id) {
    const u = `https://cdn.wnba.com/headshots/wnba/latest/1040x760/${encodeURIComponent(x.wnba_player_id)}.png`;
    return externalSource('wnba', u, u, 1040, 760, 'Photo: WNBA');
  }
  if (provider === 'espn' && cfg.espn && x?.espn_headshot_full) {
    return externalSource('espn', x.espn_headshot_full, x.espn_headshot_square || x.espn_headshot_full, 600, 436, 'Photo: ESPN');
  }
  if (provider === 'commons' && cfg.commons) {
    const p = approved.get(id);
    if (p) return commonsSource(p);
  }
  return null;
}

/**
 * Structured photo for an ESPN athlete id, or null when no provider resolves.
 * Top-level fields are the first resolved source (the legacy shape, so older
 * consumers keep working); `sources` is the full ordered chain the frontend
 * falls back through on image error, ending in the initials avatar.
 */
export function photoFor(athleteId) {
  if (!athleteId) return null;
  const id = String(athleteId);
  const sources = [];
  for (const provider of cfg.order) {
    if (provider === 'avatar') break;
    const s = resolve(provider, id);
    if (s) sources.push(s);
  }
  if (!sources.length) return null;
  const licensed = sources.find((s) => s.rights === 'licensed') || (cfg.commons && approved.has(id) ? commonsSource(approved.get(id)) : null);
  return { ...sources[0], sources, licensed, fallback: 'avatar' };
}

export function photoCoverage() {
  const t = manifest.totals || {};
  const ids = Object.keys(external);
  return {
    approved: approved.size,
    active_players: t.active_players ?? null,
    generated_at: manifest.generated_at ?? null,
    provider_order: cfg.order,
    providers: {
      wnba: { enabled: cfg.wnba, mapped: ids.filter((k) => external[k].wnba_player_id).length, rights: 'external_editorial' },
      espn: { enabled: cfg.espn, mapped: ids.filter((k) => external[k].espn_headshot_full).length, rights: 'external_editorial', generated_at: headshots.generated_at ?? null },
      commons: { enabled: cfg.commons, mapped: approved.size, rights: 'licensed' }
    },
    rule: 'Hotlinked WNBA/ESPN headshots (external editorial, never mirrored) in the configured order, then Wikimedia Commons (CC0 / PD / CC BY / CC BY-SA) matched by exact name + date of birth to Wikidata with reviewed crops, then an initials avatar.'
  };
}
