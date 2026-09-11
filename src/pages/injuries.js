import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { pageHead, sourceLine, errorState, skeleton, avatar, statusBadge, empty, teamDot, startFreshTicker } from '../ui/components.js';
import { fmtDateET, fmtDateTimeET, relTime } from '../lib/format.js';

export const title = () => 'Injuries & availability';
export const description = () => 'WNBA availability desk: every listed player with source, status, reported detail, source update time and capture time. No invented return dates.';

export async function mount(root, ctx) {
  render(root, html`${pageHead({ eyebrow: 'Availability desk', title: 'Injuries' })}${skeleton(80)}${skeleton(400)}`);
  const [res, teams] = await Promise.all([api.injuries(), api.teams()]);
  if (!ctx.isCurrent()) return;
  if (!res.ok) return render(root, errorState(res, 'The injury feed'));
  const tIdx = new Map((teams.ok ? teams.data.teams : []).map((t) => [t.team_id, t]));
  const items = res.data.items;
  const state = { team: '', status: '' };
  const stopTicker = startFreshTicker(root);

  render(root, html`
    ${pageHead({ eyebrow: 'Availability desk', title: 'Injuries', sub: 'Every status carries its source, when the source last updated it, and when PropBetEdge captured it. Reported notes stay attributed. Return dates appear only when the source publishes one — and are labelled as the source’s.' })}
    <div class="callout" style="margin-bottom:16px"><b>Authority:</b> ${res.data.authority} The league’s official game-day injury report is a separate document and is not yet ingested.</div>
    <div class="tiles" style="margin-bottom:16px">
      <div class="tile"><small>Listed</small><b>${items.length}</b><span>players on feed</span></div>
      <div class="tile"><small>Out</small><b>${items.filter((i) => /out/i.test(i.status || '')).length}</b><span>incl. out for season</span></div>
      <div class="tile"><small>Day-to-day</small><b>${items.filter((i) => /day/i.test(i.status || '')).length}</b><span>status per ESPN</span></div>
      <div class="tile"><small>Changes logged</small><b>${res.data.changes.length}</b><span>before → after</span></div>
    </div>
    <div class="controls">
      <select class="select" data-team aria-label="Team"><option value="">All teams</option>${[...tIdx.values()].sort((a, b) => a.name.localeCompare(b.name)).map((t) => html`<option value="${t.team_id}">${t.name}</option>`)}</select>
      <div class="pill-row">${[['', 'All'], ['out', 'Out'], ['day', 'Day-to-day']].map(([k, l]) => html`<button class="pill" type="button" data-status="${k}" aria-pressed="${k === ''}">${l}</button>`)}</div>
    </div>
    <div class="split">
      <section class="card card-pad" data-list></section>
      <aside>
        <section class="card">
          <div class="card-head"><span class="card-title">Change ledger</span></div>
          <div class="card-body">
            ${res.data.changes.length ? res.data.changes.slice(0, 30).map((c) => html`<div class="change-row">${avatar({ name: c.name }, { size: 'sm' })}<div><b>${c.name}</b><div class="note">${c.change_kind.replace('_', ' ')}: ${c.status_before || 'not listed'} → ${c.status_after || 'off feed'}</div></div><span class="note">${relTime(c.captured_at)}</span></div>`) : html`<p class="note">${res.data.change_ledger}</p>`}
          </div>
        </section>
      </aside>
    </div>
    <div style="margin-top:16px">${sourceLine(res.meta, { label: 'ESPN injury feed' })}</div>
  `);

  const $list = root.querySelector('[data-list]');
  const draw = () => {
    const list = items.filter((i) => (!state.team || i.team_id === state.team) && (!state.status || new RegExp(state.status, 'i').test(i.status || '')));
    const byTeam = new Map();
    for (const i of list) { if (!byTeam.has(i.team_id)) byTeam.set(i.team_id, []); byTeam.get(i.team_id).push(i); }
    render($list, list.length ? html`${[...byTeam.entries()].map(([tid, rows]) => {
      const t = tIdx.get(tid) || { name: rows[0].team_name };
      return html`<div style="margin-bottom:10px"><div class="sec-head" style="margin:8px 0 0"><h3 class="sec-title" style="display:flex;gap:8px;align-items:center">${teamDot(t)}${t.name}</h3><a class="sec-link" href="/teams/${tid}">Team →</a></div>
        ${rows.map((i) => html`<div class="inj-row">
          ${avatar({ name: i.name, photo: i.photo }, { teamColor: t.color })}
          <div class="who"><a href="${i.athlete_id ? `/players/${i.athlete_id}` : '#'}"><b>${i.name}</b></a> ${statusBadge(i.status)}
            <small>${[i.position, [i.side, i.body_part].filter(Boolean).join(' '), i.detail].filter(Boolean).join(' · ') || 'No detail published'}</small>
            ${i.short_comment ? html`<blockquote>${i.short_comment}</blockquote>` : ''}
            ${i.source_return_date ? html`<small style="margin-top:6px">ESPN lists an expected return of ${fmtDateET(i.source_return_date + 'T16:00:00Z', { month: 'short', day: 'numeric' })} — source-reported, not a PropBetEdge estimate.</small>` : ''}
          </div>
          <div class="when">Source updated<br />${fmtDateTimeET(i.source_updated_at)}<br /><span>Captured ${relTime(res.meta.fetched_at)}</span></div>
        </div>`)}</div>`;
    })}` : empty('Nobody matches', 'No listed players for this filter.'));
  };
  root.querySelector('[data-team]').addEventListener('change', (e) => { state.team = e.target.value; draw(); });
  root.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => {
    state.status = b.dataset.status;
    root.querySelectorAll('[data-status]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    draw();
  }));
  draw();
  return () => stopTicker();
}
