import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { pageHead, playerCard, sourceLine, errorState, skeleton, empty } from '../ui/components.js';

export const title = () => 'Players';
export const description = () => 'Every current WNBA roster player: identity, team, position, photos where rights and identity are verified, season and recent stats.';

export async function mount(root, ctx) {
  render(root, html`${pageHead({ eyebrow: 'Player intelligence', title: 'Players' })}${skeleton(60)}<div class="pgrid">${skeleton(220, 6)}</div>`);
  const res = await api.players();
  if (!ctx.isCurrent()) return;
  if (!res.ok) return render(root, errorState(res, 'The player index'));
  const all = res.data.players;
  const teams = [...new Map(all.map((p) => [p.team?.team_id, p.team])).values()].filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const cov = res.data.photo_coverage;
  const state = { q: ctx.query.q || '', team: ctx.query.team || '', pos: '' };

  render(root, html`
    ${pageHead({ eyebrow: 'Player intelligence', title: 'Players', sub: `${all.length} players on the ${res.data.teams} current WNBA rosters. Identity comes from ESPN athlete IDs; photos appear only where the image license and the person are both verified.` })}
    <div class="controls">
      <label class="search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search players" value="${state.q}" data-q aria-label="Search players" /></label>
      <select class="select" data-team aria-label="Team"><option value="">All teams</option>${teams.map((t) => html`<option value="${t.team_id}">${t.name}</option>`)}</select>
      <select class="select" data-pos aria-label="Position"><option value="">All positions</option><option value="G">Guards</option><option value="F">Forwards</option><option value="C">Centers</option></select>
    </div>
    <div class="note" style="margin-bottom:12px" data-count></div>
    <div class="pgrid" data-grid></div>
    <div style="margin-top:18px">${sourceLine(res.meta, { label: `Photos verified: ${cov?.approved ?? 0} of ${all.length}` })}</div>
  `);
  const $grid = root.querySelector('[data-grid]');
  const $count = root.querySelector('[data-count]');
  const teamSel = root.querySelector('[data-team]');
  teamSel.value = state.team;

  const draw = () => {
    const q = state.q.trim().toLowerCase();
    const list = all.filter((p) => (!q || p.name.toLowerCase().includes(q)) && (!state.team || p.team?.team_id === state.team) && (!state.pos || String(p.position || '').includes(state.pos)));
    $count.textContent = `${list.length} player${list.length === 1 ? '' : 's'}`;
    render($grid, list.length ? html`${list.map(playerCard)}` : empty('No players match', 'Try a different name, team or position.'));
  };
  root.querySelector('[data-q]').addEventListener('input', (e) => { state.q = e.target.value; draw(); });
  teamSel.addEventListener('change', (e) => { state.team = e.target.value; draw(); });
  root.querySelector('[data-pos]').addEventListener('change', (e) => { state.pos = e.target.value; draw(); });
  draw();
}
