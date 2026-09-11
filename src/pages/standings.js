import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { pageHead, sourceLine, errorState, skeleton, teamDot, badge } from '../ui/components.js';
import { num, signed } from '../lib/format.js';
import { teamLogo } from '../ui/logo.js';

export const title = () => 'Standings';
export const description = () => 'Current WNBA standings by conference with seeds, games back, streaks, home/road splits and clinch marks — prior seasons are always labelled.';

export async function mount(root, ctx) {
  render(root, html`${pageHead({ eyebrow: 'League table', title: 'Standings' })}${skeleton(420)}`);
  const res = await api.standings();
  if (!ctx.isCurrent()) return;
  if (!res.ok) return render(root, errorState(res, 'Standings'));
  const d = res.data;
  render(root, html`
    ${pageHead({ eyebrow: d.is_current ? 'Current season' : 'Prior season — final', title: 'Standings', sub: d.label, right: d.is_current ? badge('final', d.phase || 'Current') : badge('stale', 'Not current') })}
    <div class="grid g2">
      ${d.groups.map((g) => html`<section class="card">
        <div class="card-head"><span class="card-title">${g.name}</span></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Team</th><th>W</th><th>L</th><th>PCT</th><th>GB</th><th>L10</th><th>STRK</th><th>HOME</th><th>ROAD</th><th>DIFF</th></tr></thead><tbody>
          ${g.entries.map((t) => html`<tr><td><a class="pname" href="/teams/${t.team_id}"><span class="mono faint" style="width:16px">${t.seed ?? ''}</span>${teamLogo(t, 26)}${t.name}${t.clincher ? html`<span class="clinch" title="ESPN clinch mark">${t.clincher}</span>` : ''}</a></td><td>${t.wins}</td><td>${t.losses}</td><td>${num(t.win_pct, 3).replace(/^0/, '')}</td><td>${t.games_behind}</td><td>${t.last_ten || '—'}</td><td>${t.streak || '—'}</td><td>${t.home || '—'}</td><td>${t.road || '—'}</td><td>${signed(t.differential)}</td></tr>`)}
        </tbody></table></div>
      </section>`)}
    </div>
    <p class="note" style="margin-top:12px">Clinch marks are ESPN’s (x = clinched a playoff berth; e/o = eliminated). Seeds as published by the source. Differential is average point margin per game.</p>
    <div style="margin-top:12px">${sourceLine(res.meta)}</div>
  `);
}
