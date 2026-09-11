import { html, render, raw } from '../lib/dom.js';
import { api } from '../data/api.js';
import { pageHead, sourceLine, empty, errorState, skeleton, avatar } from '../ui/components.js';
import { currentState } from '../data/freshness.js';
import { teamLogo } from '../ui/logo.js';
import { american, bookName, fmtDateTimeET, fmtTimeET, fmtDateET, pct, plural } from '../lib/format.js';
import { sparkline } from '../ui/charts.js';

export const title = () => 'Props & best line';
export const description = () => 'WNBA best-line board: sportsbook prices, no-vig market consensus, and PropBetEdge model status — always kept separate.';

const MARKET_LABEL = { player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists', player_threes: '3-pointers made' };
const SUB = 'The best price a sportsbook offers and the market’s no-vig consensus, kept separate — and never blended into a PropBetEdge projection.';

/** Handicap/total lines print as published: no forced decimals, explicit sign on spreads. */
const sline = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : `${Number(v) > 0 ? '+' : ''}${Number(v)}`);

/** How many distinct sportsbooks appear anywhere in this snapshot. */
function snapshotBooks(events) {
  const s = new Set();
  for (const e of events) for (const m of ['moneyline', 'spread', 'total']) for (const b of e?.[m]?.books || []) s.add(b.book);
  return s.size;
}

/** One market row: side token, the number that matters, an optional price, the book. */
const mrow = (side, main, sub, book) => html`<div class="mr">
  <span class="mr-side">${side}</span>
  <span class="mr-main">${main}</span>
  ${sub ? html`<span class="mr-sub">${sub}</span>` : ''}
  <span class="mr-book">${book || ''}</span>
</div>`;

/** Spread movement lives inside the spread cell — never its own column. */
function spreadMove(hist) {
  const pts = hist.map((h) => h.spread).filter((v) => Number.isFinite(v));
  if (pts.length < 2) return pts.length === 1 ? html`<span class="mc-move">1 capture</span>` : '';
  const moved = pts.some((v) => v !== pts[0]);
  return html`<span class="mc-move">${moved ? raw(sparkline(pts, { width: 58, height: 14 })) : 'unchanged · '}${plural(pts.length, 'capture')}</span>`;
}

