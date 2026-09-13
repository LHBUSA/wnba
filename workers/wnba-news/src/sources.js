// WNBA newsroom source registry — news-sources/2.0.0.
//
// Every source below was probed with this Worker's own user agent (no disguised UA) on 2026-09-13; the audit,
// including rejected and audit-only candidates, is in docs/NEWS_SOURCE_AUDIT.md.
//
// Rights: external items are stored as headline + canonical link + (where the source allows) the publisher's own
// short summary, publisher tags and timestamps. Article bodies are never stored or rendered — several official
// payloads embed full bodies and the parsers drop them. `summary_policy: 'none'` keeps headline + link only
// (used where a publisher's robots rules signal it does not want automated reuse of text, and for the official
// team sites, whose excerpts are frequently truncated body text).
//
// Fields:
//   source_id, name (publisher), kind, tier, home_url, feed_url, format, wnba_scope, team (official team sites),
//   reliability, timestamp_quality, conditional (what the server honours), rights, summary_policy,
//   attribution, priority (1 official … 4 fan/analysis), failure_behavior, cadence_min (expected quiet period).

const UA_NOTE = 'PropBetEdge-WNBA-News UA; no login, no paywall, no private credentials.';

// Source policy status (engineering classification, not a legal conclusion):
//   approved         may appear on public surfaces and support PropBetEdge stories.
//   review_required  WNBA.com and the WNBA-hosted team sites. The WNBA.com Terms of Use restrict commercial reuse of
//                    site materials and links from commercial sites without the operator's written permission; that
//                    permission / legal review is unresolved. These sources are polled for internal event detection
//                    and source health only: nothing from them is shown publicly, cited, quoted or used to create or
//                    corroborate a story, no article bodies are read, and no WNBA.com statistics feed any sportsbook,
//                    model or database input. Their dependence may not grow while the review is open.
export const REVIEW_NOTE = 'Review required: WNBA.com Terms of Use restrict commercial reuse and links from commercial sites without written permission; permission/legal review unresolved. Internal event detection and health monitoring only — not displayed, cited or used to create stories.';
export const PUBLIC_REVIEW_REQUIRED = false;

const team = (slug, name, extra = {}) => ({
  source_id: `team_${slug}`,
  name: `${name} (official)`,
  kind: 'team_official',
  tier: 'official',
  home_url: `https://${slug}.wnba.com/news`,
  feed_url: `https://${slug}.wnba.com/news`,
  format: 'wnba_platform',
  wnba_scope: 'team_official',
  team: { name },
  reliability: 'authoritative for the team’s own roster, injury and front-office announcements',
  timestamp_quality: 'exact_utc',
  conditional: 'none (no ETag/Last-Modified) — deduped by post id + content hash',
  rights: 'Official team site. Headline, link, publisher categories and timestamps only; the embedded article body is discarded by the parser. WNBA.com terms of use apply (see audit).',
  summary_policy: 'none',
  attribution: `${name} (official team site)`,
  priority: 1,
  failure_behavior: 'Source marked FAIL in health; last-good items stay; other sources unaffected.',
  cadence_min: 7 * 24 * 60,
  usage_policy: 'Official team news: headline, link, categories and timestamps. No body text, no images.',
  policy_status: 'review_required',
  policy_note: REVIEW_NOTE,
  ...extra
});

