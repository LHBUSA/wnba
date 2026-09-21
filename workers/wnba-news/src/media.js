// Story media for newsroom articles — which licensed photograph(s) a story may show.
//
// Decided here, server-side, from the Git manifest data/newsroom-media.json (built by
// scripts/media/newsroom_media.py from the reviewed player-photo ledger). The browser only renders the
// decision; every file is served from wnba.propbetedge.ai.
//
// Identity rules:
//   * a single-subject story (injury, transaction, performance, result, prop watch) shows ITS subject
//     (lead_player_id) or no photo at all — never a teammate standing in for the player the story is about;
//   * a matchup (preview, market move) shows one pictured player per team only when both teams have one,
//     chosen in the article's own entity order, and says who is pictured;
//   * everything else falls back to a team composition (colours + mark, no photo).
// Every photo carries its credit (author, license, source page) and a "Pictured:" caption.

import manifest from '../../../data/newsroom-media.json';
import { internationalMediaFrom, newsroomMediaFrom, winbaPodiumFrom, winbaBoardMediaFrom } from './media-resolve.js';

const PLAYERS = manifest.players || {};

/** International story media — see media-resolve.js for the priority rules. */
export const internationalMedia = (a) => internationalMediaFrom(PLAYERS, a);

export function mediaFor(a) {
  return newsroomMediaFrom(PLAYERS, a);
}

/** The approved top-three podium for a WinBA Index share card, or null. */
export function winbaPodium(rows) {
  return winbaPodiumFrom(PLAYERS, rows);
}

/**
 * Approved media for every ranked row of a frozen board (top 25), because the
 * team-depth cards reach past the top ten. A null image per row is safe: the
 * renderer falls back, and a player is never dropped for want of a photograph.
 */
export function winbaBoardMedia(rows) {
  return winbaBoardMediaFrom(PLAYERS, rows, 25);
}

export const MEDIA_MANIFEST_AT = manifest.generated_at || null;
