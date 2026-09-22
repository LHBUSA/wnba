// In-article data storytelling for ordinary newsroom stories.
//
// These visuals render only from the article's FROZEN facts. They never fetch
// live data and never invent a value. The stored prose remains the canonical
// publication record; this layer turns dense factual paragraphs into readable,
// server-rendered charts and stat cards on the article page.

import { html } from '../lib/dom.js';
import { fmtDateET } from '../lib/format.js';

const num = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
const f1 = (v) => {
  const n = num(v);
  return n === null ? '—' : (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');
};
const avg = (xs) => {
  const vals = (xs || []).map(num).filter((v) => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
};
const signed = (v) => {
  const n = num(v);
  return n === null ? '—' : `${n > 0 ? '+' : ''}${f1(n)}`;
};
const pct = (v) => {
  const n = num(v);
  if (n === null) return '—';
  return `${f1(Math.abs(n) <= 1 ? n * 100 : n)}%`;
};
const safeDate = (v) => {
  try { return fmtDateET(v, { month: 'short', day: 'numeric' }); } catch { return ''; }
};
const maxOf = (xs, floor = 1) => Math.max(floor, ...(xs || []).map(num).filter((v) => v !== null));

function metricCard(value, label, note = '') {
  return html`<div class="aa-metric"><b>${value}</b><span>${label}</span>${note ? html`<small>${note}</small>` : ''}</div>`;
}

function trendOutcomeStrip(a) {
  const rows = [...(a?.facts?.rows || [])].reverse();
  if (!rows.length) return '';
  const total = a.market_type === 'total';
  return html`<div class="aa-outcome-strip" aria-label="${total ? 'Over under results' : 'Against the spread results'}">
    ${rows.map((r) => {
      const result = total ? r.ou : r.ats;
      const cls = result === 'U' || result === 'W' ? 'is-hit' : result === 'O' || result === 'L' ? 'is-miss' : 'is-push';
      return html`<span class="${cls}" title="${safeDate(r.date)} ${r.home ? 'vs' : 'at'} ${r.opp}">${result}</span>`;
    })}
  </div>`;
}

function trendTotalChart(a) {
  const rows = [...(a?.facts?.rows || [])].reverse();
  if (!rows.length) return '';
  const max = Math.ceil(maxOf(rows.flatMap((r) => [r.total, r.total_line]), 200) / 10) * 10;
  return html`<div class="aa-chart aa-total-chart">
    <div class="aa-chart-head"><b>Game totals vs closing line</b><span>Actual points · line marker</span></div>
    <div class="aa-total-rows">
      ${rows.map((r) => {
        const actual = num(r.total);
        const line = num(r.total_line);
        const w = actual === null ? 0 : Math.max(0, Math.min(100, actual / max * 100));
        const m = line === null ? 0 : Math.max(0, Math.min(100, line / max * 100));
        const result = r.ou === 'U' ? 'Under' : r.ou === 'O' ? 'Over' : 'Push';
        return html`<div class="aa-total-row">
          <div class="aa-game-label"><b>${safeDate(r.date)}</b><span>${r.home ? 'vs' : 'at'} ${r.opp}</span></div>
          <div class="aa-track" style="--aa-fill:${w.toFixed(1)}%;--aa-marker:${m.toFixed(1)}%">
            <span class="aa-fill"></span><i class="aa-marker"></i>
          </div>
          <div class="aa-game-value"><b>${actual ?? '—'}</b><span>${line ?? '—'}</span></div>
          <span class="aa-result aa-result--${r.ou === 'U' ? 'hit' : r.ou === 'O' ? 'miss' : 'push'}">${result}</span>
        </div>`;
      })}
    </div>
    <div class="aa-axis"><span>0</span><span>${Math.round(max / 2)}</span><span>${max}</span></div>
  </div>`;
}


function trendDriverPanel(a) {
  const f = a?.facts || {};
  const d = f.derived || {};
  const st = f.standing || null;
  if (a.market_type !== 'total' || !st) return '';

  const teamNow = num(d.avg_pts);
  const oppNow = num(d.avg_opp_pts);
  const teamSeason = num(st.points_for_avg);
  const oppSeason = num(st.points_against_avg);
  if ([teamNow, oppNow, teamSeason, oppSeason].some((v) => v === null)) return '';

  const teamDelta = teamNow - teamSeason;
  const oppDelta = oppNow - oppSeason;
  const teamIsDriver = Math.abs(teamDelta) >= Math.abs(oppDelta);
  const driverLabel = teamIsDriver ? 'Team scoring' : 'Opponent scoring';
  const driverDelta = teamIsDriver ? teamDelta : oppDelta;
  const driverCopy = teamIsDriver
    ? `${f1(Math.abs(teamDelta))} points ${teamDelta < 0 ? 'below' : 'above'} the team’s season scoring average`
    : `${f1(Math.abs(oppDelta))} points ${oppDelta < 0 ? 'below' : 'above'} the team’s season defensive average`;

  const maxDelta = Math.max(1, Math.abs(teamDelta), Math.abs(oppDelta));
  const row = (label, now, season, delta) => {
    const w = Math.max(8, Math.abs(delta) / maxDelta * 100);
    return html`<div class="aa-driver-row">
      <div><b>${label}</b><span>${f1(now)} during run · ${f1(season)} season</span></div>
      <div class="aa-driver-track"><i></i><span class="${delta >= 0 ? 'is-up' : 'is-down'}" style="--aa-driver:${w.toFixed(1)}%"></span></div>
      <strong class="${delta >= 0 ? 'is-up' : 'is-down'}">${signed(delta)}</strong>
    </div>`;
  };

  return html`<div class="aa-driver">
    <div class="aa-driver-callout">
      <span class="aa-driver-icon">↳</span>
      <div><small>Biggest driver</small><b>${driverLabel}</b><p>${driverCopy}</p></div>
    </div>
    <div class="aa-driver-rows">
      ${row('Team scoring', teamNow, teamSeason, teamDelta)}
      ${row('Opponent scoring', oppNow, oppSeason, oppDelta)}
    </div>
  </div>`;
}

function trendNextLine(a) {
  const f = a?.facts || {};
  const next = f.next || null;
  const market = next?.market || null;
  if (!next || !market) return '';
  const opponent = next.opponent || 'next opponent';
  const start = next.start_utc ? safeDate(next.start_utc) : '';
  const total = num(market.total);
  const spread = num(market.spread);
  const books = num(market.books);

  return html`<a class="aa-next-line" href="${a?.context?.next_game?.game_id ? `/matchups/${a.context.next_game.game_id}` : '/matchups'}">
    <div>
      <span class="aa-kicker">Next market</span>
      <b>${opponent}${start ? ` · ${start}` : ''}</b>
      <small>${books !== null ? `${books} books · ` : ''}stored PropBetEdge snapshot</small>
    </div>
    <div class="aa-next-prices">
      ${spread !== null ? html`<span><small>Spread</small><b>${signed(spread)}</b></span>` : ''}
      ${total !== null ? html`<span><small>Total</small><b>${f1(total)}</b></span>` : ''}
      <em>View matchup →</em>
    </div>
  </a>`;
}

function trendSpreadChart(a) {
  const rows = [...(a?.facts?.rows || [])].reverse();
  if (!rows.length) return '';
  const edges = rows.map((r) => num(r.margin) !== null && num(r.spread) !== null ? Number(r.margin) + Number(r.spread) : 0);
  const maxAbs = Math.max(10, Math.ceil(maxOf(edges.map(Math.abs), 10) / 5) * 5);
  return html`<div class="aa-chart aa-spread-chart">
    <div class="aa-chart-head"><b>Result vs spread</b><span>Right of zero = beat the line</span></div>
    <div class="aa-spread-rows">
      ${rows.map((r, i) => {
        const edge = edges[i];
        const mag = Math.min(50, Math.abs(edge) / maxAbs * 50);
        return html`<div class="aa-spread-row">
          <div class="aa-game-label"><b>${safeDate(r.date)}</b><span>${r.home ? 'vs' : 'at'} ${r.opp}</span></div>
          <div class="aa-diverge"><i></i><span class="${edge >= 0 ? 'is-pos' : 'is-neg'}" style="--aa-mag:${mag.toFixed(1)}%"></span></div>
          <div class="aa-edge"><b>${signed(edge)}</b><span>${r.ats === 'W' ? 'Cover' : r.ats === 'L' ? 'Miss' : 'Push'}</span></div>
        </div>`;
      })}
    </div>
    <div class="aa-diverge-axis"><span>-${maxAbs}</span><span>0</span><span>+${maxAbs}</span></div>
  </div>`;
}

function trendAnalytics(a) {
  const f = a?.facts || {};
  const rows = f.rows || [];
  if (rows.length < 2) return '';
  const total = a.market_type === 'total';
  const d = f.derived || {};
  const st = f.standing || null;
  const direction = total ? ((f.un || 0) >= (f.ov || 0) ? 'Under' : 'Over') : ((f.atsW || 0) >= (f.atsL || 0) ? 'Cover' : 'Miss');
  const hit = total ? Math.max(f.un || 0, f.ov || 0) : Math.max(f.atsW || 0, f.atsL || 0);
  const n = f.n || rows.length;

  return html`<section class="article-analytics article-analytics--trend" aria-label="Trend dashboard">
    <div class="aa-head">
      <div><span class="aa-kicker">PropBetEdge data view</span><h3>${total ? 'The total trend, visualized' : 'The ATS run, visualized'}</h3></div>
      <span class="aa-sample">${n}-game sample</span>
    </div>
    <div class="aa-metrics">
      ${metricCard(`${hit} of ${n}`, total ? `went ${direction.toLowerCase()}` : `${direction.toLowerCase()}ed the spread`, total ? `${f.ov || 0} over · ${f.un || 0} under` : `${f.atsW || 0}-${f.atsL || 0} ATS`)}
      ${total
        ? metricCard(f1(d.avg_total ?? avg(rows.map((r) => r.total))), 'avg combined points', `vs ${f1(d.avg_line ?? avg(rows.map((r) => r.total_line)))} avg total`)
        : metricCard(signed(d.avg_margin ?? avg(rows.map((r) => r.margin))), 'avg game margin', `vs ${signed(d.avg_spread ?? avg(rows.map((r) => r.spread)))} avg spread`)}
      ${total
        ? metricCard(f1(d.avg_pts ?? avg(rows.map((r) => r.pts))), 'team scoring', st && num(st.points_for_avg) !== null ? `${signed((d.avg_pts ?? avg(rows.map((r) => r.pts))) - Number(st.points_for_avg))} vs season` : 'during the run')
        : metricCard(signed(d.edge), 'avg edge vs line', 'result margin + spread')}
      ${total
        ? metricCard(f1(d.avg_opp_pts ?? avg(rows.map((r) => r.opp_pts))), 'opponent scoring', st && num(st.points_against_avg) !== null ? `${signed((d.avg_opp_pts ?? avg(rows.map((r) => r.opp_pts))) - Number(st.points_against_avg))} vs season` : 'during the run')
        : metricCard(String(d.big_cover ?? 0), 'double-digit line results', '10+ points beyond the spread')}
    </div>
    ${trendOutcomeStrip(a)}
    ${total ? trendDriverPanel(a) : ''}
    ${total ? trendTotalChart(a) : trendSpreadChart(a)}
    ${trendNextLine(a)}
  </section>`;
}

function injuryAnalytics(a) {
  const f = a?.facts || {};
  const rot = (f.rotation || []).filter((r) => r && r.name && num(r.min) !== null);
  if (!rot.length) return '';
  const subject = a?.context?.player?.name || a?.primary_subject || '';
  const candidates = rot.filter((r) => String(r.name) !== String(subject)).sort((x, y) => Number(y.min) - Number(x.min)).slice(0, 6);
  if (!candidates.length) return '';
  const maxMin = maxOf(candidates.map((r) => r.min), 1);
  const ownMin = num(f.rotation_me?.min ?? f.season_log?.min);
  return html`<section class="article-analytics article-analytics--injury" aria-label="Rotation impact">
    <div class="aa-head">
      <div><span class="aa-kicker">Rotation impact</span><h3>Where the minutes can go</h3></div>
      ${ownMin !== null ? html`<span class="aa-sample">${f1(ownMin)} min role</span>` : ''}
    </div>
    <div class="aa-rotation-list">
      ${candidates.map((r) => {
        const width = Math.max(7, Number(r.min) / maxMin * 100);
        return html`<div class="aa-rotation-row">
          <div><b>${r.name}</b><span>${Number(r.starts || 0)} starts · ${Number(r.appearances || 0)} appearances</span></div>
          <div class="aa-min-track"><span style="width:${width.toFixed(1)}%"></span></div>
          <strong>${f1(r.min)} <small>MIN</small></strong>
        </div>`;
      })}
    </div>
    <p class="aa-note">Recent rotation minutes from the same frozen box-score window used by this article. This chart shows existing workload, not a prediction of the exact redistribution.</p>
  </section>`;
}

function resultAnalytics(a) {
  const f = a?.facts || {};
  const g = a?.context?.game || {};
  const stars = (f.stars || []).filter((x) => x && x.name).slice(0, 3);
  const hs = num(g.home?.score);
  const as = num(g.away?.score);
  if (hs === null && as === null && !stars.length) return '';
  return html`<section class="article-analytics article-analytics--result" aria-label="Game dashboard">
    <div class="aa-head">
      <div><span class="aa-kicker">Game dashboard</span><h3>Final and top performers</h3></div>
      <span class="aa-sample">Final</span>
    </div>
    ${hs !== null && as !== null ? html`<div class="aa-scoreboard">
      <div><span>${g.away?.abbr || g.away?.short_name || 'Away'}</span><b>${as}</b></div>
      <i>FINAL</i>
      <div><span>${g.home?.abbr || g.home?.short_name || 'Home'}</span><b>${hs}</b></div>
    </div>` : ''}
    ${stars.length ? html`<div class="aa-star-grid">
      ${stars.map((p) => html`<div class="aa-star-card"><b>${p.name}</b><div>
        ${num(p.pts) !== null ? html`<span><strong>${p.pts}</strong><small>PTS</small></span>` : ''}
        ${num(p.reb) !== null ? html`<span><strong>${p.reb}</strong><small>REB</small></span>` : ''}
        ${num(p.ast) !== null ? html`<span><strong>${p.ast}</strong><small>AST</small></span>` : ''}
      </div></div>`)}
    </div>` : ''}
  </section>`;
}

function teamRecord(st) {
  return st && Number.isFinite(Number(st.wins)) && Number.isFinite(Number(st.losses)) ? `${st.wins}-${st.losses}` : '—';
}

function previewAnalytics(a) {
  const f = a?.facts || {};
  const away = f.away || {};
  const home = f.home || {};
  const g = a?.context?.game || {};
  const aName = g.away?.abbr || g.away?.short_name || 'Away';
  const hName = g.home?.abbr || g.home?.short_name || 'Home';
  const metrics = [
    ['Points/game', num(away.standing?.points_for_avg), num(home.standing?.points_for_avg), (v) => f1(v)],
    ['Opp points/game', num(away.standing?.points_against_avg), num(home.standing?.points_against_avg), (v) => f1(v)],
    ['Field goal %', num(away.season_stats?.fieldGoalPct), num(home.season_stats?.fieldGoalPct), (v) => pct(v)],
    ['Rebound diff', num(away.season_stats?.avgReboundsDifferential), num(home.season_stats?.avgReboundsDifferential), (v) => signed(v)]
  ].filter((x) => x[1] !== null && x[2] !== null);
  if (!metrics.length && !away.standing && !home.standing) return '';
  return html`<section class="article-analytics article-analytics--preview" aria-label="Matchup comparison">
    <div class="aa-head">
      <div><span class="aa-kicker">Matchup snapshot</span><h3>${aName} vs ${hName}</h3></div>
      <span class="aa-sample">${teamRecord(away.standing)} · ${teamRecord(home.standing)}</span>
    </div>
    <div class="aa-compare-head"><b>${aName}</b><span>Metric</span><b>${hName}</b></div>
    <div class="aa-compare">
      ${metrics.map(([label, av, hv, fmt]) => {
        const max = Math.max(Math.abs(av), Math.abs(hv), 1);
        return html`<div class="aa-compare-row">
          <div class="aa-compare-side aa-compare-side--away"><b>${fmt(av)}</b><span style="width:${Math.max(5, Math.abs(av) / max * 100).toFixed(1)}%"></span></div>
          <strong>${label}</strong>
          <div class="aa-compare-side aa-compare-side--home"><span style="width:${Math.max(5, Math.abs(hv) / max * 100).toFixed(1)}%"></span><b>${fmt(hv)}</b></div>
        </div>`;
      })}
    </div>
  </section>`;
}

export function articleAnalytics(article, { afterSection = 0 } = {}) {
  if (!article || afterSection !== 0) return '';
  if (article.kind === 'trend') return trendAnalytics(article);
  if (article.kind === 'injury') return injuryAnalytics(article);
  if (article.kind === 'result' || article.kind === 'performance') return resultAnalytics(article);
  if (article.kind === 'preview') return previewAnalytics(article);
  return '';
}

// Paragraphs represented better by a chart stay in the stored article for feeds,
// indexing and audit, but are not duplicated as a wall of text on the page.
export function suppressVisualizedParagraph(article, paragraph) {
  if (article?.kind !== 'trend') return false;
  const p = String(paragraph || '').trim();
  return /^Game by game:/i.test(p) || /^For the record, the same games (?:went|finished)/i.test(p);
}