const REGISTRY = [
  // ---------------------------------------------------------------- official league
  {
    source_id: 'wnba_com',
    name: 'WNBA.com',
    kind: 'official',
    tier: 'official',
    home_url: 'https://www.wnba.com/news',
    feed_url: 'https://www.wnba.com/news',
    format: 'wnba_platform',
    wnba_scope: 'wnba_only',
    reliability: 'authoritative for league announcements',
    timestamp_quality: 'exact_utc',
    conditional: 'ETag sent but If-None-Match ignored (always 200); deduped by post id',
    rights: 'Official league site. Headline, link, excerpt, timestamps; no body text, no images. WNBA.com terms of use apply (see audit).',
    summary_policy: 'publisher_excerpt',
    attribution: 'WNBA.com (official)',
    priority: 1,
    failure_behavior: 'Source marked FAIL; last-good items stay.',
    cadence_min: 3 * 24 * 60,
    usage_policy: 'Official league news: headline, link, excerpt, timestamps. No body text, no images.',
    policy_status: 'review_required',
    policy_note: REVIEW_NOTE
  },
  {
    source_id: 'wnba_com_press',
    name: 'WNBA.com press releases',
    kind: 'official',
    tier: 'official',
    home_url: 'https://www.wnba.com/news/category/press-release',
    feed_url: 'https://www.wnba.com/news/category/press-release',
    format: 'wnba_platform',
    wnba_scope: 'wnba_only',
    reliability: 'authoritative: league press releases (awards, discipline, schedule, league office)',
    timestamp_quality: 'exact_utc',
    conditional: 'none honoured; deduped by post id',
    rights: 'Official league press releases. Headline, link, excerpt, timestamps only.',
    summary_policy: 'publisher_excerpt',
    attribution: 'WNBA.com (official press release)',
    priority: 1,
    failure_behavior: 'Source marked FAIL; last-good items stay.',
    cadence_min: 14 * 24 * 60,
    usage_policy: 'Official league press releases: headline, link, excerpt, timestamps.',
    policy_status: 'review_required',
    policy_note: REVIEW_NOTE
  },
  // ---------------------------------------------------------------- official teams (all 15)
  team('aces', 'Las Vegas Aces'),
  team('dream', 'Atlanta Dream'),
  team('fever', 'Indiana Fever'),
  team('fire', 'Portland Fire'),
  team('liberty', 'New York Liberty'),
  team('lynx', 'Minnesota Lynx'),
  team('mystics', 'Washington Mystics'),
  team('sky', 'Chicago Sky'),
  team('sparks', 'Los Angeles Sparks'),
  team('storm', 'Seattle Storm'),
  team('sun', 'Connecticut Sun'),
  team('tempo', 'Toronto Tempo'),
  team('valkyries', 'Golden State Valkyries'),
  team('wings', 'Dallas Wings'),
  // Mercury's news list renders client-side (0 posts in server HTML), so the only official structured surface is
  // the team's Google News sitemap: 304-capable, but rebuilt about once a day with date-only timestamps.
  team('mercury', 'Phoenix Mercury', {
    home_url: 'https://mercury.wnba.com/latest-news',
    feed_url: 'https://www.wnba.com/sitemap_team_mercury_news.xml',
    format: 'news_sitemap',
    timestamp_quality: 'date_only',
    conditional: 'If-Modified-Since → 304',
    rights: 'Official team news sitemap: title, link and publication date only.',
    cadence_min: 3 * 24 * 60,
    min_interval_min: 60,
    failure_behavior: 'Daily-rebuilt sitemap: date-only items can corroborate an event but never create a new story on their own.'
  }),

  // ---------------------------------------------------------------- national / provider
  {
    source_id: 'espn_wnba',
    name: 'ESPN',
    kind: 'provider_api',
    tier: 'national',
    home_url: 'https://www.espn.com/wnba/',
    feed_url: 'https://site.web.api.espn.com/apis/site/v2/sports/basketball/wnba/news?limit=50',
    format: 'espn_json',
    wnba_scope: 'league_scoped_filter_required',
    reliability: 'national reporting; structured athlete/team tags',
    timestamp_quality: 'exact_utc',
    conditional: 'none',
    rights: 'Headline, link, ESPN-supplied description and tags. No body text. Links open on espn.com.',
    summary_policy: 'publisher_excerpt',
    attribution: 'ESPN',
    priority: 2,
    failure_behavior: 'Source marked FAIL; last-good items stay.',
    cadence_min: 24 * 60,
    usage_policy: 'Headline, link, ESPN-supplied description and tags. No body text. Links open on espn.com.'
  },
  {
    source_id: 'nbc_sports_wnba',
    name: 'NBC Sports',
    kind: 'external_publisher',
    tier: 'national',
    home_url: 'https://www.nbcsports.com/wnba',
    feed_url: 'https://www.nbcsports.com/wnba.atom',
    format: 'rss',
    wnba_scope: 'wnba_section',
    reliability: 'national reporting',
    timestamp_quality: 'exact_utc (published + updated)',
    conditional: 'none',
    rights: 'Atom headline, link, summary. No body text.',
    summary_policy: 'publisher_excerpt',
    attribution: 'NBC Sports',
    priority: 2,
    failure_behavior: 'Source marked FAIL; last-good items stay.',
    cadence_min: 3 * 24 * 60,
    usage_policy: 'Feed headline, link, summary. No body text.'
  },
  {
    source_id: 'cbs_wnba',
    name: 'CBS Sports',
    kind: 'external_publisher',
    tier: 'national',
    home_url: 'https://www.cbssports.com/wnba/',
    feed_url: 'https://www.cbssports.com/rss/headlines/wnba/',
    format: 'rss',
    wnba_scope: 'mixed_filter_required',
    reliability: 'national reporting; feed carries non-WNBA items (NFL newsletters) — relevance gate filters',
    timestamp_quality: 'exact_tz',
    conditional: 'none',
    rights: 'RSS headline, link, description. No body text.',
    summary_policy: 'publisher_excerpt',
    attribution: 'CBS Sports',
    priority: 3,
    failure_behavior: 'Source marked FAIL; last-good items stay.',
    cadence_min: 24 * 60,
    usage_policy: 'RSS headline, link, description. No body text.'
  },
  {
    source_id: 'jws_wnba',
    name: 'Just Women’s Sports',
    kind: 'external_publisher',
    tier: 'womens_media',
    home_url: 'https://justwomenssports.com/category/wnba/',
    feed_url: 'https://justwomenssports.com/category/wnba/feed/',
    format: 'rss',
    wnba_scope: 'wnba_section',
    reliability: 'women’s sports newsroom; national reporting and features',
    timestamp_quality: 'exact_utc',
    conditional: 'ETag + Last-Modified → 304',
    rights: 'RSS headline, link, short description. The feed also carries full bodies; they are never read past the description.',
    summary_policy: 'publisher_excerpt',
    attribution: 'Just Women’s Sports',
    priority: 3,
    failure_behavior: 'Source marked FAIL; last-good items stay.',
    cadence_min: 2 * 24 * 60,
    usage_policy: 'Feed headline, link, short description. No body text.'
  },
  {
    // The Next moved under The IX; its root feed is now multi-sport (PWHL, softball), so the WNBA category feed is used.
    source_id: 'the_ix',
    name: 'The IX (The Next)',
    kind: 'external_publisher',
    tier: 'womens_media',
    home_url: 'https://www.theixsports.com/category/wnba/',
    feed_url: 'https://www.theixsports.com/category/wnba/feed/',
    format: 'rss',
    wnba_scope: 'wnba_section',
    reliability: 'women’s basketball newsroom; reporting and analysis',
    timestamp_quality: 'exact_utc',
    conditional: 'ETag + Last-Modified sent (304 not observed)',
    rights: 'RSS headline, link, description, publisher tags. No body text.',
    summary_policy: 'publisher_excerpt',
    attribution: 'The IX',
    priority: 3,
    failure_behavior: 'Source marked FAIL; last-good items stay.',
    cadence_min: 2 * 24 * 60,
    usage_policy: 'RSS headline, link, description, publisher tags. No body text.'
  },
  // ---------------------------------------------------------------- local beat
  {
    source_id: 'lvrj_aces',
    name: 'Las Vegas Review-Journal',
    kind: 'external_publisher',
    tier: 'local_beat',
    home_url: 'https://www.reviewjournal.com/sports/aces/',
    feed_url: 'https://www.reviewjournal.com/sports/aces/feed/',
    format: 'rss',
    wnba_scope: 'team_beat',
    team: { name: 'Las Vegas Aces' },
    reliability: 'Aces beat reporting; AP wire copies are skipped (attribution belongs to AP)',
    timestamp_quality: 'exact_utc',
    conditional: 'none (dynamic 200)',
    rights: 'RSS headline, link, description. AP-tagged items are not ingested.',
    summary_policy: 'publisher_excerpt',
    exclude_tags: ['AP'],
    attribution: 'Las Vegas Review-Journal',
    priority: 3,
    failure_behavior: 'Source marked FAIL; last-good items stay.',
    cadence_min: 4 * 24 * 60,
    usage_policy: 'Feed headline, link, description. No body text; AP wire items skipped.'
  },
  {
    source_id: 'nypost_liberty',
    name: 'New York Post',
    kind: 'external_publisher',
    tier: 'local_beat',
    home_url: 'https://nypost.com/new-york-liberty/',
    feed_url: 'https://nypost.com/new-york-liberty/feed/',
    format: 'rss',
    wnba_scope: 'mixed_filter_required',
    team: { name: 'New York Liberty' },
    reliability: 'Liberty beat; feed occasionally carries other teams — relevance gate filters',
    timestamp_quality: 'exact_tz',
    conditional: 'ETag/Last-Modified → 304',
    rights: 'Headline and link only (publisher robots opt out of automated reuse).',
    summary_policy: 'none',
    attribution: 'New York Post',
    priority: 3,
    failure_behavior: 'Source marked FAIL; last-good items stay.',
    cadence_min: 4 * 24 * 60,
    usage_policy: 'Headline and link only.'
  },
  {
    source_id: 'latimes_sparks',
    name: 'Los Angeles Times',
    kind: 'external_publisher',
    tier: 'local_beat',
    home_url: 'https://www.latimes.com/sports/sparks',
    feed_url: 'https://www.latimes.com/sports/sparks/rss2.0.xml',
    format: 'rss',
    wnba_scope: 'team_beat',
    team: { name: 'Los Angeles Sparks' },
    reliability: 'Sparks beat (low volume)',
    timestamp_quality: 'exact_gmt',
    conditional: 'none',
    rights: 'Headline and link only (publisher robots opt out of automated reuse).',
    summary_policy: 'none',
    attribution: 'Los Angeles Times',
    priority: 3,
    failure_behavior: 'Source marked FAIL; last-good items stay.',
    cadence_min: 14 * 24 * 60,
    usage_policy: 'Headline and link only.'
  },
  // ---------------------------------------------------------------- analysis / fan
  {
    source_id: 'high_post_hoops',
    name: 'High Post Hoops',
    kind: 'external_publisher',
    tier: 'analysis',
    home_url: 'https://highposthoops.com/',
    feed_url: 'https://highposthoops.com/feed',
    format: 'rss',
    wnba_scope: 'wnba_section',
    reliability: 'analysis and fan-site reporting; opinion is common — materiality gate discounts it',
    timestamp_quality: 'exact_utc',
    conditional: 'Last-Modified → 304',
    rights: 'RSS headline, link, short description. Tracking parameters stripped.',
    summary_policy: 'publisher_excerpt',
    attribution: 'High Post Hoops',
    priority: 4,
    failure_behavior: 'Source marked FAIL; last-good items stay.',
    cadence_min: 2 * 24 * 60,
    usage_policy: 'Feed headline, link, short description. No body text.'
  },
  {
    source_id: 'swish_appeal',
    name: 'Swish Appeal',
    kind: 'external_publisher',
    tier: 'analysis',
    home_url: 'https://www.swishappeal.com/',
    feed_url: 'https://www.swishappeal.com/rss/index.xml',
    format: 'rss',
    wnba_scope: 'mixed_filter_required',
    reliability: 'analysis and features',
    timestamp_quality: 'exact_tz',
    conditional: 'none',
    rights: 'Feed headline, link, summary. No body text.',
    summary_policy: 'publisher_excerpt',
    attribution: 'Swish Appeal',
    priority: 4,
    failure_behavior: 'Source marked FAIL; last-good items stay.',
    cadence_min: 3 * 24 * 60,
    usage_policy: 'Feed headline, link, summary. No body text.'
  },
  {
    source_id: 'winsidr',
    name: 'Winsidr',
    kind: 'external_publisher',
    tier: 'analysis',
    home_url: 'https://winsidr.com/',
    feed_url: 'https://winsidr.com/feed/',
    format: 'rss',
    wnba_scope: 'wnba_section',
    reliability: 'analysis (low volume)',
    timestamp_quality: 'exact_utc',
    conditional: 'Last-Modified → 304',
    rights: 'Feed headline, link, short description. No body text.',
    summary_policy: 'publisher_excerpt',
    attribution: 'Winsidr',
    priority: 4,
    failure_behavior: 'Source marked FAIL; last-good items stay.',
    cadence_min: 7 * 24 * 60,
    usage_policy: 'Feed headline, link, short description. No body text.'
  },
  {
    source_id: 'her_hoop_stats',
    name: 'Her Hoop Stats',
    kind: 'external_publisher',
    tier: 'analysis',
    home_url: 'https://herhoopstats.substack.com/',
    feed_url: 'https://herhoopstats.substack.com/feed',
    format: 'rss',
    wnba_scope: 'mixed_filter_required',
    reliability: 'statistical analysis (college + WNBA); low WNBA volume',
    timestamp_quality: 'exact_gmt',
    conditional: 'none',
    rights: 'Feed headline, link, subtitle. No body text.',
    summary_policy: 'publisher_excerpt',
    attribution: 'Her Hoop Stats',
    priority: 4,
    failure_behavior: 'Source marked FAIL; last-good items stay.',
    cadence_min: 14 * 24 * 60,
    usage_policy: 'Feed headline, link, subtitle. No body text.'
  }
];

