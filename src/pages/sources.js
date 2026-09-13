import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton, badge, errorState } from '../ui/components.js';
import { relTime, fmtDateTimeET } from '../lib/format.js';
import { sourcesRegistryView, sourcesHead } from '../views/trust.js';

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
    <section class="card">
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
            ${['live', 'availability', 'backfill', 'schedule', 'reference', 'odds'].filter((k) => ingest[k]).map((k) => html`<tr><td>${k}</td><td>${relTime(ingest[k].at)}</td><td>${ingest[k].ok ? badge('final', 'OK') : badge('out', 'FAIL')}</td></tr>`)}
          </tbody></table></div>` : html`<p class="note">Ingest status unavailable.</p>`}
          <p class="note" style="margin-top:10px">System of record: <b>${h?.system_of_record === 'supabase' ? 'Supabase' : 'Supabase not yet connected — Cloudflare KV holds snapshots, the replay archive and change ledgers until the staged schema is applied'}</b>.</p>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><span class="card-title">Newsroom lane</span></div>
        <div class="card-body">
          ${news.ok ? news.data.sources.map((s) => html`<div class="change-row" style="grid-template-columns:minmax(0,1fr) auto"><div><b>${s.name}</b><div class="note">${s.usage_policy}</div></div>${s.last_run ? badge(s.last_run.status === 'PASS' ? 'final' : 'stale', s.last_run.status) : badge('pbe', 'Owned')}</div>`) : errorState(news, 'The newsroom')}
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
        <li><b>Market consensus</b> is the median no-vig probability across books — a benchmark, never a PropBetEdge model.</li>
        <li><b>Player photos</b> are Wikimedia Commons images under CC0 / public-domain / CC BY / CC BY-SA, matched to the player by exact name and date of birth on Wikidata, then crop-reviewed. Otherwise a neutral card.</li>
      </ul>
      <p class="note" style="margin-top:12px">Photo coverage: ${h?.photo_coverage ? `${h.photo_coverage.approved} verified` : '—'}.</p>
    </section>
  `);
}
