import { html, raw } from '../lib/dom.js';
import { allAccessCardHtml } from '../lib/pbe-membership.js';
import { membershipFrom } from '../lib/membership.js';
import { american, bookName, fmtDateTimeET, pct } from '../lib/format.js';

const MARKET_LABEL = {
  player_points: 'Points',
  player_rebounds: 'Rebounds',
  player_assists: 'Assists',
  player_threes: '3PM'
};

export function propEdgeSection({ account, edge }) {
  const pro = Boolean(account?.ok && account.data?.state === 'pro');
  if (!pro) return publicTeaser(account?.ok && account.data?.state === 'free', membershipFrom(account));
  if (!edge?.ok) return warming(edge?.error?.message);

  const d = edge.data || {};
  const rows = d.rows || [];
  const calls = rows.filter((r) => r.call && r.call !== 'PASS');
  const watch = rows.filter((r) => r.call === 'PASS' && r.projection).slice(0, 8);
  const maxEdge = calls.slice().sort((a, b) => Math.abs(b.pbe_edge_pts || 0) - Math.abs(a.pbe_edge_pts || 0))[0] || null;

  return html`<section class="prop-edge" id="pbe-prop-edge">
    <header class="prop-edge-hero">
      <div>
        <span class="eyebrow">WNBA Pro · Player prop intelligence</span>
        <h2>PBE <span>Prop Edge</span></h2>
        <p>Independent player projections first. Sportsbook prices second. Then PBE shows where its projection disagrees with the de-vigged market — with recent production, minutes, Player Load context and the actual reasons beside every call.</p>
      </div>
      <aside>
        <span>TRACKING BETA</span>
        <b>${calls.length}</b>
        <small>current model calls</small>
        <em>${maxEdge ? `Largest gap ${signed(maxEdge.pbe_edge_pts)} pts` : `${rows.length} props evaluated`}</em>
      </aside>
    </header>

    <div class="prop-edge-truth">
      <strong>Model discipline:</strong>
      <span>${d.model?.projection_inputs || 'Projection inputs are separated from sportsbook prices.'}</span>
      <span class="prop-edge-beta">Tracking beta · not part of the official locked PBE record yet</span>
    </div>

    ${calls.length ? html`
      <div class="prop-edge-head"><div><span class="eyebrow">Current calls</span><h3>Where PBE disagrees most</h3></div><small>Market captured ${fmtDateTimeET(d.source_captured_at)}</small></div>
      <div class="prop-edge-grid">${calls.slice(0, 12).map(propEdgeCard)}</div>
    ` : html`
      <div class="prop-edge-empty"><span class="eyebrow">Current calls</span><h3>No tracking call clears the current threshold.</h3><p>That is a real model outcome, not missing content. PBE still evaluates the board below and preserves the market/projection separation.</p></div>
    `}

    ${watch.length ? html`
      <div class="prop-edge-head compact"><div><span class="eyebrow">Model watch</span><h3>Closest passes</h3></div><small>Useful context without forcing a pick</small></div>
      <div class="prop-edge-watch">${watch.map(propWatchRow)}</div>
    ` : ''}

    <footer class="prop-edge-foot">
      <div><b>${d.summary?.evaluated ?? rows.length}</b><span>props evaluated</span></div>
      <div><b>${d.coverage?.archive_games ?? '—'}</b><span>archived games scanned</span></div>
      <div><b>${d.coverage?.player_load ? 'ON' : '—'}</b><span>Player Load context</span></div>
      <p>PBE Prop Edge V1 is being tracked before promotion into an official locked prop record. The public sportsbook board remains separate and visible above.</p>
    </footer>
  </section>`;
}

function publicTeaser(signedIn, membership) {
  return html`<section class="prop-edge prop-edge-locked" id="pbe-prop-edge">
    <div class="prop-edge-lock-copy">
      <span class="eyebrow">WNBA Pro · PBE Prop Edge</span>
      <h2>The line tells you the market. <span>PBE tells you what it thinks.</span></h2>
      <p>Upgrade the public player-prop board with independent projections, Over/Under probabilities, model-vs-market disagreement, recent production, minutes context, Player Load and transparent supporting/risk factors.</p>
      <div class="prop-edge-lock-grid">
        <div><b>Projection first</b><span>Sportsbook prices never create the player projection.</span></div>
        <div><b>Four markets</b><span>Points · Rebounds · Assists · 3PM</span></div>
        <div><b>Why + risk</b><span>See what supports the call and what pushes against it.</span></div>
        <div><b>Research links</b><span>Jump into the player, matchup, Player Load and market board.</span></div>
      </div>
      <a class="btn gold" href="/pro?next=%2Fprops%23pbe-prop-edge">${signedIn ? 'Upgrade to WNBA Pro' : 'Unlock PBE Prop Edge'}</a>
      ${raw(allAccessCardHtml(membership, { compact: true }))}
    </div>
    <aside class="prop-edge-lock-demo">
      <span>PRO INTELLIGENCE</span><strong>Projection → Probability → Market</strong><small>No fake lock language. No hidden benchmark.</small>
    </aside>
  </section>`;
}