/** Candidates probed and deliberately not ingested (kept for the source-health page and the audit). */
/** Every source carries a policy status; anything not explicitly under review is approved. */
export const NEWS_SOURCES = REGISTRY.map((s) => ({ policy_status: 'approved', ...s }));
/** May an item from this source appear publicly or support a story? */
export const publicSource = (s) => Boolean(s) && (s.policy_status !== 'review_required' || PUBLIC_REVIEW_REQUIRED);
const BY_ID = new Map(NEWS_SOURCES.map((s) => [s.source_id, s]));
export const sourcePolicy = (sourceId) => BY_ID.get(sourceId)?.policy_status || 'approved';
export const publicItem = (it) => sourcePolicy(it?.source_id) !== 'review_required' || PUBLIC_REVIEW_REQUIRED;
const PUBLISHER_NAMES = new Set(NEWS_SOURCES.map((s) => s.name));
const REVIEW_NAMES = new Set(NEWS_SOURCES.filter((s) => s.policy_status === 'review_required').map((s) => s.name));
/**
 * A News Brief whose publisher reports all come from sources under policy review is withheld from every public surface
 * (index, desks, article URL, sitemaps, feeds) until the review resolves. Read-time and reversible: nothing is deleted.
 */
export const withheldBySourcePolicy = (card) => {
  if (PUBLIC_REVIEW_REQUIRED || card?.kind !== 'brief') return false;
  const reports = (card.sources || []).filter((n) => PUBLISHER_NAMES.has(n));
  return reports.length > 0 && reports.every((n) => REVIEW_NAMES.has(n));
};

