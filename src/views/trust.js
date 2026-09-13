// Trust & publisher pages: /about, /editorial-policy, /corrections, /methodology, plus the static source
// registry shown on /sources. Static, crawlable, concise. Shared by the SPA and the publishing Worker.
import { html } from '../lib/dom.js';
import { pageHead } from '../ui/components.js';

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
  ['The Odds API', 'Sportsbook prices stored by PropBetEdge at 8:00 a.m., 1:00 p.m. and 6:00 p.m. ET, and player props inside 36 hours of tip. A page view never requests new prices.'],
  ['Publisher source wire', 'ESPN, WNBA.com, CBS Sports, The IX, Swish Appeal and Her Hoop Stats: headline, link and the publisher-supplied description or summary only. Article bodies are never stored or reproduced; links open on the publisher’s site.'],
  ['Wikimedia Commons', 'Player photographs used under their stated Creative Commons or public-domain licenses, credited on every image, matched to the player by Wikidata identity and reviewed before use.'],
  ['PropBetEdge WNBA Newsroom', 'Stories written by the deterministic PropBetEdge generator from the structured records cited in each story’s evidence list.']
];

export function sourcesRegistryView() {
  return html`<section class="card" style="margin-bottom:16px">
    <div class="card-head"><span class="card-title">Where the data comes from</span><a class="sec-link" href="/methodology">Methodology →</a></div>
    <div class="card-body">${SOURCE_REGISTRY.map(([name, body]) => html`<p><b>${name}.</b> ${body}</p>`)}</div>
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
      'The newsroom is automated and deterministic. Every ten minutes it reads PropBetEdge’s structured WNBA records — the injury feed, transactions, box scores, schedules, standings and stored market captures — and the attributed publisher source wire, and writes stories only where a record supports one.',
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
