import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton, startFreshTicker } from '../ui/components.js';
import { createPoller } from '../lib/poller.js';
import { countdownLabel } from '../lib/today-hero.js';
import { loadToday, todayView } from '../views/today.js';

export const title = () => null;

function ageLabel(at) {
  const ms = Date.now() - Date.parse(at || '');
  if (!Number.isFinite(ms) || ms < 0) return 'Updated just now';
  const sec = Math.floor(ms / 1000);
  if (sec < 2) return 'Updated just now';
  if (sec < 60) return `Updated ${sec}s ago`;
  const min = Math.floor(sec / 60);
  return `Updated ${min}m ago`;
}

function startHeroTicker(root) {
  const tick = () => {
    root.querySelectorAll('[data-live-countdown]').forEach((el) => {
      el.textContent = countdownLabel(el.getAttribute('data-live-countdown'), Date.now());
    });
    root.querySelectorAll('[data-live-age]').forEach((el) => {
      el.textContent = ageLabel(el.getAttribute('data-live-age'));
    });
  };
  tick();
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}

export async function mount(root, ctx) {
  render(root, html`<div class="hero2" style="min-height:420px">${skeleton(390)}</div><div class="section">${skeleton(160, 2)}</div>`);
  let poller = null;
  const stopTicker = startFreshTicker(root);
  const stopHeroTicker = startHeroTicker(root);

  const draw = async () => {
    const data = await loadToday(api);
    if (!ctx.isCurrent()) return;
    const { body, live } = todayView(data);
    poller?.setInterval(live ? 10000 : 30000);
    render(root, body);
  };

  poller = createPoller(draw, { intervalMs: 30000 });
  return () => { poller?.stop(); stopTicker(); stopHeroTicker(); };
}