export const AUDITED_NOT_INGESTED = [
  { source_id: 'seattle_times_storm', name: 'The Seattle Times', decision: 'rejected', reason: 'Storm feed answers 403 to Cloudflare Worker egress (200 from a residential probe); not fetchable from the runtime without a workaround, and its robots rules opt out of automated reuse.' },
  { source_id: 'athletic_wnba', name: 'The Athletic', decision: 'rejected', reason: 'Paywalled; NYT RSS terms prohibit commercial use without written permission.' },
  { source_id: 'ap_wnba', name: 'Associated Press', decision: 'rejected', reason: 'No public feed; robots disallow RSS paths. Requires a licence.' },
  { source_id: 'wnba_transactions_json', name: 'WNBA.com transactions JSON', decision: 'rejected', reason: 'CDN serves it only to browser user agents; fetching it would require a disguised UA.' },
  { source_id: 'wnbpa', name: 'WNBPA', decision: 'rejected', reason: 'No news section or feed.' },
  { source_id: 'usab', name: 'USA Basketball', decision: 'deferred', reason: 'No feed; article sitemap only. International results come from the structured international layer.' },
  { source_id: 'yahoo_wnba', name: 'Yahoo Sports', decision: 'audit_only', reason: 'Aggregates other publishers’ full articles; duplicates originals.' },
  { source_id: 'clutchpoints_wnba', name: 'ClutchPoints', decision: 'audit_only', reason: 'High volume, mostly aggregation/opinion; robots opt out of automated reuse.' },
  { source_id: 'essentiallysports_wnba', name: 'EssentiallySports', decision: 'audit_only', reason: 'Gossip/aggregation, republished verbatim by other aggregators.' },
  { source_id: 'yardbarker_wnba', name: 'Yardbarker', decision: 'rejected', reason: 'Republishes other publishers; pure duplication.' },
  { source_id: 'fox_wnba', name: 'FOX Sports', decision: 'rejected', reason: 'Feed requires an embedded partner key; stale and mixed-sport.' },
  { source_id: 'si_wnba', name: 'Sports Illustrated', decision: 'rejected', reason: 'No working WNBA feed.' }
];

export const PBE_SOURCE = {
  source_id: 'pbe_desk',
  name: 'PropBetEdge WNBA Desk',
  kind: 'owned',
  usage_policy: 'Written by the deterministic PBE generator from structured source records cited in each story’s evidence.',
  attribution: 'PropBetEdge WNBA Desk · automated from cited records',
  wnba_scope: 'wnba_only'
};

export const SOURCE_REGISTRY_VERSION = 'news-sources/2.1.0';
export const SOURCE_UA_NOTE = UA_NOTE;
