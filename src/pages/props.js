import { html, render, raw } from '../lib/dom.js';
import { api } from '../data/api.js';
import { pageHead, sourceLine, empty, errorState, skeleton, avatar, badge, teamDot } from '../ui/components.js';
import { american, bookName, fmtDateTimeET, fmtTimeET, fmtDateET, pct, relTime } from '../lib/format.js';
import { sparkline } from '../ui/charts.js';

export const title = () => 'Props & best line';
export const description = () => 'WNBA best-line board: sportsbook prices, no-vig market consensus, and PropBetEdge model status — always kept separate.';

const MARKET_LABEL = { player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists', player_threes: '3-pointers made' };

export async function mount(root, ctx) {
  render(root, html`${pageHead({ eyebrow: 'Props · Best line', title: 'Best line board', sub: 'Four layers, never blended: the best price a sportsbook offers, the market’s no-vig consensus, PropBetEdge fair value, and the PropBetEdge model gap.' })}${skeleton(80)}${skeleton(300)}`);
  const [odds, props, teams] = await Promise.all([api.odds(), api.props(), api.teams()]);
  if (!ctx.isCurrent()) return;
  const tIdx = new Map((teams.ok ? teams.data.teams : []).map((t) => [t.team_id, t]));
  const events = odds.ok ? odds.data.events || [] : [];
  const histories = {};
  await Promise.all(events.slice(0, 12).map(async (e) => { const r = await api.odds(e.odds_event_id); if (r.ok) histories[e.odds_event_id] = r.data.history || []; }));
  if (!ctx.isCurrent()) return;

  const layerKey = html`<div class="layer-key">
    <div class="k1"><b>1 · Sportsbook price</b>Best available price across the books in the snapshot, with the book named.</div>
    <div class="k2"><b>2 · Market consensus</b>Median no-vig probability across books (≥2). A market benchmark, not a model.</div>
    <div class="k3"><b>3 · PBE fair value</b>Not published — no validated PropBetEdge WNBA model exists yet.</div>
    <div class="k4"><b>4 · PBE model gap</b>Unavailable until (3) exists. Never inferred from prices.</div>
  </div>`;

  const lineRow = (e) => {
    const home = tIdx.get(e.home_team_id) || { abbr: e.home_team, name: e.home_team };
    const away = tIdx.get(e.away_team_id) || { abbr: e.away_team, name: e.away_team };
    const ml = e.moneyline;
    const sp = e.spread;
    const tot = e.total;
    const hist = histories[e.odds_event_id] || [];
    return html`<tr>
      <td class="l"><div class="pname">${teamDot(away)}${away.abbr} @ ${teamDot(home)}${home.abbr}</div><div class="note">${fmtDateET(e.commence_time, { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtTimeET(e.commence_time)}${e.game_id ? html` · <a href="/matchups/${e.game_id}" class="gold">matchup</a>` : ''}</div></td>
      <td><div class="market-cell"><span>${away.abbr} ${american(ml.best.away?.price)} · ${home.abbr} ${american(ml.best.home?.price)}</span><small>${bookName(ml.best.away?.book)} / ${bookName(ml.best.home?.book)}</small></div></td>
      <td><div class="market-cell cons"><span>${ml.consensus ? `${home.abbr} ${pct(ml.consensus.home_prob)} · fair ${american(ml.consensus.home_fair_american)}` : '—'}</span><small>${ml.consensus ? `${ml.consensus.books} books · hold ${pct(ml.consensus.median_hold)}` : 'needs ≥2 books'}</small></div></td>
      <td><div class="market-cell"><span>${sp.consensus_line !== null ? `${home.abbr} ${sp.consensus_line > 0 ? '+' : ''}${sp.consensus_line}` : '—'}</span><small>${sp.best.home ? `${american(sp.best.home.price)} ${bookName(sp.best.home.book)}` : ''}${sp.best.away ? ` · ${away.abbr} ${american(sp.best.away.price)} ${bookName(sp.best.away.book)}` : ''}</small></div></td>
      <td><div class="market-cell"><span>${tot.consensus_line ?? '—'}</span><small>${tot.best.over ? `O ${american(tot.best.over.price)} ${bookName(tot.best.over.book)}` : ''}${tot.best.under ? ` · U ${american(tot.best.under.price)} ${bookName(tot.best.under.book)}` : ''}</small></div></td>
      <td><span class="na">Not published</span></td>
      <td>${hist.length >= 2 ? raw(sparkline(hist.map((h) => h.spread), { width: 90, height: 26 })) : html`<span class="note">${hist.length} capture${hist.length === 1 ? '' : 's'}</span>`}</td>
    </tr>`;
  };

  const propGames = props.ok ? props.data.games || [] : [];
  const propRows = propGames.flatMap((g) => (g.props || []).map((p) => ({ ...p, game: g })));

  render(root, html`
    ${pageHead({ eyebrow: 'Props · Best line', title: 'Best line board', sub: 'Four layers, never blended: the best price a sportsbook offers, the market’s no-vig consensus, PropBetEdge fair value, and the PropBetEdge model gap.' })}
    ${layerKey}
    <section class="section">
      <div class="sec-head"><h2 class="sec-title">Game lines</h2>${odds.ok && odds.data.captured_at ? html`<span class="note">Snapshot ${fmtDateTimeET(odds.data.captured_at)} · captured ${odds.data.schedule}</span>` : ''}</div>
      ${!odds.ok ? errorState(odds, 'The market snapshot') : !events.length ? empty('No market snapshot yet', 'Sportsbook prices are captured three times a day (8:00, 1:00 and 6:00 ET). Nothing is shown until a real capture exists.') : html`
        <div class="card"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Game</th><th>1 · Best moneyline</th><th>2 · Consensus (no-vig)</th><th>Spread · best price</th><th>Total · best price</th><th>3/4 · PBE</th><th>Spread moves</th></tr></thead>
          <tbody>${events.sort((a, b) => a.commence_time.localeCompare(b.commence_time)).map(lineRow)}</tbody>
        </table></div>
        <div class="card-body">${sourceLine(odds.meta, { label: 'Last verified market — not live odds' })}<p class="note" style="margin-top:6px">Snapshots come from a scheduled Cloudflare ingest. Visiting this page never triggers a new price request. Prices can move after the capture time shown.</p></div></div>`}
    </section>

    <section class="section">
      <div class="sec-head"><h2 class="sec-title">Player props</h2>${props.ok && props.data.captured_at ? html`<span class="note">Captured ${fmtDateTimeET(props.data.captured_at)}</span>` : ''}</div>
      ${!props.ok ? errorState(props, 'The props snapshot') : !propRows.length ? empty('No player props captured yet', 'Player props are captured for games tipping within 36 hours, at the same 8:00 / 1:00 / 6:00 ET ingest. The next slate is outside that window right now, so there is nothing real to show — no placeholder lines.') : html`
        <div class="card"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Player</th><th>Market</th><th>Line</th><th>1 · Best over</th><th>1 · Best under</th><th>2 · Consensus over</th><th>3/4 · PBE</th></tr></thead>
          <tbody>${propRows.map((p) => html`<tr>
            <td class="l"><div class="pname">${avatar({ name: p.player, photo: p.photo }, { size: 'sm' })}${p.athlete_id ? html`<a href="/players/${p.athlete_id}">${p.player}</a>` : html`<span>${p.player}</span> <span class="badge stale">name unmatched</span>`}</div></td>
            <td class="l">${MARKET_LABEL[p.market] || p.market}</td>
            <td>${p.point ?? '—'}</td>
            <td><div class="market-cell"><span>${american(p.best.over?.price)}</span><small>${bookName(p.best.over?.book)}</small></div></td>
            <td><div class="market-cell"><span>${american(p.best.under?.price)}</span><small>${bookName(p.best.under?.book)}</small></div></td>
            <td class="cons">${p.consensus ? `${pct(p.consensus.over_prob)} · ${american(p.consensus.over_fair_american)}` : html`<span class="na" title="${p.consensus_note || ''}">1 book</span>`}</td>
            <td><span class="na">Not published</span></td>
          </tr>`)}</tbody>
        </table></div><div class="card-body">${sourceLine(props.meta)}<p class="note" style="margin-top:6px">Players are joined to rosters by exact name only; an unmatched name is shown as published and never guessed.</p></div></div>`}
    </section>
  `);
}
