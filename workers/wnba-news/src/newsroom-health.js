// Newsroom health — one response that answers "why haven't we published anything new?".
// Pure: built from what the Worker already stores (news:v1:status, news:v1:runs, art:v1:last_run, art:v1:index,
// art:v1:held). No secrets, no provider payloads.

import { listedCard } from './legacy.js';

export const NEWSROOM_HEALTH_VERSION = 'wnba-newsroom-health/1.0.0';
const HOUR = 3600e3;
const ms = (x) => { const v = Date.parse(x || ''); return Number.isFinite(v) ? v : null; };
const ageH = (iso, now) => (ms(iso) === null ? null : Math.round(((now - ms(iso)) / HOUR) * 10) / 10);
const origin = (c) => c.first_published_at || c.published_at || null;
const newest = (cards, pred) => cards.filter(pred).map(origin).filter(Boolean).sort().at(-1) || null;
const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);

/** Hold reasons, grouped by their rule (the text before the first quote/colon detail). */
function reasonGroups(held) {
  const out = {};
  for (const h of held || []) for (const f of h.failures || []) {
    const k = String(f).replace(/“.*$|".*$/, '').replace(/\d+(\.\d+)?/g, 'N').replace(/\s+/g, ' ').trim().slice(0, 90);
    out[k] = (out[k] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 12));
}

export function newsroomHealthReport({ status = null, runs = [], lastRun = null, index = [], held = [], now = Date.now(), mediaFor = null, cronMinutes = 5, articleGapMin = 10 }) {
  const live = index.filter(listedCard);
  // Genuinely new stories: minted in the window, not collapsed as a duplicate, not late coverage retired on arrival.
  const within = (h) => index.filter((c) => !c.duplicate_of && !c.quality_review?.late_coverage && ms(origin(c)) !== null && now - ms(origin(c)) <= h * HOUR);
  const revisedWithin = (h) => index.filter((c) => ms(c.revised_at) !== null && now - ms(c.revised_at) <= h * HOUR);

  // --- sources
  const srcs = status?.sources || [];
  const newestItem = srcs.map((s) => s.latest_item_at).filter(Boolean).sort().at(-1) || null;
  const source = {
    last_poll_at: status?.at || null,
    last_poll_age_min: status?.at ? Math.round((now - ms(status.at)) / 60e3) : null,
    cadence_min: cronMinutes,
    sources_total: srcs.length,
    sources_ok: srcs.filter((s) => ['PASS', 'NOT_MODIFIED', 'SKIPPED'].includes(s.status)).length,
    sources_failed: srcs.filter((s) => !['PASS', 'NOT_MODIFIED', 'SKIPPED'].includes(s.status)).map((s) => ({ source_id: s.source_id, status: s.status, error: s.error || s.reason || null })),
    newest_source_item_at: newestItem
  };

  // --- events (last poll + the 48-run history)
  const hist = runs || [];
  const events = {
    last_poll: { created: status?.events?.created ?? null, joined: status?.events?.joined ?? null, breaking: (status?.events?.breaking || []).length },
    material_events_stored: status?.totals?.material_events ?? null,
    events_stored: status?.totals?.events ?? null,
    rejected_last_poll: srcs.reduce((s, r) => s + (r.rejected || 0), 0),
    runs_in_history: hist.length,
    created_in_history: hist.reduce((s, r) => s + (r.events?.created || 0), 0),
    breaking_in_history: hist.reduce((s, r) => s + ((r.events?.breaking || []).length), 0)
  };

  // --- articles
  const lr = lastRun || {};
  const novelty = lr.lifecycle?.novelty || null;
  const articles = {
    last_article_pass_at: lr.at || null,
    last_article_pass_age_min: lr.at ? Math.round((now - ms(lr.at)) / 60e3) : null,
    normal_gap_min: articleGapMin,
    trigger: lr.trigger || null,
    generator: lr.version || null,
    candidates_by_desk: lr.runs || null,
    generated: lr.produced ?? null,
    published_or_revised: lr.written ?? null,
    held: lr.held ?? null,
    hold_reasons: reasonGroups(held),
    held_stories: (held || []).slice(0, 20).map((h) => ({ kind: h.kind, headline: h.headline, reason: (h.failures || [])[0] || null })),
    novelty,
    editorial: lr.editorial || null,
    new_stories: { h6: within(6).length, h12: within(12).length, h24: within(24).length, h48: within(48).length, d7: within(168).length },
    revisions: { h24: revisedWithin(24).length, d7: revisedWithin(168).length },
    listed: live.length
  };

  // --- media (listed stories)
  const resolved = live.map((c) => (mediaFor ? mediaFor(c) : c.media)?.resolved || 'none');
  const count = (k) => resolved.filter((r) => r === k).length;
  const subject = count('approved_subject_photo') + count('approved_subject_photos');
  const media = {
    listed: live.length,
    subject_photo_pct: pct(subject, live.length),
    team_fallback_pct: pct(count('team_composition'), live.length),
    brand_fallback_pct: pct(count('deterministic_story_visual') + count('none'), live.length),
    international_scoreboard: count('deterministic_scoreboard'),
    unresolved_identity: index.filter((c) => !c.superseded_by && c.identity_audit && c.identity_audit.ok === false).length
  };

  // --- freshness
  const isKind = (...ks) => (c) => ks.includes(c.kind) && listedCard(c);
  const f = {
    newest_article_at: newest(index, (c) => listedCard(c)),
    newest_result_at: newest(index, isKind('result', 'performance')),
    newest_preview_at: newest(index, isKind('preview')),
    newest_injury_at: newest(index, (c) => listedCard(c) && (c.kind === 'injury' || (c.kind === 'brief' && /injur|availab/.test(`${c.event_type} ${c.desk}`)))),
    newest_transaction_at: newest(index, (c) => listedCard(c) && (c.kind === 'transaction' || (c.kind === 'brief' && /sign|waive|trade|roster|transaction/.test(`${c.event_type} ${c.desk}`))))
  };
  const freshness = Object.fromEntries(Object.entries(f).flatMap(([k, v]) => [[k, v], [k.replace(/_at$/, '_age_h'), ageH(v, now)]]));

  // --- the answer
  const why = [];
  if (source.last_poll_age_min !== null && source.last_poll_age_min > cronMinutes * 3) why.push(`source ingest has not run for ${source.last_poll_age_min} minutes (cron every ${cronMinutes})`);
  if (source.sources_failed.length) why.push(`${source.sources_failed.length} of ${source.sources_total} sources failing`);
  if (articles.last_article_pass_age_min !== null && articles.last_article_pass_age_min > articleGapMin * 3) why.push(`the article pass has not run for ${articles.last_article_pass_age_min} minutes`);
  if ((lr.errors || []).length) why.push(`the last article pass logged ${lr.errors.length} error(s)`);
  if (novelty && !novelty.new_story && articles.new_stories.h24 === 0) {
    if ((articles.held || 0) > 0) why.push(`no new story in 24h: ${articles.held} generated stories are held by the gates (top reason: ${Object.keys(articles.hold_reasons)[0] || 'n/a'})`);
    else if ((lr.produced || 0) === 0) why.push('no new story in 24h: the generators found no eligible material event (off day or nothing new in the records)');
    else why.push('no new story in 24h: every generated story is unchanged from what is already published (no new facts)');
  }
  return {
    version: NEWSROOM_HEALTH_VERSION,
    at: new Date(now).toISOString(),
    status: why.some((w) => /has not run|error/.test(w)) || source.sources_failed.length > Math.max(2, Math.round(source.sources_total * 0.1)) ? 'DEGRADED' : 'OK',
    why_nothing_new: why,
    source,
    events,
    articles,
    media,
    freshness
  };
}
