// Source fetching and source health for the WNBA newsroom — wnba-news-fetch/1.0.0.
//
// * Conditional requests: the ETag / Last-Modified a source last returned are replayed as If-None-Match /
//   If-Modified-Since. A 304 is a successful poll with nothing new — not a failure, and it costs no parse. Validators
//   are tied to the parser version, so a parser change re-reads every source once.
// * Sources declaring `min_interval_min` (a daily-rebuilt sitemap) are not re-polled inside that interval.
// * One source failing never affects another: every fetch is isolated and the last-good items stay in the store.
// * Health is kept per source across runs: last attempt, last success, HTTP status, fetched / accepted / rejected,
//   new items, new events, duplicates, parse errors, timestamp quality, staleness.

import { parseRss, parseEspnNews, parseWnbaPlatform, parseNewsSitemap, PARSE_VERSION } from './parse.js';

export const FETCH_VERSION = 'wnba-news-fetch/1.0.0';
export const UA = 'PropBetEdge-WNBA-News/1.0 (+https://wnba.propbetedge.ai/news)';
const TIMEOUT_MS = 12000;

const ACCEPT = {
  espn_json: 'application/json',
  wnba_platform: 'text/html',
  news_sitemap: 'application/xml, text/xml',
  rss: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8'
};

export function parseBody(src, text, { now = Date.now() } = {}) {
  if (src.format === 'espn_json') return parseEspnNews(JSON.parse(text));
  if (src.format === 'wnba_platform') return parseWnbaPlatform(text, { excerpts: src.summary_policy !== 'none' });
  if (src.format === 'news_sitemap') return parseNewsSitemap(text, { now });
  return parseRss(text);
}

/**
 * Fetch one source. `validators` is the stored { etag, last_modified, parser, at } for this source.
 * Returns { status: PASS | NOT_MODIFIED | SKIPPED | DEGRADED | FAIL, http_status, items, validators, error, ms }.
 */
