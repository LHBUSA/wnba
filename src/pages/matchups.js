// Matchups list + game research. Rendering lives in src/views/matchups.js (shared with the publishing Worker).
import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { loadMatchupsList, matchupsListView, matchupsListHead, loadMatchup, matchupView } from '../views/matchups.js';
import { routeMeta } from '../seo/meta.js';
import { createPoller } from '../lib/poller.js';
import { kalshi, kalshiColors, kalshiPollState, matchupKalshiSlot } from '../data/kalshi.js';
import { kalshiCard, wireKalshi } from '../vendor/kalshi/kalshi-market-ui.js';

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
  // The Kalshi market loads WITH the matchup so its card is part of the first paint (no layout shift).
  const [data, kxEntry] = await Promise.all([loadMatchup(api, gameId), kalshi.loadEvent(gameId)]);
  if (!ctx.isCurrent()) return;
  if (data.res.ok) ctx.setMeta(routeMeta('matchups', { path: ctx.path, params: ctx.params, data: data.res.data }));
  const g = data.res.ok ? data.res.data.game : null;
  render(root, matchupView({ ...data, kalshi: g ? matchupKalshiSlot(kxEntry, g) : '' }));
  if (!g) return;
  wireKalshi(root);

  // Poll our markets Worker (never Kalshi) while this page is mounted: 20 s live, 45 s pregame, nothing otherwise.
  // Only the Kalshi slot is repainted; the sportsbook block and the rest of the page are untouched.
  const state = kalshiPollState(g);
  if (state === 'idle') return;
  let poller = null;
  poller = createPoller(async () => {
    const entry = await kalshi.loadEvent(gameId, { force: true });
    if (!ctx.isCurrent()) return poller?.stop();
    const slot = root.querySelector('[data-kx-slot]');
    if (!slot) return;
    slot.innerHTML = kalshiCard(entry, { placement: 'matchup-page', colors: kalshiColors(g) });
    wireKalshi(slot);
  }, { intervalMs: kalshi.pollMsFor(state), immediate: false });
  return () => poller.stop();
}
