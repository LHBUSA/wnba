// How the PBE WNBA model works — every number here comes from the frozen validation receipt via /v1/pbe/status.
import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton, pageHead, errorState } from '../ui/components.js';
import { fmtDateET } from '../lib/format.js';

export const title = () => 'How the PBE WNBA Model Works';
export const description = () => 'Features, walk-forward validation, calibration, the market benchmark, lock policy and known limits of PBE WNBA model v1.';

const FEATURE_TEXT = {
  sos_adj_net: ['Team quality', 'Net rating (points per 100 possessions) adjusted for strength of schedule, with early-season shrinkage toward the prior season.'],
  form10: ['Form', 'Last-10-game net rating relative to the team’s own season baseline.'],
  home_court: ['Situation', 'Home court. Neutral-site games (for example the 2020 bubble) carry no home edge.'],
  rest: ['Situation', 'Rest-day difference, capped at three days.'],
  back_to_back: ['Situation', 'Second night of a back-to-back.'],
  availability: ['Rotation', 'Share of recent minutes that came from players who played in the team’s last game.'],
  continuity: ['Rotation', 'Starter continuity against the last game. Its learned weight runs against the obvious reading, so it is shown as a model adjustment, never as a reason.']
};
const p3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '—');
const pc = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—');

export async function mount(root, ctx) {
  const head = pageHead({ eyebrow: 'PBE Picks', title: 'How the model works', sub: 'A deterministic probability model built from pregame team data. No language model picks games, and sportsbook prices never enter the model.', right: html`<div class="pbe-links"><a class="pill" href="/pbe-picks">PBE Picks</a><a class="pill" href="/track-record">Track Record</a></div>` });
  render(root, html`${head}${skeleton(420)}`);
  const res = await api.pbeStatus();
  if (!ctx.isCurrent()) return;
  if (!res.ok) return render(root, html`${head}${errorState(res, 'Model details')}`);
  const d = res.data;
  const h = d.holdout || {};
  render(root, html`${head}
    <div class="grid g2 section">
      <section class="card card-pad">
        <span class="eyebrow">What it predicts</span>
        <p style="margin-top:12px;color:var(--paper-2)">The probability that each team wins the game. One calculation per game; both team pages show the same call from that team’s side.</p>
        <span class="eyebrow" style="display:block;margin-top:18px">What it reads</span>
        <ul class="pro-list">${d.features.map((f) => html`<li><span><b>${FEATURE_TEXT[f]?.[0] || f}.</b> ${FEATURE_TEXT[f]?.[1] || f}</span></li>`)}</ul>
        <p class="note" style="margin-top:14px">Every input comes from final box scores of games that finished on an earlier calendar day than the game being predicted. Final scores, future rosters, later injury updates and closing prices are never visible to a prediction.</p>
      </section>
      <section class="card card-pad">
        <span class="eyebrow">How it was tested</span>
        <p style="margin-top:12px;color:var(--paper-2)">Walk-forward by season: trained only on earlier seasons, tuned on 2015–2024, then scored once on the untouched ${(h.seasons || []).join(' + ')} holdout.</p>
        <div class="model-metrics">
          <div class="tile"><small>Log loss</small><b>${p3(h.log_loss)}</b><span>coin flip 0.693</span></div>
          <div class="tile"><small>Brier</small><b>${p3(h.brier)}</b><span>coin flip 0.250</span></div>
          <div class="tile"><small>Accuracy</small><b>${pc(h.accuracy)}</b><span>n = ${h.n}</span></div>
          <div class="tile"><small>ROC AUC</small><b>${p3(h.roc_auc)}</b><span>calibration slope ${p3(h.calibration_slope)}</span></div>
        </div>
        <div class="callout" style="margin-top:14px"><b>The market is the hard benchmark.</b> ${d.market_benchmark_note}</div>
      </section>
    </div>
    <div class="grid g2 section">
      <section class="card card-pad">
        <span class="eyebrow">PBE Edge</span>
        <p style="margin-top:12px;color:var(--paper-2)">PBE probability minus the de-vigged consensus probability for the same team: each sportsbook’s price is normalized to 100%, then the median is taken across books. The book count and market age are shown with every edge.</p>
        <span class="eyebrow" style="display:block;margin-top:18px">Lock policy · ${d.lock_policy.id}</span>
        <p style="margin-top:12px;color:var(--paper-2)">Calls are recalculated as new pregame data arrives, every minute in the final half hour, and lock ${d.lock_policy.lock_minutes_before_tip} minutes before scheduled tip. After the lock, the pick, probability, inputs, reasoning and market comparison never change. Results are graded separately, and corrections are added as new revisions.</p>
        <p class="note" style="margin-top:10px">${d.lock_policy.note}</p>
      </section>
      <section class="card card-pad">
        <span class="eyebrow">Known limits</span>
        <ul class="pro-list">${(d.known_limits || []).map((l) => html`<li>${l}</li>`)}</ul>
        <span class="eyebrow" style="display:block;margin-top:18px">Model identity</span>
        <p class="model-hash" style="margin-top:10px">${d.model_id} · ${d.model_type}<br>artifact ${d.artifact_sha256}<br>feature spec ${d.feature_spec_sha256}<br>validation receipt ${d.validation_receipt_sha256}<br>training window ${fmtDateET(d.training_window.first_game_utc, { year: 'numeric', month: 'short', day: 'numeric' })} – ${fmtDateET(d.training_window.last_game_utc, { year: 'numeric', month: 'short', day: 'numeric' })} · ${d.training_window.rows} games</p>
      </section>
    </div>`);
}
