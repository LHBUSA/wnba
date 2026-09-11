// Team logos — one renderer for every surface so sizing, retina density and
// fallbacks are identical everywhere. Files are self-hosted derivatives built
// by scripts/logos/build_team_logos.py from ESPN's dark-background marks
// (data/team-logos.json records source, hash and fetch time).

import { html } from '../lib/dom.js';
import manifest from '../../data/team-logos.json';

const BY_ID = new Map(manifest.teams.map((t) => [String(t.team_id), t]));
const BY_ABBR = new Map(manifest.teams.map((t) => [t.abbr, t]));

export function logoEntry(teamOrId) {
  if (!teamOrId) return null;
  if (typeof teamOrId === 'object') return BY_ID.get(String(teamOrId.team_id)) || BY_ABBR.get(teamOrId.abbr) || null;
  return BY_ID.get(String(teamOrId)) || BY_ABBR.get(String(teamOrId)) || null;
}

/**
 * <img> sized in CSS px; srcset picks the 2x file. Unknown team -> monogram
 * disc (never a broken image, never a stand-in logo).
 */
export function teamLogo(team, size = 32, { cls = '' } = {}) {
  const e = logoEntry(team);
  const label = team?.name || team?.abbr || e?.name || 'Team';
  if (!e) {
    return html`<span class="tlogo tlogo-mono ${cls}" style="--s:${size}px" aria-hidden="true">${String(team?.abbr || '?').slice(0, 3)}</span>`;
  }
  const one = size <= 32 ? e.files['64'] : size <= 64 ? e.files['128'] : e.files['320'];
  const two = size <= 32 ? e.files['128'] : e.files['320'];
  return html`<img class="tlogo ${cls}" style="--s:${size}px" src="${one}" srcset="${one} 1x, ${two} 2x" width="${size}" height="${size}" alt="${label} logo" loading="lazy" decoding="async" />`;
}

export function teamColors(team) {
  const e = logoEntry(team);
  return { color: e?.color || team?.color || null, alt: e?.alt_color || team?.alt_color || null };
}
