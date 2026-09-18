import { render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { statsHead, loadStats, statsView, statsBody } from '../views/league.js';

export const title = () => 'Stats';

export async function mount(root, ctx) {
  render(root, `${statsHead()}${skeleton(420)}`);
  const data = await loadStats(api);
  if (!ctx.isCurrent()) return;
  const state = { tab: ctx.query.view === 'teams' ? 'teams' : ctx.query.view === 'players' ? 'players' : 'winba', sort: 'avgPoints', tsort: 'avgPoints' };
  render(root, statsView(data, state));
  const $b = root.querySelector('[data-body]');
  const draw = () => {
    render($b, statsBody(data, state));
    $b.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { state[state.tab === 'players' ? 'sort' : 'tsort'] = b.dataset.sort; draw(); }));
  };
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    draw();
  }));
  draw();
}
