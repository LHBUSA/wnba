// Player intelligence view — shared by the SPA page and the wnba-web publishing Worker.
import { html, raw } from '../lib/dom.js';
import { sourceLine, errorState, statusBadge, badge, safeColor } from '../ui/components.js';
import { fmtDateET, relTime, num, initials, american, bookName } from '../lib/format.js';
import { sparkline } from '../ui/charts.js';
import { teamLogo } from '../ui/logo.js';
import { articleMini } from '../ui/articles.js';

const MARKET_LABEL = { player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists', player_threes: '3PM' };

export async function loadPlayer(api, id) {
  const [res, news, props, arts] = await Promise.all([api.player(id), api.news({ player: id, limit: 6, lane: 'external' }), api.props(), api.articles({ player: id, limit: 6 })]);
  return { id, res, news, props, arts };
}

export function playerView({ id, res, news, props, arts }) {
  if (!res?.ok) return errorState(res, 'This player');
  const d = res.data;
  const p = d.player;
  const photo = d.photo;
  const tc = safeColor(p.team?.color, 'var(--gold)');
  const season = d.gamelog?.seasons?.find((s) => /regular/i.test(s.name || '')) || d.gamelog?.seasons?.[0];
  const games = season?.games || [];
  const r = d.recent;
  const inj = d.availability?.[0];
  const myProps = (props?.ok ? props.data.games || [] : []).flatMap((g) => (g.props || []).filter((x) => x.athlete_id === id).map((x) => ({ ...x, game: g })));

  return html`
    <section class="p-hero">
      <div>
        <div class="p-photo" style="--tc:${tc}">
          ${photo?.portrait ? html`<img src="${photo.portrait}" alt="${p.name}" width="600" height="750" decoding="async" fetchpriority="high" />` : html`<div class="fallback" aria-hidden="true"><span>${initials(p.name)}</span></div>`}
          <span class="band"></span>
        </div>
        ${photo ? html`<p class="credit" style="margin-top:8px">${photo.attribution}${photo.capture_date ? ` · ${String(photo.capture_date).slice(0, 4)}` : ''} · <a href="${photo.source_page}" rel="noopener" target="_blank">source</a>${photo.license_url ? html` · <a href="${photo.license_url}" rel="noopener" target="_blank">license</a>` : ''}</p>` : html`<p class="credit" style="margin-top:8px">No verified, licensed photo yet — shown as a neutral card rather than risk the wrong person.</p>`}
      </div>
      <div style="display:flex;flex-direction:column;justify-content:flex-end;min-width:0">
        <span style="display:flex;gap:10px;align-items:center">${p.team ? teamLogo(p.team, 36) : ''}<span class="eyebrow">${p.team ? html`<a href="/teams/${p.team.team_id}">${p.team.name}</a>` : 'Free agent'}${p.jersey ? ` · #${p.jersey}` : ''}</span></span>
        <h1 class="p-name" style="margin-top:10px">${p.name}</h1>
        <div class="p-facts">
          ${p.position_name ? html`<span>Position <b>${p.position_name}</b></span>` : ''}
          ${p.height ? html`<span>Height <b>${p.height}</b></span>` : ''}
          ${p.age ? html`<span>Age <b>${p.age}</b></span>` : ''}
          ${p.college ? html`<span>College <b>${p.college}</b></span>` : ''}
          ${p.experience_years !== null && p.experience_years !== undefined ? html`<span>Experience <b>${p.experience_years} yr${p.experience_years === 1 ? '' : 's'}</b></span>` : ''}
        </div>
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          ${inj ? html`${statusBadge(inj.status)}<span class="note">${[inj.side, inj.body_part].filter(Boolean).join(' ')} · ESPN feed updated ${fmtDateET(inj.source_updated_at, { month: 'short', day: 'numeric' })} · <a href="/injuries">Injury Desk →</a></span>` : d.availability ? badge('final', 'Not on injury feed') : badge('stale', 'Availability unknown')}
        </div>
        ${inj?.short_comment ? html`<blockquote class="callout" style="margin:12px 0 0">${inj.short_comment}<div class="note" style="margin-top:6px">ESPN injury note${inj.source_return_date ? ` · ESPN lists an expected return of ${fmtDateET(inj.source_return_date + 'T16:00:00Z', { month: 'short', day: 'numeric' })} (source-reported, not a PropBetEdge estimate)` : ''}</div></blockquote>` : ''}
        <div class="tiles" style="margin-top:18px">
          ${[['Season', r?.season], ['Last 10', r?.last10], ['Last 5', r?.last5]].map(([lbl, w]) => html`<div class="tile"><small>${lbl}${w ? ` · ${w.games} g` : ''}</small><b>${w ? num(w.pts) : '—'}</b><span>${w ? `${num(w.reb)} reb · ${num(w.ast)} ast · ${num(w.min)} min` : 'no games'}</span></div>`)}
          <div class="tile"><small>Minutes trend</small><b style="height:30px">${raw(sparkline((r?.minutes_trend || []).map((x) => x.min), { width: 110, height: 30 }))}</b><span>last ${r?.minutes_trend?.length || 0} games</span></div>
        </div>
        <p class="note" style="margin-top:8px">${r?.method || ''}</p>
      </div>
    </section>

    <div class="section split">
      <section class="card">
        <div class="card-head"><span class="card-title">Game log · ${season?.name || ''}</span><span class="note">${games.length} games</span></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Opp</th><th>Result</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>FG</th><th>3PT</th><th>TO</th><th></th></tr></thead><tbody>
          ${games.slice(0, 25).map((g) => html`<tr><td>${fmtDateET(g.date, { month: 'short', day: 'numeric' })}</td><td class="l">${g.at_vs === '@' ? '@' : 'vs'} ${g.opponent?.team_id ? html`<a href="/teams/${g.opponent.team_id}">${g.opponent.abbr || ''}</a>` : g.opponent?.abbr || ''}</td><td class="l">${g.result || ''} ${g.score || ''}</td><td>${num(g.min, 0)}</td><td class="hi">${g.pts ?? '—'}</td><td>${g.reb ?? '—'}</td><td>${g.ast ?? '—'}</td><td>${g.fgm ?? '—'}-${g.fga ?? '—'}</td><td>${g.fg3m ?? '—'}-${g.fg3a ?? '—'}</td><td>${g.tov ?? '—'}</td><td><a class="gold" href="/cast/${g.game_id}">Replay</a></td></tr>`)}
        </tbody></table></div>
        ${!games.length ? html`<p class="note card-body">No games in the source game log this season.</p>` : ''}
      </section>

      <aside class="grid" style="gap:16px;align-content:start">
        <section class="card">
          <div class="card-head"><span class="card-title">Props</span><a class="sec-link" href="/props">Board →</a></div>
          <div class="card-body">
            ${myProps.length ? myProps.map((x) => html`<div class="change-row" style="grid-template-columns:minmax(0,1fr) auto"><div><b>${MARKET_LABEL[x.market] || x.market} ${x.point}</b><div class="note">O ${american(x.best.over?.price)} ${bookName(x.best.over?.book)} · U ${american(x.best.under?.price)} ${bookName(x.best.under?.book)}</div></div><span class="note">PBE: not published</span></div>`) : html`<p class="note">No props captured for this player in the latest snapshot.</p>`}
          </div>
        </section>
        <section class="card">
          <div class="card-head"><span class="card-title">PBE Newsroom</span><a class="sec-link" href="/news">All →</a></div>
          <div class="card-body">${arts?.ok && arts.data.items.length ? articleMini(arts.data.items) : html`<p class="note">No PropBetEdge article on ${p.name} in the current window.</p>`}</div>
          <div class="card-head" style="border-top:1px solid var(--line)"><span class="card-title">Source wire</span><span class="note">external</span></div>
          <div class="card-body">
            ${news?.ok && news.data.items.length ? news.data.items.map((i) => html`<article class="nitem"><div class="nmeta">${i.lane === 'pbe' ? badge('pbe', 'PBE Desk') : badge('ext', i.source.name)}<span>${relTime(i.published_at)}</span></div><h3 style="font-size:16px"><a href="${i.lane === 'pbe' ? `/news/story/${i.id}` : i.url}" ${i.lane === 'pbe' ? '' : raw('rel="noopener" target="_blank"')}>${i.headline}</a></h3></article>`) : html`<p class="note">No WNBA stories linked to ${p.name} in the last three weeks.</p>`}
          </div>
        </section>
        ${p.team ? html`<section class="card"><div class="card-head"><span class="card-title">Explore</span></div><div class="card-body">
          <p><a href="/teams/${p.team.team_id}">${p.team.name}: roster, schedule and matchups →</a></p>
          <p><a href="/injuries">WNBA Injury Desk →</a></p>
          <p><a href="/players">All WNBA players →</a></p>
        </div></section>` : ''}
      </aside>
    </div>
    <div style="margin-top:16px">${sourceLine(res.meta, { label: photo ? `Photo identity: ${photo.identity}, verified ${fmtDateET(photo.verified_at, { month: 'short', day: 'numeric' })}` : 'No verified photo' })}</div>
  `;
}
