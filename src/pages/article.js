// In-house article page: headline, deck, body, why it matters for bettors,
// counter-case, unknowns, market angle (stored snapshot, sourced + timed),
// context, evidence and related content.
import { html, render, raw } from '../lib/dom.js';
import { api } from '../data/api.js';
import { errorState, skeleton, badge, marketStrip, avatar } from '../ui/components.js';
import { teamLogo, logoEntry, teamColors } from '../ui/logo.js';
import { KIND_LABEL, articleMini } from '../ui/articles.js';
import { fmtDateTimeET, relTime, fmtDateET } from '../lib/format.js';

export const title = () => 'WNBA News';

export async function mount(root, ctx) {
  render(root, html`${skeleton(280)}${skeleton(420)}`);
  const res = await api.article(ctx.params.slug);
  if (!ctx.isCurrent()) return;
  if (!res.ok) return render(root, errorState(res, 'This article'));
  const a = res.data.article;
  const related = res.data.related || [];
  ctx.setMeta({ title: a.headline, description: a.deck });
  const teams = (a.entities || []).filter((e) => e && e.type === 'team');
  const players = (a.entities || []).filter((e) => e && e.type === 'player');
  const games = (a.entities || []).filter((e) => e && e.type === 'game');
  const c1 = teamColors({ team_id: teams[0]?.id }).color || '#d4af37';
  const c2 = teamColors({ team_id: teams[1]?.id }).color || '#ff7a2f';
  const lead = logoEntry(a.lead_team_id);
  const b = a.bettor_angle || {};
  const mw = a.market_watch || {};
  const ng = a.context?.next_game || a.context?.game || null;
  const gameForStrip = ng ? { home: ng.home, away: ng.away } : null;

  render(root, html`
    <div class="split" style="align-items:start">
      <article class="art">
        <header class="art-head" style="--tc1:${c1};--tc2:${c2}">
          ${lead ? html`<img class="bg-logo" src="${lead.files['320']}" alt="" width="260" height="260" decoding="async" />` : ''}
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            ${teams.slice(0, 2).map((t) => html`<a href="/teams/${t.id}">${teamLogo({ team_id: t.id, name: t.name }, 36)}</a>`)}
            <a class="eyebrow" href="/news/c/${a.kind === 'result' ? 'performance' : a.kind}">${KIND_LABEL[a.kind] || a.category}</a>
            <span class="badge pbe">PBE Newsroom</span>
          </div>
          <h1>${a.headline}</h1>
          <p class="deck">${a.deck}</p>
          <div class="art-meta">
            <span>By the PropBetEdge WNBA newsroom</span>
            <span>Published ${fmtDateTimeET(a.first_published_at || a.published_at)}</span>
            ${a.revised_at ? html`<span>Updated ${fmtDateTimeET(a.revised_at)}</span>` : ''}
            <span>Source event ${fmtDateTimeET(a.published_at)}</span>
          </div>
        </header>

        <div class="art-body" style="margin-top:26px">
          ${a.body.map((p) => html`<p>${p}</p>`)}

          <section class="bettor-box">
            <h2>Why it matters for bettors</h2>
            <p>${b.summary}</p>
            ${(b.supporting || []).map((x) => html`<p>${x}</p>`)}
            <div class="grid g2" style="margin-top:6px;gap:14px">
              <div><h2 style="color:var(--dim)!important;margin:.4em 0 .6em">What argues against it</h2>${(b.against || []).map((x) => html`<p style="font-size:15.5px!important;color:var(--dim)">${x}</p>`)}</div>
              <div><h2 style="color:var(--dim)!important;margin:.4em 0 .6em">Still unknown</h2>${(b.unknown || []).map((x) => html`<p style="font-size:15.5px!important;color:var(--dim)">${x}</p>`)}</div>
            </div>
            <p class="note" style="font-family:var(--f-data)!important;font-size:11.5px!important">Markets touched: ${(b.markets || []).join(' · ').replaceAll('_', ' ')} · PropBetEdge model: not published</p>
          </section>

          <section class="takeaway">
            <h2>Market angle</h2>
            ${(mw.text || []).map((x) => html`<p style="font-size:16.5px">${x}</p>`)}
            ${mw.market && gameForStrip ? html`<div style="margin-top:12px">${marketStrip(mw.market, gameForStrip)}</div>` : ''}
            ${mw.game_id ? html`<p style="margin-top:12px"><a class="sec-link" href="/matchups/${mw.game_id}">Full matchup and line context →</a> <a class="sec-link" style="margin-left:14px" href="/cast/${mw.game_id}">WNBACast →</a></p>` : ''}
          </section>

          <h2>Evidence</h2>
          <ol class="evidence">
            ${a.evidence.map((e) => html`<li><b>${e.kind === 'publisher_report' ? `${e.publisher} (publisher report)` : e.source}</b>${e.headline ? html` — “${e.headline}”` : ''}${e.published_at ? ` · published ${fmtDateTimeET(e.published_at)}` : ''}${e.captured_at ? ` · captured ${fmtDateTimeET(e.captured_at)}` : ''}${e.url ? html` · <a href="${e.url}" rel="noopener" target="_blank">source ↗</a>` : ''}</li>`)}
          </ol>
          <p class="note">Written by PropBetEdge’s deterministic newsroom generator (${a.generator?.version}) from the records above and checked by the publication gate: every number traces to a cited record; publisher reporting stays attributed to the publisher.</p>
        </div>
      </article>

      <aside class="grid" style="gap:16px;align-content:start">
        ${players.length ? html`<section class="card"><div class="card-head"><span class="card-title">Players</span></div><div class="card-body">
          ${players.slice(0, 6).map((p) => html`<a class="change-row" href="/players/${p.id}" style="grid-template-columns:auto minmax(0,1fr)">${avatar({ name: p.name, photo: p.id === a.context?.player?.athlete_id ? a.context.player.photo : null })}<b>${p.name}</b></a>`)}
        </div></section>` : ''}
        ${teams.length ? html`<section class="card"><div class="card-head"><span class="card-title">Teams</span></div><div class="card-body">
          ${teams.map((t) => html`<a class="change-row" href="/teams/${t.id}" style="grid-template-columns:auto minmax(0,1fr)">${teamLogo({ team_id: t.id, name: t.name }, 32)}<b>${t.name}</b></a>`)}
        </div></section>` : ''}
        ${games.length ? html`<section class="card"><div class="card-head"><span class="card-title">Games</span></div><div class="card-body">
          ${games.map((g) => html`<a class="change-row" href="/cast/${g.id}" style="grid-template-columns:minmax(0,1fr) auto"><b>${g.name}</b><span class="note">${fmtDateET(g.start_utc, { month: 'short', day: 'numeric' })} · WNBACast →</span></a>`)}
        </div></section>` : ''}
        ${related.length ? html`<section class="card"><div class="card-head"><span class="card-title">Related coverage</span></div><div class="card-body">${articleMini(related)}</div></section>` : ''}
      </aside>
    </div>
  `);
}
