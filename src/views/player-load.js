import { html } from '../lib/dom.js';

export function playerLoadExplainer() {
  return html`
    <section class="pl-explainer" aria-labelledby="pl-explainer-title">
      <div class="pl-explainer-head">
        <div>
          <span class="eyebrow">How Player Load Works</span>
          <h2 id="pl-explainer-title">Workload pressure, <span>not an injury prediction.</span></h2>
          <p>Player Load is PropBetEdge's 0–100 view of how much recent game work and schedule pressure a player is carrying into the next tip. It turns completed-game minutes and the schedule into one readable score, then shows the drivers underneath so the number is never a black box.</p>
        </div>
        <div class="pl-read-this">
          <b>How to read it</b>
          <p>A higher score means the player has faced more recent workload pressure. It does <strong>not</strong> mean the player is injured, medically fatigued or guaranteed to play worse.</p>
        </div>
      </div>

      <div class="pl-formula" aria-label="Player Load score components">
        <div><strong>30</strong><span><b>7-day minutes</b>Recent total floor time</span></div>
        <div><strong>20</strong><span><b>Schedule density</b>Games packed into seven days</span></div>
        <div><strong>20</strong><span><b>Recent minutes</b>Average workload over the last three</span></div>
        <div><strong>15</strong><span><b>Turnaround</b>Tip-to-tip recovery window</span></div>
        <div><strong>10</strong><span><b>Minutes spike</b>Change versus the 10-game baseline</span></div>
        <div><strong>5</strong><span><b>Overtime</b>Extra-period exposure in the last seven days</span></div>
      </div>

      <div class="pl-explainer-grid">
        <div class="pl-band-guide">
          <h3>Load bands</h3>
          <div><span class="pl-band pl-light">LIGHT</span><b>0–34</b><p>Lower recent workload pressure.</p></div>
          <div><span class="pl-band pl-normal">NORMAL</span><b>35–54</b><p>Typical active-rotation workload.</p></div>
          <div><span class="pl-band pl-elevated">ELEVATED</span><b>55–69</b><p>Meaningful workload or schedule pressure is building.</p></div>
          <div><span class="pl-band pl-heavy">HEAVY</span><b>70–84</b><p>Significant recent minutes, density or turnaround pressure.</p></div>
          <div><span class="pl-band pl-extreme">EXTREME</span><b>85–100</b><p>The highest workload-pressure tier in the model.</p></div>
        </div>

        <div class="pl-use-guide">
          <h3>Use it as context, not a pick</h3>
          <ol>
            <li><b>Spot pressure.</b><span>Start with Elevated, Heavy and Extreme players.</span></li>
            <li><b>Read the drivers.</b><span>Minutes, density, overtime and turnaround explain why the score moved.</span></li>
            <li><b>Check availability separately.</b><span>Injury status is shown beside Player Load but never changes the score.</span></li>
            <li><b>Connect the research.</b><span>Use Player Load alongside matchups, team context, PBE Picks and the market — never as a standalone betting signal.</span></li>
          </ol>
        </div>
      </div>

      <p class="pl-explainer-note">The score is deterministic and based on completed WNBA game minutes plus the upcoming schedule. No sportsbook price, injury designation or subjective fatigue label is used to create it.</p>
    </section>
  `;
}

export function playerLoadPublicView({ statusMessage = '', showOffer = true } = {}) {
  return html`
    <section class="pl-public">
      <div class="pl-public-copy">
        <span class="eyebrow">WNBA Pro · Player Intelligence</span>
        <h1>Player <span>Load</span></h1>
        <p class="lead">A 0–100 workload and schedule-pressure view built from completed WNBA game minutes, game density, overtime, rotation context and the next tip.</p>
        <div class="pl-method-grid">
          <div><b>Minutes load</b><span>Recent volume and three-game workload</span></div>
          <div><b>Schedule density</b><span>Games packed into the last 3, 5 and 7 days</span></div>
          <div><b>Turnaround</b><span>Tip-to-tip rest before the next scheduled game</span></div>
          <div><b>Rotation pressure</b><span>Starts, overtime and recent playable depth</span></div>
        </div>
        <p class="pl-disclaimer">Player Load is a workload, schedule-density and rotation-pressure metric. It is not a medical or physiological fatigue assessment.</p>
      </div>
      ${showOffer ? html`<aside class="pl-lock-card">
        <span class="pl-lock-kicker">PRO INTELLIGENCE</span>
        <div class="pl-lock-score">0<span>—</span>100</div>
        <h2>See the pressure before tip.</h2>
        <p>WNBA Pro members get the live league board, player-level drivers, workload bands and availability context.</p>
        <a class="btn gold block" href="/pro?next=/player-load">Get WNBA Pro</a>
        <small>$9.99/month · $3.99/week · cancel anytime</small>
      </aside>` : html`<aside class="pl-lock-card pl-status-card">
        <span class="pl-lock-kicker">PLAYER LOAD INTELLIGENCE</span>
        <h2>Live board temporarily unavailable.</h2>
        <p>${statusMessage || 'The latest player-level snapshot is not available right now. The methodology and scoring guide remain available below while the live board reconnects.'}</p>
        <a class="btn block" href="/player-load">Retry live board</a>
        <small>No substitute or guessed player values are shown.</small>
      </aside>`}
    </section>
    ${playerLoadExplainer()}
  `;
}
