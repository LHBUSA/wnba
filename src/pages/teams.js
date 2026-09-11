import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { pageHead, sourceLine, errorState, skeleton, safeColor } from '../ui/components.js';
import { teamLogo } from '../ui/logo.js';

export const title = () => 'Teams';
export const description = () => 'All 15 WNBA teams with current record, seed, roster, schedule, observed rotation and availability.';

export async function mount(root, ctx) {
  render(root, html`${pageHead({ eyebrow: 'League', title: 'Teams' })}<div class="grid g3">${skeleton(110, 6)}</div>`);
  const [teams, st] = await Promise.all([api.teams(), api.standings()]);
  if (!ctx.isCurrent()) return;
  if (!teams.ok) return render(root, errorState(teams, 'Teams'));
  const rows = st.ok ? st.data.groups.flatMap((g) => g.entries.map((e) => ({ ...e, conf: g.name }))) : [];
  const list = teams.data.teams.map((t) => ({ ...t, st: rows.find((r) => r.team_id === t.team_id) })).sort((a, b) => a.name.localeCompare(b.name));
  render(root, html`
    ${pageHead({ eyebrow: 'League', title: 'Teams', sub: `${list.length} teams in the ${st.ok ? st.data.season?.label || '' : ''} season.` })}
    <div class="grid g3">
      ${list.map((t) => html`<a class="card card-pad" href="/teams/${t.team_id}" style="border-top:3px solid ${safeColor(t.color, 'var(--gold)')};display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center"><div>
        <div class="note" style="letter-spacing:.12em;text-transform:uppercase">${t.location}</div>
        <div style="font:800 28px/1 var(--f-display);text-transform:uppercase;margin-top:4px">${t.short_name}</div>
        <div class="src" style="margin-top:10px"><span><b>${t.st ? `${t.st.wins}-${t.st.losses}` : '—'}</b></span><span>${t.st ? `${t.st.conf.replace(' Conference', '')} · seed ${t.st.seed ?? '—'}` : ''}</span>${t.st?.streak ? html`<span>${t.st.streak}</span>` : ''}</div>
      </div>${teamLogo(t, 72)}</a>`)}
    </div>
    <div style="margin-top:14px">${sourceLine(teams.meta)}</div>
  `);
}