function warming(message) {
  return html`<section class="prop-edge prop-edge-locked" id="pbe-prop-edge">
    <div class="prop-edge-lock-copy"><span class="eyebrow">WNBA Pro · PBE Prop Edge</span><h2>Prop Edge is building the latest tracking board.</h2><p>${message || 'The current tracking snapshot is not available yet.'} The sportsbook board above remains live from its verified scheduled capture; no placeholder model values are shown.</p><a class="btn" href="/props#pbe-prop-edge">Retry Prop Edge</a></div>
    <aside class="prop-edge-lock-demo"><span>TRACKING BETA</span><strong>No guessed values</strong><small>The model only appears after a real projection snapshot exists.</small></aside>
  </section>`;
}

function propEdgeCard(r) {
  const modelProb = r.projection?.fair_probability;
  const marketProb = r.call === 'OVER' ? r.market?.over_prob : r.market?.under_prob;
  const best = r.call === 'OVER' ? r.market?.best_over : r.market?.best_under;
  return html`<article class="prop-edge-card">
    <header>
      <div><a class="prop-edge-player" href="/players/${r.athlete_id}">${r.player}</a><span>${MARKET_LABEL[r.market] || r.market}${r.team_id ? html` · <a href="/teams/${r.team_id}">team</a>` : ''}</span></div>
      <div class="prop-edge-call"><b>${r.call}</b><span>${r.confidence || 'TRACKING'}</span></div>
    </header>

    <div class="prop-edge-numbers">
      <div><span>PBE projection</span><b>${num(r.projection?.value)}</b><small>from ${r.sample_games} archived games</small></div>
      <div><span>Market line</span><b>${num(r.line)}</b><small>${best ? `${bookName(best.book)} ${american(best.price)}` : 'best price unavailable'}</small></div>
      <div><span>PBE probability</span><b>${pct(modelProb)}</b><small>${r.call}</small></div>
      <div><span>Market probability</span><b>${pct(marketProb)}</b><small>${r.market?.consensus_books || 0} book consensus</small></div>
      <div class="edge"><span>PBE disagreement</span><b>${signed(r.pbe_edge_pts)}</b><small>percentage points</small></div>
    </div>

    <div class="prop-edge-context">
      <span>L3 ${num(r.projection?.recent?.last3)}</span><span>L5 ${num(r.projection?.recent?.last5)}</span><span>L10 ${num(r.projection?.recent?.last10)}</span><span>Min L3 ${num(r.projection?.recent?.minutes_last3)}</span>${r.load ? html`<a href="/player-load">Load ${r.load.score} · ${r.load.band}</a>` : html`<span>Load —</span>`}
    </div>

    <div class="prop-edge-reasons">
      <section><h4>Why PBE leans ${r.call}</h4>${(r.drivers?.support || []).map((x) => html`<p>+ ${x}</p>`)}</section>
      <section class="risk"><h4>What pushes against it</h4>${(r.drivers?.risk || []).map((x) => html`<p>− ${x}</p>`)}</section>
    </div>

    <footer>${r.game_id ? html`<a href="/matchups/${r.game_id}">Open matchup →</a>` : ''}<a href="/players/${r.athlete_id}">Player intelligence →</a></footer>
  </article>`;
}

function propWatchRow(r) {
  return html`<article><a href="/players/${r.athlete_id}"><b>${r.player}</b><span>${MARKET_LABEL[r.market] || r.market}</span></a><span>Proj ${num(r.projection?.value)}</span><span>Line ${num(r.line)}</span><span>${r.projection?.fair_side} ${pct(r.projection?.fair_probability)}</span><b>${signed(r.pbe_edge_pts)} pts</b></article>`;
}

function signed(v) {
  return Number.isFinite(Number(v)) ? `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(1)}` : '—';
}

function num(v) {
  return Number.isFinite(Number(v)) ? Number(v).toFixed(1).replace(/\.0$/, '') : '—';
}