export async function fetchSource(src, { validators = null, now = Date.now(), fetchImpl = fetch } = {}) {
  const started = Date.now();
  if (src.min_interval_min && validators?.at && now - Date.parse(validators.at) < src.min_interval_min * 60e3) {
    return { status: 'SKIPPED', http_status: null, items: [], validators, ms: 0, reason: `polled within ${src.min_interval_min} min` };
  }
  const headers = { 'user-agent': UA, accept: ACCEPT[src.format] || ACCEPT.rss };
  const usable = validators && validators.parser === PARSE_VERSION;
  if (usable && validators.etag) headers['if-none-match'] = validators.etag;
  if (usable && validators.last_modified) headers['if-modified-since'] = validators.last_modified;
  let res;
  try {
    res = await fetchImpl(src.feed_url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  } catch (e) {
    return { status: 'FAIL', http_status: null, items: [], validators, error: `fetch_${e.name === 'TimeoutError' ? 'timeout' : 'error'}: ${e.message}`.slice(0, 200), ms: Date.now() - started };
  }
  const nextValidators = { etag: res.headers.get('etag') || (usable ? validators.etag : null), last_modified: res.headers.get('last-modified') || (usable ? validators.last_modified : null), parser: PARSE_VERSION, at: new Date(now).toISOString() };
  if (res.status === 304) return { status: 'NOT_MODIFIED', http_status: 304, items: [], validators: { ...nextValidators, etag: validators?.etag || nextValidators.etag, last_modified: validators?.last_modified || nextValidators.last_modified }, ms: Date.now() - started };
  const text = await res.text().catch(() => '');
  if (!res.ok) return { status: 'FAIL', http_status: res.status, items: [], validators, error: `http_${res.status}`, ms: Date.now() - started };
  let items;
  try {
    items = parseBody(src, text, { now });
  } catch (e) {
    return { status: 'FAIL', http_status: res.status, items: [], validators, error: `parse_error: ${e.message}`.slice(0, 200), parse_errors: 1, ms: Date.now() - started };
  }
  // A news sitemap with entries but none inside the recency window is a quiet publisher, not a broken source.
  const quietSitemap = !items.length && src.format === 'news_sitemap' && /<url>/i.test(text);
  if (quietSitemap) return { status: 'PASS', http_status: res.status, items, validators: nextValidators, ms: Date.now() - started, reason: 'no sitemap entries inside the recency window' };
  return { status: items.length ? 'PASS' : 'DEGRADED', http_status: res.status, items, validators: nextValidators, ms: Date.now() - started, ...(items.length ? {} : { error: 'parsed_zero_items' }) };
}

/** Run `fn` over `list` with at most `limit` in flight; results keep input order. */
export async function pool(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  const worker = async () => { while (next < list.length) { const i = next; next += 1; out[i] = await fn(list[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

const ms = (x) => { const v = Date.parse(x || ''); return Number.isFinite(v) ? v : null; };

/** Merge one run into the persistent health record for a source. */
export function updateHealth(prev, src, run, { now = Date.now(), cronMinutes = 5 } = {}) {
  const at = new Date(now).toISOString();
  const ok = ['PASS', 'NOT_MODIFIED', 'DEGRADED'].includes(run.status);
  const h = {
    source_id: src.source_id,
    name: src.name,
    tier: src.tier || null,
    format: src.format,
    last_attempt_at: run.status === 'SKIPPED' ? prev?.last_attempt_at || null : at,
    last_success_at: ok ? at : prev?.last_success_at || null,
    last_status: run.status,
    http_status: run.http_status ?? prev?.http_status ?? null,
    consecutive_failures: run.status === 'FAIL' ? (prev?.consecutive_failures || 0) + 1 : run.status === 'SKIPPED' ? prev?.consecutive_failures || 0 : 0,
    error: run.status === 'FAIL' || run.status === 'DEGRADED' ? run.error || null : null,
    last_run: { fetched: run.fetched || 0, accepted: run.accepted || 0, rejected: run.rejected || 0, new_items: run.new || 0, new_events: run.new_events || 0, duplicates: run.duplicates_url || 0, joined_existing_events: run.joined_events || 0, parse_errors: run.parse_errors || 0, outside_window: run.outside_window || 0, ms: run.ms ?? null },
    totals_24h: rollup(prev?.totals_24h, run, now),
    timestamp_quality: run.timestamp_quality || prev?.timestamp_quality || null,
    latest_item_at: [prev?.latest_item_at, run.latest_item_at].filter((x) => ms(x) !== null).sort((a, b) => ms(b) - ms(a))[0] || null,
    conditional: run.status === 'NOT_MODIFIED' ? '304 honoured' : prev?.conditional || null
  };
  const sinceSuccess = h.last_success_at ? now - ms(h.last_success_at) : Infinity;
  const sinceItem = h.latest_item_at ? now - ms(h.latest_item_at) : Infinity;
  const pollBudget = Math.max(cronMinutes * 3, src.min_interval_min ? src.min_interval_min * 2 : 0) * 60e3;
  h.staleness = sinceSuccess > pollBudget ? 'STALE_FETCH' : sinceItem > (src.cadence_min || 7 * 24 * 60) * 60e3 ? 'QUIET' : 'CURRENT';
  h.staleness_note = h.staleness === 'STALE_FETCH' ? 'No successful poll inside three cron cycles.' : h.staleness === 'QUIET' ? 'Polling works; the publisher has not posted inside its usual cadence.' : 'Polling on schedule.';
  return h;
}

// 24-hour rolling totals in hourly buckets (24 entries max).
function rollup(prev, run, now) {
  const hour = Math.floor(now / 3600e3);
  const buckets = (prev?.buckets || []).filter((b) => b.h > hour - 24);
  let b = buckets.find((x) => x.h === hour);
  if (!b) { b = { h: hour, attempts: 0, failures: 0, fetched: 0, accepted: 0, new_items: 0, new_events: 0, not_modified: 0 }; buckets.push(b); }
  if (run.status !== 'SKIPPED') b.attempts += 1;
  if (run.status === 'FAIL') b.failures += 1;
  if (run.status === 'NOT_MODIFIED') b.not_modified += 1;
  b.fetched += run.fetched || 0;
  b.accepted += run.accepted || 0;
  b.new_items += run.new || 0;
  b.new_events += run.new_events || 0;
  const sum = (k) => buckets.reduce((a, x) => a + (x[k] || 0), 0);
  return { buckets, attempts: sum('attempts'), failures: sum('failures'), not_modified: sum('not_modified'), fetched: sum('fetched'), accepted: sum('accepted'), new_items: sum('new_items'), new_events: sum('new_events') };
}
