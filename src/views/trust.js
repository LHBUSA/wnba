// Trust & publisher pages: /about, /editorial-policy, /corrections, /methodology, plus the static source
// registry shown on /sources. Static, crawlable, concise. Shared by the SPA and the publishing Worker.
import { html, raw } from '../lib/dom.js';
import { pageHead, badge } from '../ui/components.js';

const nav = (here) => html`<nav class="pill-row" aria-label="Trust pages" style="margin:4px 0 20px">
  ${[['/about', 'About'], ['/editorial-policy', 'Editorial policy'], ['/corrections', 'Corrections'], ['/methodology', 'Methodology'], ['/sources', 'Sources']].map(([href, label]) => html`<a class="pill ${href === here ? 'on' : ''}" href="${href}" ${href === here ? html`aria-current="page"` : ''}>${label}</a>`)}
</nav>`;

const page = (here, head, sections) => html`
  ${pageHead(head)}
  ${nav(here)}
  <div class="trust-doc art-body" style="max-width:74ch">
    ${sections.map(([h, paras]) => html`<section class="section" style="margin-top:22px"><h2 class="sec-title bc">${h}</h2>${paras.map((p) => html`<p>${p}</p>`)}</section>`)}
  </div>`;

export const SOURCE_REGISTRY = [
  ['ESPN public WNBA data', 'Schedules, scores, play-by-play, published shot locations, box scores, rosters, standings, team and player statistics, transactions and the injury feed. Used as structured records; statuses stay ESPN’s and are labelled as such.'],
  ['PropSports.PropTechUSA.ai Market Feed', 'Sportsbook prices stored by PropBetEdge at 8:00 a.m., 1:00 p.m. and 6:00 p.m. ET, and player props inside 36 hours of tip. A page view never requests new prices.'],
  ['Official league and team sites (review required)', 'WNBA.com and the fifteen WNBA-hosted team sites are classified review required: the WNBA.com Terms of Use restrict commercial reuse and links from commercial sites without written permission, and that review is unresolved. They are monitored for source health and internal event detection only — nothing from them is displayed, cited, linked or used to create a story, no article bodies are read, and no WNBA.com statistics are used.'],
  ['Publisher source wire', 'ESPN, NBC Sports, CBS Sports, Just Women’s Sports, The IX, the Las Vegas Review-Journal, the New York Post, the Los Angeles Times, High Post Hoops, Swish Appeal, Winsidr and Her Hoop Stats: headline, link and — where the publisher allows automated reuse — its own short summary. Article bodies are never stored or reproduced; links open on the publisher’s site. Paywalled and aggregator sources are not ingested.'],
  ['Wikimedia Commons', 'Player photographs used under their stated Creative Commons or public-domain licenses, credited on every image, matched to the player by Wikidata identity and reviewed before use.'],
  ['PropBetEdge WNBA Newsroom', 'Stories written by the deterministic PropBetEdge generator from the structured records cited in each story’s evidence list.']
];

export function sourcesRegistryView() {
  return html`<section class="card" style="margin-bottom:16px">
    <div class="card-head"><span class="card-title">Where the data comes from</span><a class="sec-link" href="/methodology">Methodology →</a></div>
    <div class="card-body">${SOURCE_REGISTRY.map(([name, body]) => html`<p><b>${name === 'PropSports.PropTechUSA.ai Market Feed' ? raw('<a href="https://propsports.proptechusa.ai/" target="_blank" rel="noopener noreferrer">PropSports.PropTechUSA.ai Market Feed</a>') : name}.</b> ${body}</p>`)}</div>
  </section>`;
}

