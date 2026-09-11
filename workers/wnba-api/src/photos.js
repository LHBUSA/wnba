// Player photo authority for the API. Reads the Git-versioned manifest
// (data/player-photos.json). Only entries with status "approved" produce a
// photo; everything else returns null so the frontend shows the neutral card.

import manifest from '../../../data/player-photos.json';

const approved = new Map();
for (const p of manifest.players || []) {
  if (p.status === 'approved' && p.image && p.espn_athlete_id) approved.set(String(p.espn_athlete_id), p);
}

export function photoFor(athleteId) {
  if (!athleteId) return null;
  const p = approved.get(String(athleteId));
  if (!p) return null;
  const img = p.image;
  return {
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

export function photoCoverage() {
  const t = manifest.totals || {};
  return {
    approved: approved.size,
    active_players: t.active_players ?? null,
    generated_at: manifest.generated_at ?? null,
    rule: 'Wikimedia Commons (CC0 / PD / CC BY / CC BY-SA) matched by exact name + date of birth to Wikidata; crops reviewed. Otherwise neutral fallback.'
  };
}
