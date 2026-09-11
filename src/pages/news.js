import { html, render, raw } from '../lib/dom.js';
import { api } from '../data/api.js';
import { pageHead, errorState, skeleton, badge, entityChips, empty } from '../ui/components.js';
import { relTime, fmtDateTimeET } from '../lib/format.js';

export const title = () => 'WNBA News';
export const description = () => 'The PropBetEdge WNBA newsroom: WNBA-only stories from official and independent publishers, deduplicated and linked to players, teams and games, plus the PBE Desk.';

const TYPES = [['', 'All'], ['injury', 'Injuries'], ['transaction', 'Transactions'], ['trade', 'Trades'], ['result', 'Results'], ['playoffs', 'Playoffs'], ['performance', 'Performances'], ['league', 'League'], ['preview', 'Previews']];
const TYPE_LABEL = { injury: 'Injury', transaction: 'Transaction', trade: 'Trade', coaching: 'Coaching', lineup: 'Lineup', playoffs: 'Playoffs', performance: 'Performance', preview: 'Preview', recap: 'Recap', league: 'League', news: 'News', result: 'Result', availability_change: 'Availability', clinch: 'Standings' };

export async function mount(root, ctx) {
  render(root, html`${pageHead({ eyebrow: 'Newsroom', title: 'WNBA News' })}${skeleton(400)}`);
  const state = { type: ctx.query.type || '' };
  const [res, sources] = await Promise.all([api.news({ limit: 100 }), api.newsSources()]);
  if (!ctx.isCurrent()) return;
  if (!res.ok) return render(root, html`${pageHead({ eyebrow: 'Newsroom', title: 'WNBA News' })}${errorState(res, 'The newsroom')}`);
  const all = res.data.items;

  render(root, html`
    ${pageHead({ eyebrow: 'Newsroom', title: 'WNBA News', sub: 'WNBA-only. Official and independent publishers are ingested every 10 minutes, filtered for genuine WNBA relevance, deduplicated across publishers and linked to players, teams and games. The PBE Desk writes only from cited records — a quiet day stays quiet.' })}
    <div class="pill-row" style="margin-bottom:16px">${TYPES.map(([k, l]) => html`<button class="pill" type="button" data-type="${k}" aria-pressed="${state.type === k}">${l}</button>`)}</div>
    <div class="split">
      <section class="card card-pad" data-feed></section>
      <aside class="grid" style="gap:16px;align-content:start">
        <section class="card">
          <div class="card-head"><span class="card-title">Sources</span><span class="note">every 10 min</span></div>
          <div class="card-body">
            ${(sources.ok ? sources.data.sources : []).map((s) => html`<div class="change-row" style="grid-template-columns:minmax(0,1fr) auto">
              <div><b>${s.name}</b><div class="note">${s.kind.replace('_', ' ')}${s.wnba_scope === 'mixed_filter_required' ? ' · mixed feed, WNBA-filtered' : ''}</div></div>
              ${s.last_run ? badge(s.last_run.status === 'PASS' ? 'final' : 'stale', `${s.last_run.status}${s.last_run.accepted !== undefined ? ` · ${s.last_run.accepted}` : ''}`) : s.kind === 'owned' ? badge('pbe', 'Owned') : ''}
            </div>`)}
            <p class="note" style="margin-top:10px">Last ingest ${relTime(res.meta.last_ingest_at)}. External stories open on the publisher’s site; we keep only the headline, link and the publisher’s own summary.</p>
          </div>
        </section>
        <section class="card card-pad">
          <span class="eyebrow">How the PBE Desk writes</span>
          <p class="note" style="margin-top:10px">Desk stories are generated from structured records — box scores, the availability change ledger, the transactions log, standings marks — and every story lists its evidence. No quotes are invented, no outcomes predicted, no return dates estimated.</p>
        </section>
      </aside>
    </div>
  `);

  const $feed = root.querySelector('[data-feed]');
  const draw = () => {
    const list = all.filter((i) => !state.type || i.kind === state.type || (state.type === 'injury' && i.kind === 'availability_change') || (state.type === 'playoffs' && i.kind === 'clinch'));
    render($feed, list.length ? html`${list.map((i) => i.lane === 'pbe' ? html`
      <article class="nitem">
        <div class="nmeta">${badge('pbe', 'PBE Desk')}<span>${TYPE_LABEL[i.kind] || i.kind}</span><span>${fmtDateTimeET(i.published_at)}</span></div>
        <h3><a href="/news/story/${i.id}">${i.headline}</a></h3>
        <p class="nsum">${String(i.body).split('\n\n')[0]}</p>
        <div class="nents">${entityChips(i.entities)}</div>
      </article>` : html`
      <article class="nitem">
        <div class="nmeta">${badge('ext', i.source.name)}<span>${TYPE_LABEL[i.kind] || i.kind}</span><span title="Published ${fmtDateTimeET(i.published_at)} · captured ${fmtDateTimeET(i.captured_at)}">${relTime(i.published_at)}</span>${i.byline ? html`<span>${i.byline}</span>` : ''}</div>
        <h3><a href="${i.url}" rel="noopener" target="_blank">${i.headline} <span class="note" aria-hidden="true">↗</span></a></h3>
        ${i.summary ? html`<p class="nsum">${i.summary}</p>` : ''}
        <div class="nents">${entityChips(i.entities)}</div>
        ${i.also_covered_by?.length ? html`<p class="also">Also covered by ${i.also_covered_by.map((a, n) => html`${n ? ', ' : ''}<a href="${a.url}" rel="noopener" target="_blank">${a.source}</a>`)}</p>` : ''}
      </article>`)}` : empty('Nothing in this lane', 'No WNBA stories of this type in the last three weeks.'));
  };
  root.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
    state.type = b.dataset.type;
    root.querySelectorAll('[data-type]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    draw();
  }));
  draw();
}
