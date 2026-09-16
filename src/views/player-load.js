import { html } from '../lib/dom.js';

export function playerLoadPublicView() {
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
      <aside class="pl-lock-card">
        <span class="pl-lock-kicker">PRO INTELLIGENCE</span>
        <div class="pl-lock-score">0<span>—</span>100</div>
        <h2>See the pressure before tip.</h2>
        <p>WNBA Pro members get the live league board, player-level drivers, workload bands and availability context.</p>
        <a class="btn gold block" href="/pro?next=/player-load">Get WNBA Pro</a>
        <small>$9.99/month · $3.99/week · cancel anytime</small>
      </aside>
    </section>
  `;
}
