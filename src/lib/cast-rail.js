// WNBACast rail state: grouping, merge-by-game_id and the /v1/today refresh
// throttle. Pure (no DOM) so the multi-game live behaviour is testable.

export const RAIL_GROUPS = ['live', 'upcoming', 'finals'];
export const RAIL_REFRESH_MS = 15000;

const phaseRank = (s) => s === 'pre' ? 0 : s === 'in' ? 1 : s === 'post' ? 2 : -1;

export function groupRailGames(games) {
  const live = games.filter((g) => g.status?.state === 'in');
  const upcoming = games.filter((g) => g.status?.state === 'pre').sort((a, b) => a.start_utc.localeCompare(b.start_utc));
  const finals = games.filter((g) => g.status?.state === 'post').sort((a, b) => b.start_utc.localeCompare(a.start_utc));
  return { live, upcoming: upcoming.slice(0, 10), finals: finals.slice(0, 24) };
}

export const railGames = (rail) => RAIL_GROUPS.flatMap((k) => rail?.[k] || []);

// Merge one game into the rail by game_id. A game whose state moved forward
// (pre → in → post) is re-grouped when allowForwardTransition is set; a game
// the rail has never seen is added and grouped.
export function patchRailGame(rail, game, { allowForwardTransition = false } = {}) {
  if (!game?.game_id) return rail;
  for (const group of RAIL_GROUPS) {
    const idx = (rail[group] || []).findIndex((g) => g.game_id === game.game_id);
    if (idx < 0) continue;
    const prev = rail[group][idx];
    const advanced = phaseRank(game.status?.state) > phaseRank(prev.status?.state);
    if (allowForwardTransition && advanced) {
      return groupRailGames([...railGames(rail).filter((g) => g.game_id !== game.game_id), game]);
    }
    const next = [...rail[group]];
    next[idx] = game;
    return { ...rail, [group]: next };
  }
  return groupRailGames([...railGames(rail), game]);
}

// Merge every fresh slate game. `keep` is the selected game's own /live copy:
// it is fresher than the slate, so the slate never steps it backwards.
export function mergeSlate(rail, fresh, { keep = null } = {}) {
  let next = rail;
  for (const g of fresh) {
    const game = keep && g.game_id === keep.game_id && phaseRank(keep.status?.state) >= phaseRank(g.status?.state) ? keep : g;
    next = patchRailGame(next, game, { allowForwardTransition: true });
  }
  return next;
}

export const slateGames = (today) => [...(today?.slate?.games || []), ...(today?.last_results?.games || [])];

// The first call always fetches (lastAt starts at 0, so the first selected-game
// paint fills every other live card); after that it is throttled.
export function createRailRefresher({ fetchToday, now = Date.now, throttleMs = RAIL_REFRESH_MS }) {
  let lastAt = 0;
  return async function refresh() {
    if (now() - lastAt < throttleMs) return null;
    lastAt = now();
    const r = await fetchToday();
    if (!r?.ok) return null;
    const fresh = slateGames(r.data);
    return fresh.length ? fresh : null;
  };
}
