import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton, startFreshTicker } from '../ui/components.js';
import { createPoller } from '../lib/poller.js';
import { loadToday, todayView } from '../views/today.js';

export const title = () => null;

export async function mount(root, ctx) {
  render(root, html`<div class="hero2" style="min-height:320px">${skeleton(300)}</div><div class="section">${skeleton(160, 2)}</div>`);
  let poller = null;
  const stopTicker = startFreshTicker(root);

  const draw = async () => {
    const data = await loadToday(api);
    if (!ctx.isCurrent()) return;
    const { body, live } = todayView(data);
    poller?.setInterval(live ? 20000 : 120000);
    render(root, body);
  };

  poller = createPoller(draw, { intervalMs: 120000 });
  return () => { poller?.stop(); stopTicker(); };
}
