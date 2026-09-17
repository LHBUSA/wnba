const DISRUPTED = /POSTPONED|CANCELED|CANCELLED|DELAYED|SUSPENDED/i;

const byStart = (a, b) => String(a?.start_utc || '').localeCompare(String(b?.start_utc || ''));
const disrupted = (g) => DISRUPTED.test(`${g?.status?.name || ''} ${g?.status?.short_detail || ''}`);

export function countdownLabel(startUtc, now = Date.now()) {
  const at = Date.parse(startUtc || '');
  if (!Number.isFinite(at)) return '—';
  const ms = at - Number(now);
  if (ms <= 0) return 'STARTING NOW';
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `${mins}M`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return rem ? `${hours}H ${rem}M` : `${hours}H`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}D ${remHours}H` : `${days}D`;
}

export function resolveTodayHero(data, now = Date.now()) {
  const slate = data?.slate || {};
  const games = [...(slate.games || [])].sort(byStart);
  const liveGames = games.filter((g) => g?.status?.state === 'in');
  const finalGames = games.filter((g) => g?.status?.state === 'post');
  const disruptedGames = games.filter((g) => g?.status?.state === 'pre' && disrupted(g));
  const upcomingGames = games.filter((g) => g?.status?.state === 'pre' && !disrupted(g));

  let mode = 'DESK';
  let primary = null;
  let selectors = [];

  if (liveGames.length) {
    mode = 'LIVE';
    primary = liveGames[0];
    selectors = liveGames;
  } else if (slate.kind === 'TODAY' && upcomingGames.length && finalGames.length) {
    mode = 'BETWEEN';
    primary = upcomingGames[0];
    selectors = upcomingGames;
  } else if (slate.kind === 'TODAY' && upcomingGames.length) {
    mode = 'PREGAME';
    primary = upcomingGames[0];
    selectors = upcomingGames;
  } else if (slate.kind === 'TODAY' && finalGames.length && !upcomingGames.length && !disruptedGames.length) {
    mode = 'FINAL';
    primary = finalGames[finalGames.length - 1];
    selectors = finalGames.slice(-5).reverse();
  } else if (slate.kind === 'TODAY' && disruptedGames.length && !upcomingGames.length) {
    mode = 'DELAYED';
    primary = disruptedGames[0];
    selectors = disruptedGames;
  } else if (slate.kind === 'NEXT' && games.length) {
    mode = 'OFFDAY';
    primary = upcomingGames[0] || disruptedGames[0] || games[0];
    selectors = (upcomingGames.length ? upcomingGames : games).slice(0, 5);
  } else if (games.length) {
    primary = games[0];
    selectors = games.slice(0, 5);
  }

  const previous = finalGames.length ? finalGames[finalGames.length - 1] : null;
  const next = upcomingGames.find((g) => g?.game_id !== primary?.game_id) || null;
  const priced = games.filter((g) => g?.market).length;

  return {
    mode,
    primary,
    previous,
    next,
    selectors: selectors.slice(0, 5),
    liveGames,
    upcomingGames,
    finalGames,
    disruptedGames,
    games,
    totals: {
      games: games.length,
      live: liveGames.length,
      scheduled: upcomingGames.length,
      final: finalGames.length,
      disrupted: disruptedGames.length,
      priced,
      out: data?.availability?.out ?? null
    },
    countdown: primary?.start_utc ? countdownLabel(primary.start_utc, now) : null
  };
}
