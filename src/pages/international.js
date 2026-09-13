// International women's basketball pages. Rendering lives in src/views/international.js (shared with the
// publishing Worker); this module adds live polling only while a game on the page is genuinely in progress.
import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { createPoller } from '../lib/poller.js';
import { routeMeta } from '../seo/meta.js';
import { loadIntlHome, intlHomeView, loadCompetition, competitionView, loadIntlGame, intlGameView, loadNationalTeam, nationalTeamView, loadIntlPlayer, intlPlayerView, playerHref } from '../views/international.js';

export const title = () => null;
export const CURRENT_WORLD_CUP = 'world-cup-2026';
const LIVE_POLL_MS = 10000;
const IDLE_POLL_MS = 120000;

export async function mount(root, ctx) {
  const id = ctx.routeId;
  // Short alias routes resolve to the one canonical competition URL (the Worker answers them with a 301).
  if (id === 'world-cup' || (id === 'intl-competition' && ctx.params.competition === 'world-cup')) {
    ctx.go(`/international/${CURRENT_WORLD_CUP}${ctx.params.section ? `/${ctx.params.section}` : ''}`, { replace: true });
    return undefined;
  }
  render(root, html`${skeleton(260)}${skeleton(200, 2)}`);
  let poller = null;
  let first = true;

  const draw = async () => {
    let body = '';
    let live = false;
    if (id === 'international') {
      const data = await loadIntlHome(api);
      live = Boolean(data.home?.data?.live?.length);
      body = intlHomeView(data);
    } else if (id === 'intl-competition') {
      const data = await loadCompetition(api, ctx.params.competition, ctx.params.section || null);
      live = Boolean(data.ov?.data?.scoreboard?.live?.length);
      if (first && data.ov?.ok) ctx.setMeta(routeMeta(id, { path: ctx.path, params: ctx.params, data: data.ov.data }));
      body = competitionView(data);
    } else if (id === 'intl-game') {
      const data = await loadIntlGame(api, ctx.params.gameId);
      live = data.res?.data?.game?.status === 'live';
      if (first && data.res?.ok) ctx.setMeta(routeMeta(id, { path: ctx.path, params: ctx.params, data: data.res.data }));
      body = intlGameView(data);
    } else if (id === 'intl-team') {
      const data = await loadNationalTeam(api, ctx.params.teamSlug);
      if (first && data.res?.ok) ctx.setMeta(routeMeta(id, { path: ctx.path, params: ctx.params, data: data.res.data }));
      body = nationalTeamView(data);
    } else if (id === 'intl-player') {
      const data = await loadIntlPlayer(api, ctx.params.playerId);
      if (data.res?.ok) {
        const canonical = playerHref(data.res.data.player);
        if (ctx.path !== canonical) history.replaceState({}, '', canonical);
        if (first) ctx.setMeta(routeMeta(id, { path: canonical, params: ctx.params, data: data.res.data }));
      }
      body = intlPlayerView(data);
    }
    if (!ctx.isCurrent()) return;
    render(root, body);
    first = false;
    poller?.setInterval(live ? LIVE_POLL_MS : ['international', 'intl-competition', 'intl-game'].includes(id) ? IDLE_POLL_MS : 0);
  };

  poller = createPoller(draw, { intervalMs: IDLE_POLL_MS });
  return () => poller?.stop();
}