const STATUS_BADGE = { PASS: ['final', 'OK'], NOT_MODIFIED: ['final', 'OK · 304'], SKIPPED: ['final', 'OK · daily'], DEGRADED: ['stale', 'Degraded'], FAIL: ['out', 'Failing'] };
const STALE_LABEL = { CURRENT: 'current', QUIET: 'quiet publisher', STALE_FETCH: 'stale — polls failing' };
const TIER_LABEL = { official: 'Official', national: 'National', womens_media: 'Women’s sports media', local_beat: 'Local beat', analysis: 'Analysis' };
const ago = (iso, now) => { if (!iso) return '—'; const m = Math.round((now - Date.parse(iso)) / 60e3); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

/**
 * Newsroom source health — measured by the wnba-news Worker on every five-minute poll. Shared by /sources in the SPA
 * and the publishing Worker, so the first HTTP response carries the same table.
 */
export function newsHealthView(news, { now = Date.now() } = {}) {
  if (!news?.ok) return html`<section class="card section"><div class="card-head"><span class="card-title">Newsroom sources</span></div><div class="card-body"><p class="note">Newsroom source health is unavailable right now.</p></div></section>`;
  const { summary, sources, not_ingested: skipped = [], cadence } = news.data;
  const polled = sources.filter((s) => s.health);
  const tiers = ['official', 'national', 'womens_media', 'local_beat', 'analysis'];
  return html`<section class="card section">
    <div class="card-head"><span class="card-title">Newsroom sources · health</span><span class="note">${summary ? `${summary.ok} of ${summary.sources} polling OK` : ''}${news.meta?.last_ingest_at ? ` · last poll ${ago(news.meta.last_ingest_at, now)}` : ''}</span></div>
    <div class="card-body"><p class="note">${cadence}. Conditional requests (ETag / Last-Modified) are used wherever the publisher honours them; a 304 is a successful poll with nothing new.${summary?.failing?.length ? ` Failing now: ${summary.failing.join(', ')}.` : ''}</p></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">Source</th><th>Status</th><th>HTTP</th><th>Last success</th><th>Fetched</th><th>Accepted</th><th>New events</th><th>Duplicates</th><th>Parse errors</th><th>Newest item</th><th class="l">Staleness</th></tr></thead><tbody>
      ${tiers.map((t) => {
        const rows = polled.filter((s) => s.tier === t);
        if (!rows.length) return '';
        return html`<tr><td class="l" colspan="11"><span class="eyebrow">${TIER_LABEL[t]}</span></td></tr>${rows.map((s) => {
          const h = s.health;
          const [key, label] = STATUS_BADGE[h.last_status] || ['stale', h.last_status];
          return html`<tr>
            <td class="l">${s.policy_status === 'review_required' ? html`<b>${s.name}</b> ${badge('stale', 'Review required')}` : html`<a href="${s.home_url}" rel="noopener nofollow" target="_blank">${s.name}</a>`}<div class="note">${s.format === 'news_sitemap' ? 'news sitemap (daily)' : s.format === 'wnba_platform' ? 'official page data' : s.format === 'espn_json' ? 'provider JSON' : 'RSS / Atom'} · ${h.timestamp_quality && (h.timestamp_quality.date_only || 0) > 0 ? 'date-only timestamps' : s.timestamp_quality}</div></td>
            <td>${badge(key, label)}</td>
            <td>${h.http_status ?? '—'}</td>
            <td>${ago(h.last_success_at, now)}</td>
            <td>${h.last_run?.fetched ?? 0}</td>
            <td>${h.last_run?.accepted ?? 0}</td>
            <td>${h.totals_24h?.new_events ?? 0}<span class="note"> /24h</span></td>
            <td>${h.last_run?.duplicates ?? 0}</td>
            <td>${h.last_run?.parse_errors ?? 0}</td>
            <td>${ago(h.latest_item_at, now)}</td>
            <td class="l">${STALE_LABEL[h.staleness] || h.staleness}${h.error ? html`<div class="note">${h.error}</div>` : ''}</td>
          </tr>`;
        })}`;
      })}
    </tbody></table></div>
    ${skipped.length ? html`<div class="card-body"><p class="note"><b>Audited and not ingested:</b> ${skipped.map((x) => `${x.name} (${x.reason.replace(/\.$/, '')})`).join('; ')}.</p></div>` : ''}
  </section>`;
}

export const sourcesHead = () => pageHead({ eyebrow: 'Trust', title: 'Source status', sub: 'Measured live from the Cloudflare Workers that serve this site — the same egress your data comes through. Nothing on this page is cached marketing copy.' });

export const TRUST_VIEWS = {
  about: () => page('/about', { eyebrow: 'Trust', title: 'About PropBetEdge WNBA', sub: 'An independent WNBA intelligence desk and newsroom, part of the PropBetEdge network.' }, [
    ['Who publishes this site', [
      'PropBetEdge WNBA is published by PropBetEdge. It is independent: it is not affiliated with, endorsed by or sponsored by the WNBA, its teams, its players, ESPN or any sportsbook.',
      'The site combines live WNBA data (WNBACast, scores, injuries, standings, stats), stored sportsbook market snapshots and an in-house newsroom. Everything is built for research; nothing here is a guarantee or a pick unless it is recorded on the track record.'
    ]],
    ['The PropBetEdge WNBA Newsroom', [
      'The newsroom is automated and deterministic. It polls official league and team announcements and the attributed publisher source wire every five minutes, and every ten minutes — or immediately when an official team or league announcement is material — it reads PropBetEdge’s structured WNBA records — the injury feed, transactions, box scores, schedules, standings and stored market captures — and writes stories only where a record supports one.',
      'Each story passes a publication gate before it goes live. A story that fails the gate is held, not published.'
    ]],
    ['Publisher reporting vs. PropBetEdge facts', [
      'External reporting stays the publisher’s. A News Brief names the originating publisher, links to it and never reproduces its article body; any detail that exists only in that report is attributed to the publisher in the sentence that uses it.',
      'PropBetEdge facts are the numbers and statuses in its own structured records, each listed in the story’s evidence with its source and capture time.'
    ]],
    ['Responsible use', ['PropBetEdge WNBA is for entertainment and research. Bet responsibly; 21+. Sportsbook prices, market consensus and PropBetEdge model outputs are always kept separate.']]
  ]),

  'editorial-policy': () => page('/editorial-policy', { eyebrow: 'Trust', title: 'Editorial policy', sub: 'The rules every PropBetEdge WNBA story is generated and checked against.' }, [
    ['Deterministic generation', [
      'Stories are produced by versioned, deterministic generators from structured records. The same inputs produce the same story; the generator version is printed on every article.'
    ]],
    ['The publication gate', [
      'Every number in a story must appear in a cited PropBetEdge record, or in a publisher’s headline with that publisher named in the same sentence. Any other number fails the story.',
      'The only quotation allowed is a publisher’s own headline, attributed. No price or favourite language appears without a stored market, no model claims appear at all, and banned certainty phrases fail the story.',
      'Every bettor angle states what argues against it and what is still unknown. A separate reconciliation check holds stories with wrong-season statistics, incomplete injury context or copied provider comment text.'
    ]],
    ['Headlines', [
      'Headlines are PropBetEdge’s own, written from the event and the records, not copied from a publisher. They never go beyond what the source and records support.'
    ]],
    ['Images', [
      'Only licensed photographs whose subject is verified are used, each credited with author and license. When no approved photo exists the story uses a team composition — never a stand-in player and never an AI likeness.'
    ]],
    ['What is never published', [
      'Publisher article bodies, invented return dates, reconstructed play-by-play or shot locations, fake odds or probabilities on share images, and model predictions presented as facts.'
    ]]
  ]),

  corrections: () => page('/corrections', { eyebrow: 'Trust', title: 'Corrections & revisions', sub: 'How stories change after publication, and how that change is shown.' }, [
    ['Two times on every story', [
      '“Published” is the moment PropBetEdge first published the story. It never changes.',
      '“Updated” appears when the story has been revised since, and “Source record” is the time of the underlying provider record. Neither of them makes an older story new again.'
    ]],
    ['New story or revision', [
      'A new material event is a new story. The same event with new information is a revision of the same story, at the same URL, with an Updated time.',
      'For injuries, one listing of a player at a status is one event while the listing continues, even when the provider re-issues its record; a status change, or a return to the feed after a real absence from it, is a new event. A News Brief stays one story as more publishers cover the same event.'
    ]],
    ['Corrections', [
      'When a record changes or an error is found, the story is regenerated from the corrected records and shows its Updated time. Duplicate URLs for the same story redirect to the canonical story.',
      'Report a possible error through the PropBetEdge community Discord linked in the footer, with the story URL.'
    ]]
  ]),

  methodology: () => page('/methodology', { eyebrow: 'Trust', title: 'Methodology', sub: 'How the derived numbers on PropBetEdge WNBA are computed, and what they are not.' }, [
    ['Market data', [
      'Best price is the best number any captured sportsbook offers. Market consensus is the no-vig probability derived from the captured books’ prices. They are shown separately, with book count and capture time, and are not a PropBetEdge model.',
      'Market snapshots are stored at 8:00 a.m., 1:00 p.m. and 6:00 p.m. ET; the last capture before tip is labelled as such. Player props are captured inside 36 hours of tip, and Prop Watch stories run only from stored player-prop snapshots.'
    ]],
    ['Form, rotations, rest and pace', [
      'Recent form uses a stated sample (last 5 or last 10 games). Observed rotations count starts, appearances and minutes in a team’s most recent box scores. Rest counts days since the previous game from the published schedule. Pace is an estimate of possessions per game from team totals, labelled as an estimate.'
    ]],
    ['Availability', [
      'Injury statuses are ESPN’s injury-feed statuses, not the league’s official game-day report. A change is recorded only when two consecutive captures disagree. Return dates appear only when the source publishes one, labelled as the source’s estimate.'
    ]],
    ['Newsroom identity and freshness', [
      'Stories are ordered by their first publication time. Sitemaps, the RSS feed and the front page use that same time, so a revision never re-surfaces an old story as new.'
    ]],
    ['Photos and identity', [
      'Players are identified by ESPN athlete IDs. A photograph is approved only after its license is confirmed and its subject is matched to the player’s Wikidata entry by exact name and date of birth.'
    ]]
  ])
};
