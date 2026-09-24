import { html, raw } from '../lib/dom.js';
import { allAccessMiniHtml } from '../ui/all-access.js';

// Public/server-rendered flagship shell for PBE Picks. It deliberately contains
// zero protected prediction values. The entitled client replaces this with the
// live board only after wnba-api confirms WNBA Pro access.
export function pbePicksPublicView() {
  return html`
    <section class="pbe-public-flagship">
      <div class="pbe-public-copy">
        <span class="eyebrow">WNBA Pro · Flagship Intelligence</span>
        <h1>PBE <span>Picks</span></h1>
        <p class="lead">The model call is only the start. Every covered game becomes a research file: independent win probability, de-vigged market comparison, model-market gap, confidence, driver-by-driver reasoning and a frozen pre-tip record.</p>
        <div class="pbe-public-principles">
          <div><b>Independent model</b><span>Pregame team data produces the probability. Sportsbook prices never enter the model.</span></div>
          <div><b>Market beside it</b><span>See the de-vigged market and the exact disagreement instead of hiding the benchmark.</span></div>
          <div><b>Why / why not</b><span>Supporting factors and opposing factors come from the model's real feature contributions.</span></div>
          <div><b>Beyond the pick</b><span>Pro opens Edge Timeline, Scenario Lab, Rotation Impact, Player Load and your own Watchlist around the same call.</span></div>
        </div>
        ${raw(allAccessMiniHtml(null))}
        <div class="pbe-public-actions">
          <a class="btn gold" href="/pro?next=%2Fpbe-picks">Unlock WNBA Pro</a>
          <a class="btn" href="/brief">Read the free Daily Brief</a>
          <a class="btn" href="/track-record">See the live track record</a>
          <a class="sec-link" href="/pbe-picks/model">How the model works →</a>
        </div>
        <p class="pbe-public-truth">No “AI lock” claims. PBE Edge is model-market disagreement, not guaranteed value. The benchmark, methodology and permanent record are visible by design.</p>
      </div>
      <aside class="pbe-public-preview" aria-label="PBE Picks product preview">
        <span class="pbe-lock-kicker">WNBA PRO</span>
        <h2>One call. A full research stack.</h2>
        <ol>
          <li><b>01</b><span>Model probability + reasoning</span></li>
          <li><b>02</b><span>Market consensus + PBE gap</span></li>
          <li><b>03</b><span>Edge Timeline + Scenario Lab</span></li>
          <li><b>04</b><span>Player Load + Rotation Impact</span></li>
          <li><b>05</b><span>Locked result ledger + Watchlist</span></li>
        </ol>
        <div class="pbe-public-price"><strong>$9.99</strong><span>/month</span><small>or $3.99/week · cancel anytime</small></div>
      </aside>
    </section>
  `;
}