export async function mount(root, ctx) {
  render(root, html`${pageHead({ eyebrow: 'Props · Best line', title: 'Best line board', sub: SUB })}${skeleton(44)}${skeleton(260)}`);
  const [odds, props, teams] = await Promise.all([api.odds(), api.props(), api.teams()]);
  if (!ctx.isCurrent()) return;
  const tIdx = new Map((teams.ok ? teams.data.teams : []).map((t) => [t.team_id, t]));
  const events = (odds.ok ? odds.data.events || [] : []).slice().sort((a, b) => a.commence_time.localeCompare(b.commence_time));
  const histories = {};
  await Promise.all(events.slice(0, 12).map(async (e) => { const r = await api.odds(e.odds_event_id); if (r.ok) histories[e.odds_event_id] = r.data.history || []; }));
  if (!ctx.isCurrent()) return;

  // ---------------------------------------------------------------- rails

  const readRail = html`<div class="read-rail" aria-label="How to read this board">
    <span class="rk rk-best" tabindex="0"><b>Best price</b><span>sportsbook offer</span><span class="rk-tip">The best number any book in this snapshot posts for that side, with the book named.</span></span>
    <span class="rk rk-cons" tabindex="0"><b>Consensus</b><span>no-vig market benchmark</span><span class="rk-tip">Median no-vig probability across books (two or more). A market benchmark computed from prices — not a model.</span></span>
    <span class="rk rk-pbe" tabindex="0"><b>PBE</b><span>not published</span><span class="rk-tip">No validated PropBetEdge WNBA model exists yet. Fair value and model gap are unavailable by design, never inferred from prices.</span></span>
  </div>`;

  // The status comes from the API's own model block, so the page cannot claim more than the service does.
  const model = (odds.ok && odds.data.pbe_model) || (props.ok && props.data.pbe_model) || null;
  const pbeStatus = !model || model.status === 'NOT_PUBLISHED'
    ? html`<div class="pbe-status"><span class="ps-tag">PBE fair value · Not published</span><p>No validated PropBetEdge WNBA model is live yet. Market consensus is shown separately and is never presented as a PBE projection.</p></div>`
    : '';

  const snapRail = (meta, capturedAt, extra = '') => html`<div class="snap-rail">
    <span class="sr-state" data-state="${currentState(meta)}">Current snapshot</span>
    <span>Captured ${fmtDateTimeET(capturedAt)}</span>
    ${extra}
    <span class="sr-quiet">Scheduled ingest · not live odds</span>
  </div>`;

  // ---------------------------------------------------------------- game lines

  const lineRow = (e) => {
    const home = tIdx.get(e.home_team_id) || { abbr: e.home_team, name: e.home_team };
    const away = tIdx.get(e.away_team_id) || { abbr: e.away_team, name: e.away_team };
    const ml = e.moneyline;
    const sp = e.spread;
    const tot = e.total;
    const hist = histories[e.odds_event_id] || [];
    const spLine = sp.consensus_line;

    return html`<tr>
      <td class="mu">
        <div class="mu-teams">
          <span class="mu-t">${teamLogo(away, 22)}<b>${away.abbr}</b></span>
          <span class="mu-at">@</span>
          <span class="mu-t">${teamLogo(home, 22)}<b>${home.abbr}</b></span>
        </div>
        <div class="mu-when">${fmtDateET(e.commence_time)} · ${fmtTimeET(e.commence_time)}</div>
        ${e.game_id ? html`<a class="mu-go" href="/matchups/${e.game_id}">Matchup</a>` : ''}
      </td>

      <td class="mc">
        <span class="mc-label">Moneyline</span>
        ${mrow(away.abbr, american(ml.best.away?.price), '', bookName(ml.best.away?.book))}
        ${mrow(home.abbr, american(ml.best.home?.price), '', bookName(ml.best.home?.book))}
        <div class="mc-third cons"><i>Consensus</i>${ml.consensus
          ? html` ${home.abbr} ${pct(ml.consensus.home_prob)} · fair ${american(ml.consensus.home_fair_american)}`
          : html` <span class="na">needs 2+ books</span>`}</div>
      </td>

      <td class="mc">
        <span class="mc-label">Spread</span>
        ${spLine === null || spLine === undefined
          ? html`<div class="mr"><span class="mr-main na">—</span></div>`
          : html`${mrow(away.abbr, sline(-spLine), american(sp.best.away?.price), bookName(sp.best.away?.book))}
                 ${mrow(home.abbr, sline(spLine), american(sp.best.home?.price), bookName(sp.best.home?.book))}`}
        <div class="mc-third"><i>Market line</i> ${sline(spLine)}${spreadMove(hist)}</div>
      </td>

      <td class="mc">
        <span class="mc-label">Total</span>
        <div class="mc-primary">${tot.consensus_line ?? '—'}</div>
        ${mrow('O', american(tot.best.over?.price), '', bookName(tot.best.over?.book))}
        ${mrow('U', american(tot.best.under?.price), '', bookName(tot.best.under?.book))}
        <div class="mc-third">${tot.consensus ? html`${plural(tot.consensus.books, 'book')} at ${tot.consensus_line}` : html`<i>Market line</i> ${tot.consensus_line ?? '—'}`}</div>
      </td>
    </tr>`;
  };

  // ---------------------------------------------------------------- player props

  const propGames = props.ok ? props.data.games || [] : [];
  const propRows = propGames.flatMap((g) => (g.props || []).map((p) => ({ ...p, game: g })));

  const propRow = (p) => html`<tr>
    <td class="pp-who">
      ${avatar({ name: p.player, photo: p.photo }, { size: 'sm' })}
      <span class="pp-id">
        ${p.athlete_id ? html`<a class="pp-name" href="/players/${p.athlete_id}">${p.player}</a>` : html`<span class="pp-name">${p.player}</span>`}
        <small>${MARKET_LABEL[p.market] || p.market}${p.athlete_id ? '' : html` · <span class="badge stale">name unmatched</span>`}</small>
      </span>
    </td>
    <td class="pp-line"><span class="mc-label">Line</span>${p.point ?? '—'}</td>
    <td class="mc">
      <span class="mc-label">Best over</span>
      ${mrow('', american(p.best.over?.price), '', bookName(p.best.over?.book))}
    </td>
    <td class="mc">
      <span class="mc-label">Best under</span>
      ${mrow('', american(p.best.under?.price), '', bookName(p.best.under?.book))}
    </td>
    <td class="mc">
      <span class="mc-label">Consensus</span>
      <div class="mc-third cons">${p.consensus
        ? html`<i>Over</i> ${pct(p.consensus.over_prob)} · fair ${american(p.consensus.over_fair_american)}`
        : html`<span class="na" title="${p.consensus_note || ''}">1 book — no consensus</span>`}</div>
    </td>
  </tr>`;

  // ---------------------------------------------------------------- render

  render(root, html`
    ${pageHead({ eyebrow: 'Props · Best line', title: 'Best line board', sub: SUB })}
    ${readRail}
    ${pbeStatus}

    <section class="section">
      <div class="sec-head"><h2 class="sec-title">Game lines</h2>${odds.ok && odds.data.schedule ? html`<span class="note">Ingest ${odds.data.schedule}</span>` : ''}</div>
      ${!odds.ok ? errorState(odds, 'The market snapshot') : !events.length ? empty('No market snapshot yet', 'Sportsbook prices are captured three times a day (8:00, 1:00 and 6:00 ET). Nothing is shown until a real capture exists.') : html`
        ${snapRail(odds.meta, odds.data.captured_at, html`<span>${plural(snapshotBooks(events), 'book')}</span>`)}
        <div class="board-shell">
          <table class="board">
            <colgroup><col class="c-mu" /><col /><col /><col /></colgroup>
            <thead><tr><th class="mu">Matchup</th><th>Moneyline</th><th>Spread</th><th>Total</th></tr></thead>
            <tbody>${events.map(lineRow)}</tbody>
          </table>
          <div class="board-foot">${sourceLine(odds.meta, { label: 'Last verified market — not live odds' })}<p class="note">Snapshots come from a scheduled Cloudflare ingest. Visiting this page never triggers a new price request. Prices can move after the capture time shown.</p></div>
        </div>`}
    </section>

    <section class="section">
      <div class="sec-head"><h2 class="sec-title">Player props</h2><span class="pbe-pill">PBE · Not published</span></div>
      ${!props.ok ? errorState(props, 'The props snapshot') : !propRows.length ? empty('No player props captured yet', 'Player props are captured for games tipping within 36 hours, at the same 8:00 / 1:00 / 6:00 ET ingest. The next slate is outside that window right now, so there is nothing real to show — no placeholder lines.') : html`
        ${snapRail(props.meta, props.data.captured_at)}
        <div class="board-shell">
          <table class="board pboard">
            <colgroup><col class="c-who" /><col class="c-line" /><col /><col /><col /></colgroup>
            <thead><tr><th class="mu">Player · market</th><th>Line</th><th>Best over</th><th>Best under</th><th>Consensus</th></tr></thead>
            <tbody>${propRows.map(propRow)}</tbody>
          </table>
          <div class="board-foot">${sourceLine(props.meta)}<p class="note">Players are joined to rosters by exact name only; an unmatched name is shown as published and never guessed.</p></div>
        </div>`}
    </section>
  `);
}
