import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton, badge, errorState } from '../ui/components.js';
import { relTime, fmtDateTimeET } from '../lib/format.js';
import { sourcesRegistryView, sourcesHead, newsHealthView } from '../views/trust.js';

export const title = () => 'Source status & methodology';
export const description = () => 'Live source health for PropBetEdge WNBA, measured from the Cloudflare runtime, plus the methods behind every derived number.';

export async function mount(root, ctx) {
  render(root, html`${sourcesHead()}${sourcesRegistryView()}${skeleton(360)}`);
  const [src, health, news] = await Promise.all([api.sources(), api.health(), api.newsSources()]);
  if (!ctx.isCurrent()) return;
  const ingest = health.ok !== false ? health.ingest_status || health.data?.ingest_status : null;
  const h = health.ok ? health : null;
  render(root, html`
    ${sourcesHead()}
    ${sourcesRegistryView()}
    ${newsHealthView(news)}

    <section class="card section">
      <div class="card-head"><span class="card-title">Provider canary · from Cloudflare</span><span class="note">${src.ok ? `run ${fmtDateTimeET(src.meta.served_at)}` : ''}</span></div>
      ${src.ok ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Capability</th><th>Host</th><th>HTTP</th><th>Bytes</th><th>Latency</th><th>Result</th></tr></thead><tbody>
        ${src.data.probes.map((p) => html`<tr><td>${p.name.replace('_', ' ')}</td><td class="l">${p.host}</td><td>${p.status ?? '—'}</td><td>${p.bytes.toLocaleString()}</td><td>${p.ms} ms</td><td>${p.pass ? badge('final', 'PASS') : badge(p.name === 'site_api_host' ? 'stale' : 'out', p.name === 'site_api_host' ? 'Blocked (expected)' : 'FAIL')}</td></tr>`)}
      </tbody></table></div><div class="card-body"><p class="note">ESPN’s primary site API host refuses Cloudflare egress (403); every route uses ESPN’s site.web API host, which serves the same payloads. The blocked row is kept as a tripwire.</p></div>` : errorState(src, 'The canary')}
    </section>

    <div class="grid g2 section">
      <section class="card">
        <div class="card-head"><span class="card-title">Background lanes · Cloudflare Cron</span></div>
        <div class="card-body">
          ${ingest ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Task</th><th>Last run</th><th>Result</th></tr></thead><tbody>
            ${['live', 'availability', 'backfill', 'winba', 'schedule', 'reference', 'odds'].filter((k) => ingest[k]).map((k) => html`<tr><td>${k}</td><td>${relTime(ingest[k].at)}</td><td>${ingest[k].ok ? badge('final', 'OK') : badge('out', 'FAIL')}</td></tr>`)}
          </tbody></table></div>` : html`<p class="note">Ingest status unavailable.</p>`}
          <p class="note" style="margin-top:10px">System of record: <b>${h?.system_of_record === 'supabase' ? 'Supabase' : 'Supabase not yet connected — Cloudflare KV holds snapshots, the replay archive and change ledgers until the staged schema is applied'}</b>.</p>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><span class="card-title">Newsroom usage policy</span></div>
        <div class="card-body">
          ${news.ok ? news.data.sources.filter((s) => s.kind !== 'owned').map((s) => html`<div class="change-row" style="grid-template-columns:minmax(0,1fr)"><div><b>${s.name}</b><div class="note">${s.usage_policy}</div></div></div>`) : errorState(news, 'The newsroom')}
        </div>
      </section>
    </div>

    <section class="card card-pad section">
      <span class="eyebrow">Methods</span>
      <ul class="pro-list">
        <li><b>Shot charts</b> plot only attempts with a published location, in the source’s own feet; free throws and unlocated attempts are counted, never placed.</li>
        <li><b>Runs, lead changes and team fouls</b> are computed from the published event stream; lead changes and largest leads reproduce ESPN’s own box totals on audited games.</li>
        <li><b>Pace</b> is the standard possessions estimate (FGA − OREB + TOV + 0.44·FTA) and is labelled as an estimate.</li>
        <li><b>Rotations</b> are observed from the last five real box scores; roles follow stated minute rules.</li>
        <li id="winba-score"><b>WinBA Score</b> is PropBetEdge’s 0–100 winning-impact index from archived regular-season finals only: 45% league percentile of Box Impact per 36, 25% player win rate in games appeared, 20% share of Box Impact produced in wins, and 10% court share (average minutes ÷ 40). Box Impact = PTS + 1.2×REB + 1.5×AST. The production benchmark uses qualification-eligible players; 10 appearances or 250 minutes qualifies, otherwise the score is Provisional. WinBA describes box production and playing time associated with team wins; it is not a causal wins-added metric.</li>
        <li><b>Market consensus</b> is the median no-vig probability across books — a benchmark, never a PropBetEdge model.</li>
        <li><b>Newsroom events</b> are one story per real-world event: reports are joined by their facts (event type, player, team), scored by a stated materiality rule, and only material events become stories.</li>
        <li><b>Player photos</b> are Wikimedia Commons images under CC0 / public-domain / CC BY / CC BY-SA, matched to the player by exact name and date of birth on Wikidata, then crop-reviewed. Otherwise a neutral card.</li>
      </ul>
      <p class="note" style="margin-top:12px">Photo coverage: ${h?.photo_coverage ? `${h.photo_coverage.approved} verified` : '—'}.</p>
    </section>
  `);
}
