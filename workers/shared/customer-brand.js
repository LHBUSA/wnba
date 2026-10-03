// Customer source boundary (PropBetEdge network standard "DATA · PropSports"; reference LHBUSA/golf 43c4677).
// Facts supplied by an upstream collection lane are attributed to PropSports on customer surfaces and in public
// JSON. Upstream lineage stays in KV/R2 captures, ingest, admin/debug, /v1/sources and the trust page.
// Kept on purpose: named publishers of reporting (publisher_report evidence, the /v1/news wire), sportsbook names
// (e.g. ESPN BET), photo credits ("Photo: ESPN" hotlinked headshots, Commons licences) and licence credits.
// Applied at serving time (wnba-api envelope, wnba-news public article routes) so stored, hashed articles and
// packets are never rewritten; generator templates are also neutral for new stories.

const A = "(?:’|')";
const LOG_NOUNS = 'box scores?|box score and play-by-play|box score and linescore|game logs?|game results|game record|linescore|play-by-play|event stream|standings|schedules?|team schedules?|team schedule|team totals|season leaders list|athlete record|public data';
const RULES = [
  [/\bwnba-api matchup research \(ESPN ([^)]*)\)/g, 'PBE matchup research ($1)'],
  [/\bwnba-api matchup research\b/g, 'PBE matchup research'],
  [new RegExp(String.raw`\bESPN${A}s (?:WNBA )?injury feed\b`, 'g'), 'the observed injury report'],
  [new RegExp(String.raw`\bESPN${A}s (?:WNBA )?transactions log\b`, 'g'), 'the observed transactions log'],
  [new RegExp(String.raw`\bESPN${A}s injury note\b`, 'g'), 'the injury note'],
  [new RegExp(String.raw`\bThat date is ESPN${A}s\b`, 'g'), 'That date is the provider’s'],
  [new RegExp(String.raw`\bStatus is ESPN${A}s\b`, 'g'), 'Status is the provider’s'],
  [new RegExp(String.raw`\bESPN${A}s (status|listing|feed|primary|own)\b`, 'g'), 'the provider $1'],
  [new RegExp(String.raw`\bESPN${A}s\b`, 'g'), 'the observed'],
  [/, as relayed by ESPN,/g, ''],
  [/ \(relayed by ESPN\)/g, ''],
  [/,? (?:as )?relayed by ESPN\b/g, ''],
  [/, via ESPN,/g, ','],
  [/ via ESPN\b/g, ''],
  [/\bRelayed by ESPN from one sportsbook\b/g, 'One sportsbook’s line'],
  [/ESPN injury feed \(provider(?: data)?\)/g, 'PropSports injury feed (provider data)'],
  [/\bESPN (?:WNBA )?(injury feed|transactions log)\b/g, 'PropSports $1'],
  [new RegExp(String.raw`\b(?:the )?ESPN (${LOG_NOUNS})\b`, 'g'), 'PropSports $1'],
  [/\(ESPN provider record\)/g, '(provider record)'],
  [/(^|[^\w’'])ESPN now (lists|shows)\b/g, '$1the observed injury report now $2'],
  [/ \(ESPN season team stats\)/g, ' (season team stats)'],
  [/\bESPN regular-season game(\(s\)|s)?\b/g, 'regular-season game$1'],
  [/(?<!\ban )\bESPN (season team stats|scoreboard|postseason events|injury|status)\b/g, 'provider $1'],
  [/(^|[^\w’'])ESPN (lists|listed)\b/g, '$1the observed injury report $2'],
  [/\ban ESPN (estimated return|return estimate|injury update|injury status|injury)\b/g, 'a provider $1'],
  [/\bESPN (estimated return|return estimate|injury update|injury status|return date)\b/g, 'provider $1'],
  [/\bidentical ESPN athlete IDs\b/g, 'identical athlete IDs'],
  [/\bnumeric ESPN athlete id\b/g, 'numeric player id'],
  [/\(ESPN public data/g, '(PropSports data'],
  [/\bwhere ESPN published an on-court coordinate\b/g, 'with a published on-court coordinate'],
  [/\bCoordinates are ESPN basket-relative feet\b/g, 'Coordinates are basket-relative feet'],
  [/\bESPN play timestamps\b/g, 'play timestamps'],
  [/\(ESPN\)/g, ''],
  [/\(source: ESPN\)/g, ''],
  [/\bderived from ESPN box scores\b/g, 'derived from final box scores'],
  [/\bESPN publishes no bracket resource\b/g, 'no bracket resource is published upstream'],
  [/\bESPN \(PropBetEdge-derived bracket\)/g, 'PropSports (PropBetEdge-derived bracket)'],
  [/\bThe Odds API \(stored PropBetEdge snapshot\)/g, 'PropSports market snapshot'],
  [/\baggregated by The Odds API\b/g, 'aggregated by PropSports'],
  [/\bThe Odds API\b/g, 'PropSports market capture'],
  [/\bPublic ESPN JSON \([^)]*\)\./g, 'PropSports collection.'],
  [/\bespn_injuries_feed(?: via [a-z-]+(?: change ledger)?)?/g, 'PropSports injury feed'],
  [/\bespn_transactions(?: via [a-z-]+(?: change ledger)?)?/g, 'PropSports transactions log'],
  [/\bespn_summary(?: via [a-z-]+)?/g, 'PropSports game record'],
  [/\bespn_[a-z_]+ via [a-z-]+(?: change ledger)?/g, 'PropSports data'],
];
// Sportsbook / broadcaster names that merely contain the provider word stay untouched.
const PROTECT = /\bESPN ?BET\b|\bESPN\+|\bESPN2\b|\bESPNU\b/g;

export const DATA_BRAND = 'PropSports';
export const DATA_LINE = 'DATA · PropSports';

/** Map one human-readable string to its customer form (idempotent). */
export function customerText(input) {
  if (typeof input !== 'string' || !/espn|odds api|wnba-api/i.test(input)) return input;
  const kept = [];
  let s = input.replace(PROTECT, (m) => { kept.push(m); return `\u0000${kept.length - 1}\u0000`; });
  for (const [re, to] of RULES) s = s.replace(re, to);
  s = s.replace(/(^|[.!?]\s+|[“"]\s*)the (observed|provider|injury note)/g, (m, p, w) => `${p}The ${w}`)
    .replace(/PropSports(?:,? PropSports)+/g, 'PropSports')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => kept[Number(i)]);
}
/** Back-compat name used by the SPA (injury labels etc.): always a string. */
export const customerSource = (text) => customerText(String(text || ''));

const SKIP_KEYS = new Set(['url', 'href', 'link', 'links', 'source_url', 'source_urls', 'image', 'images', 'photo', 'photos', 'headshot',
  'media', 'credit', 'credits', 'publisher', 'id', 'slug', 'kv_key', 'kvKey', 'hash', 'content_hash', 'archive_signature', 'source_hash']);
// Raw upstream API endpoints are infrastructure, not citations; publisher article links stay.
const UPSTREAM_API = /^https?:\/\/(?:site\.web\.api|site\.api|sports\.core\.api|cdn)\.espn\.com\//i;

/**
 * Deep-map a public JSON body. Objects that are publisher reports, photo/licence records or provenance registries
 * pass through unchanged. Identifier values (no spaces) are left alone: legacy enum values are a compatibility
 * matter handled field-by-field with neutral aliases.
 */
export function customerDoc(v) {
  if (Array.isArray(v)) return v.map(customerDoc);
  if (!v || typeof v !== 'object') return v === 'ESPN' ? DATA_BRAND : typeof v === 'string' && /\s/.test(v) ? customerText(v) : v;
  if (v.kind === 'publisher_report' || 'rights' in v || 'licence' in v || 'license' in v) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (SKIP_KEYS.has(k)) {
      if (k === 'url' && typeof x === 'string' && UPSTREAM_API.test(x) && v.kind !== 'publisher_report') continue;
      out[k] = x;
      continue;
    }
    out[k] = customerDoc(x);
  }
  return out;
}
