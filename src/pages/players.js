import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { playersHead, loadPlayers, playersView, playerGrid } from '../views/league.js';

export const title = () => 'Players';

export async function mount(root, ctx) {
  render(root, html`${playersHead()}${skeleton(60)}<div class="pgrid">${skeleton(220, 6)}</div>`);
  const data = await loadPlayers(api);
  if (!ctx.isCurrent()) return;
  const state = { q: ctx.query.q || '', team: ctx.query.team || '', pos: '' };
  render(root, playersView(data, state));
  if (!data.res.ok) return;
  const all = data.res.data.players;
  const $grid = root.querySelector('[data-grid]');
  const $count = root.querySelector('[data-count]');
  const teamSel = root.querySelector('[data-team]');
  teamSel.value = state.team;
  const draw = () => {
    const grid = playerGrid(all, state);
    $count.textContent = `${grid.list.length} player${grid.list.length === 1 ? '' : 's'}`;
    render($grid, grid.body);
  };
  root.querySelector('[data-q]').addEventListener('input', (e) => { state.q = e.target.value; draw(); });
  teamSel.addEventListener('change', (e) => { state.team = e.target.value; draw(); });
  root.querySelector('[data-pos]').addEventListener('change', (e) => { state.pos = e.target.value; draw(); });
  draw();
}
