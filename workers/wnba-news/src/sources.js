// WNBA newsroom source registry. Every source was canaried on 2026-09-11 and
// its scope recorded honestly: several "WNBA" feeds are NOT WNBA-only (the CBS
// WNBA RSS carried an NFL story in the canary), so they pass through the
// relevance gate like any mixed source.
//
// Rights: external items are stored as headline + link + publisher-supplied
// summary + metadata. We never store or render article bodies.

export const NEWS_SOURCES = [
  {
    source_id: 'espn_wnba',
    name: 'ESPN',
    kind: 'provider_api',
    home_url: 'https://www.espn.com/wnba/',
    feed_url: 'https://site.web.api.espn.com/apis/site/v2/sports/basketball/wnba/news?limit=50',
    format: 'espn_json',
    wnba_scope: 'league_scoped_filter_required',
    usage_policy: 'Headline, link, ESPN-supplied description and tags. No body text. Links open on espn.com.',
    attribution: 'ESPN',
    priority: 2
  },
  {
    source_id: 'wnba_com',
    name: 'WNBA.com',
    kind: 'official',
    home_url: 'https://www.wnba.com/news',
    feed_url: 'https://www.wnba.com/news',
    format: 'wnba_next_data',
    wnba_scope: 'wnba_only',
    usage_policy: 'Official league news: headline, link, excerpt, timestamps. No body text, no images.',
    attribution: 'WNBA.com (official)',
    priority: 1
  },
  {
    source_id: 'cbs_wnba',
    name: 'CBS Sports',
    kind: 'external_publisher',
    home_url: 'https://www.cbssports.com/wnba/',
    feed_url: 'https://www.cbssports.com/rss/headlines/wnba/',
    format: 'rss',
    wnba_scope: 'mixed_filter_required',
    usage_policy: 'RSS headline, link, description. No body text.',
    attribution: 'CBS Sports',
    priority: 3
  },
  {
    source_id: 'the_ix',
    name: 'The IX (The Next)',
    kind: 'external_publisher',
    home_url: 'https://www.thenexthoops.com/',
    feed_url: 'https://www.thenexthoops.com/feed/',
    format: 'rss',
    wnba_scope: 'mixed_filter_required',
    usage_policy: 'RSS headline, link, description, publisher tags. No body text.',
    attribution: 'The IX',
    priority: 3
  },
  {
    source_id: 'swish_appeal',
    name: 'Swish Appeal',
    kind: 'external_publisher',
    home_url: 'https://www.swishappeal.com/',
    feed_url: 'https://www.swishappeal.com/rss/current.xml',
    format: 'rss',
    wnba_scope: 'mixed_filter_required',
    usage_policy: 'Feed headline, link, summary. No body text.',
    attribution: 'Swish Appeal',
    priority: 4
  },
  {
    source_id: 'her_hoop_stats',
    name: 'Her Hoop Stats',
    kind: 'external_publisher',
    home_url: 'https://herhoopstats.substack.com/',
    feed_url: 'https://herhoopstats.substack.com/feed',
    format: 'rss',
    wnba_scope: 'mixed_filter_required',
    usage_policy: 'Feed headline, link, subtitle. No body text.',
    attribution: 'Her Hoop Stats',
    priority: 4
  }
];

export const PBE_SOURCE = {
  source_id: 'pbe_desk',
  name: 'PropBetEdge WNBA Desk',
  kind: 'owned',
  usage_policy: 'Written by the deterministic PBE generator from structured source records cited in each story’s evidence.',
  attribution: 'PropBetEdge WNBA Desk · automated from cited records',
  wnba_scope: 'wnba_only'
};
