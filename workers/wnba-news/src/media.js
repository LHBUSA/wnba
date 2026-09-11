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

const PLAYERS = manifest.players || {};
const SINGLE = new Set(['injury', 'transaction', 'performance', 'result', 'props']);
const MATCHUP = new Set(['preview', 'market']);

function subject(pid) {
  const e = pid !== null && pid !== undefined ? PLAYERS[String(pid)] : null;
  if (!e || !e.slots?.wide?.length) return null;
  return {
    player_id: String(pid),
    name: e.name,
    team_id: String(e.team_id),
    team_abbr: e.team_abbr,
    wide: e.slots.wide,
    half: e.slots.half || [],
    og: e.slots.og?.[0]?.src || null,
    square: `/media/players/${pid}/square.webp`,
    credit: { author: e.artist || null, license: e.license, license_url: e.license_url || null, source_page: e.source_page_url, text: e.attribution }
  };
}

const ids = (xs) => xs.filter((x) => x !== null && x !== undefined && x !== '').map(String);

export function mediaFor(a) {
  const ents = (a.entities || []).filter(Boolean);
  const teamIds = ents.filter((e) => e.type === 'team').map((e) => e.id);
  if (SINGLE.has(a.kind)) {
    const s = subject(a.lead_player_id);
    if (s) return { layout: 'single', subjects: [s], teams: ids([s.team_id]), caption: `Pictured: ${s.name}`, og: s.og };
    return { layout: 'team', subjects: [], teams: ids([a.lead_team_id]), caption: null, og: null };
  }
  if (MATCHUP.has(a.kind)) {
    const g = a.context?.game || a.context?.next_game || null;
    const away = String(a.matchup?.away_team_id ?? g?.away?.team_id ?? teamIds[0] ?? '');
    const home = String(a.matchup?.home_team_id ?? g?.home?.team_id ?? teamIds[1] ?? '');
    const pick = (tid) => ents.filter((e) => e.type === 'player').map((e) => subject(e.id)).find((s) => s && s.team_id === tid) || null;
    const A = away ? pick(away) : null;
    const H = home ? pick(home) : null;
    if (A && H) return { layout: 'matchup', subjects: [A, H], teams: [away, home], caption: `Pictured: ${A.name} (${A.team_abbr}) and ${H.name} (${H.team_abbr})`, og: H.og };
    return { layout: 'team_matchup', subjects: [], teams: ids([away, home]), caption: null, og: null };
  }
  return { layout: 'team', subjects: [], teams: ids([a.lead_team_id]), caption: null, og: null };
}

export const MEDIA_MANIFEST_AT = manifest.generated_at || null;
