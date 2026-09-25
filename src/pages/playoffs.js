import { render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { createPoller } from '../lib/poller.js';
import { allGames } from '../ui/bracket.js';
import { playoffsHead, loadPlayoffs, playoffsView } from '../views/playoffs.js';

export const title = () => 'WNBA Playoffs';

// One poller. Cadence follows the bracket: fast while a playoff game is live, slow between games, none once complete.
function intervalFor(res) {
  const d = res?.ok ? res.data : null;
  if (!d || d.status === 'COMPLETE' || !d.is_current_season) return 0;
  return allGames(d).some((g) => g.status === 'LIVE') ? 30000 : 120000;
}

export async function mount(root, ctx) {
  const season = /^\d{4}$/.test(ctx.query?.season || '') ? ctx.query.season : null;
  render(root, `${playoffsHead()}${skeleton(520)}`);
  let poller = null;
  const load = async () => {
    const data = await loadPlayoffs(api, { season });
    if (!ctx.isCurrent()) return;
    // Keep the reader's place while the board refreshes underneath them.
    const y = window.scrollY;
    render(root, playoffsView(data, { season }));
    if (poller) window.scrollTo({ top: y });
    const ms = intervalFor(data.res);
    if (!poller && ms) poller = createPoller(load, { intervalMs: ms, immediate: false });
    else if (poller) poller.setInterval(ms);
  };
  await load();
  return () => poller?.stop();
}
