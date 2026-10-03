// Matchups list + game research. Rendering lives in src/views/matchups.js (shared with the publishing Worker).
import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { loadMatchupsList, matchupsListView, matchupsListHead, loadMatchup, matchupView } from '../views/matchups.js';
import { routeMeta } from '../seo/meta.js';
import { createPoller } from '../lib/poller.js';
import { kalshi, marketPollMs, within, matchupKalshiSlot, matchupKalshiMarkup, loadAlgoVsMarketEvent, matchupAvmSlot, avmEventMarkup, avmFinal, AVM_POLL_MS } from '../data/kalshi.js';
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
  const avmLoad = loadAlgoVsMarketEvent(gameId); // PBE pick vs market at PBE lock (same bounded first-paint wait)
  const data = await loadMatchup(api, gameId);
  const [kxFirst, avmFirst] = await Promise.all([within(kxLoad, 800), within(avmLoad, 800)]);
  if (!ctx.isCurrent()) return;
  if (data.res.ok) ctx.setMeta(routeMeta('matchups', { path: ctx.path, params: ctx.params, data: data.res.data }));
  const g = data.res.ok ? data.res.data.game : null;
  render(root, matchupView({ ...data, kalshi: g ? html`${matchupKalshiSlot(kxFirst ?? null, g)}${matchupAvmSlot(avmFirst ?? null, g)}` : '' }));
  if (!g) return;
  wireKalshi(root);

  // Algo vs Market: its own slot, re-read every 5 min until the comparison has a result; a failed read keeps
  // what is shown. Nothing renders until the API has a qualifying comparison for this game.
  let avm = avmFirst ?? null;
  const paintAvm = () => {
    const slot = root.querySelector('[data-avm-slot]');
    if (!slot) return;
    const markup = avmEventMarkup(avm, g);
    if (slot.innerHTML !== markup) slot.innerHTML = markup;
  };
  if (avmFirst === undefined) avmLoad.then((v) => { if (!ctx.isCurrent()) return; avm = v; paintAvm(); });
  const avmPoller = createPoller(async () => {
    if (avmFinal(avm)) return avmPoller.stop();
    const next = await loadAlgoVsMarketEvent(gameId);
    if (!ctx.isCurrent()) return avmPoller.stop();
    if (next) { avm = next; paintAvm(); }
  }, { intervalMs: AVM_POLL_MS, immediate: false });

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
  if (!first) return () => avmPoller.stop();
  poller = createPoller(async () => {
    const next = await kalshi.loadEvent(gameId, { force: true });
    if (!ctx.isCurrent()) return poller?.stop();
    paint(next);
    const ms = marketPollMs(g, next);
    if (!ms) poller.stop(); else poller.setInterval(ms);
  }, { intervalMs: first, immediate: false });
  return () => { poller?.stop(); avmPoller.stop(); };
}
