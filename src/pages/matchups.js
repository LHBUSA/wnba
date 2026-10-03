// Matchups list + game research. Rendering lives in src/views/matchups.js (shared with the publishing Worker).
import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { loadMatchupsList, matchupsListView, matchupsListHead, loadMatchup, matchupView } from '../views/matchups.js';
import { routeMeta } from '../seo/meta.js';
import { createPoller } from '../lib/poller.js';
import { kalshi, marketPollMs, within, matchupKalshiSlot, matchupKalshiMarkup } from '../data/kalshi.js';
import { wireKalshi } from '../vendor/kalshi/kalshi-market-ui.js';

export const title = (p) => (p.gameId ? 'Matchup research' : 'Matchups');

export async function mount(root, ctx) {
  if (!ctx.params.gameId) {
    render(root, html`${matchupsListHead()}${skeleton(160, 2)}`);
    // The Kalshi board loads alongside the schedule so game-card lines are in the first paint.
    const [data] = await Promise.all([loadMatchupsList(api), kalshi.loadBoard()]);
    if (!ctx.isCurrent()) return;
    render(root, matchupsListView(data));
    wireKalshi(root);
    return;
  }
  render(root, html`${skeleton(120)}${skeleton(420)}`);
  const gameId = ctx.params.gameId;
  // The market module loads WITH the matchup so it is part of the first paint (no layout shift); the wait for it is
  // bounded (<= 800 ms after the matchup), after which it paints into its own slot when it arrives.
  const kxLoad = kalshi.loadEvent(gameId);
  const data = await loadMatchup(api, gameId);
  const kxFirst = await within(kxLoad, 800);
  if (!ctx.isCurrent()) return;
  if (data.res.ok) ctx.setMeta(routeMeta('matchups', { path: ctx.path, params: ctx.params, data: data.res.data }));
  const g = data.res.ok ? data.res.data.game : null;
  render(root, matchupView({ ...data, kalshi: g ? matchupKalshiSlot(kxFirst ?? null, g) : '' }));
  if (!g) return;
  wireKalshi(root);

  // Only the market slot is ever repainted; the sportsbook block and the rest of the page are untouched.
  // Every event that has/had a market mounts, FINAL games included: the live card while it trades, then
  // "How the market closed" once CLOSED/SETTLED — the page evolves with no frontend release.
  let poller = null;
  let entry = kxFirst ?? null;
  const paint = (e) => {
    const slot = root.querySelector('[data-kx-slot]');
    if (!slot) return;
    const markup = matchupKalshiMarkup(e, g);
    if (slot.innerHTML !== markup) { slot.innerHTML = markup; wireKalshi(slot); }
  };
  if (kxFirst === undefined) {
    entry = await kxLoad;
    if (!ctx.isCurrent()) return;
    paint(entry);
  }
  // Poll our markets Worker (never Kalshi): live 20 s, pregame 45 s, CLOSED every 5 min until SETTLED, SETTLED never.
  const first = marketPollMs(g, entry);
  if (!first) return;
  poller = createPoller(async () => {
    const next = await kalshi.loadEvent(gameId, { force: true });
    if (!ctx.isCurrent()) return poller?.stop();
    paint(next);
    const ms = marketPollMs(g, next);
    if (!ms) poller.stop(); else poller.setInterval(ms);
  }, { intervalMs: first, immediate: false });
  return () => poller?.stop();
}
