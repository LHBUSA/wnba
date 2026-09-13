import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton, startFreshTicker } from '../ui/components.js';
import { injuriesHead, loadInjuries, injuriesView, injuryList, teamIndex } from '../views/league.js';

export const title = () => 'Injuries & availability';

export async function mount(root, ctx) {
  render(root, html`${injuriesHead()}${skeleton(80)}${skeleton(400)}`);
  const data = await loadInjuries(api);
  if (!ctx.isCurrent()) return;
  render(root, injuriesView(data));
  if (!data.res.ok) return;
  const stopTicker = startFreshTicker(root);
  const tIdx = teamIndex(data.teams);
  const state = { team: '', status: '' };
  const $list = root.querySelector('[data-list]');
  const draw = () => render($list, injuryList(data.res.data.items, tIdx, data.res.meta, state));
  root.querySelector('[data-team]').addEventListener('change', (e) => { state.team = e.target.value; draw(); });
  root.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => {
    state.status = b.dataset.status;
    root.querySelectorAll('[data-status]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    draw();
  }));
  return () => stopTicker();
}
