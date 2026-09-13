// Source-wire item normalization — pure, shared by the ingest Worker, the coverage audit and the tests.
//   fetched item → canonical URL → retention/rights filters → entity links (+ the source's own team) → relevance gate
//   → taxonomy (event type, lane, materiality) → stored record. Only headline, link, permitted summary, tags and
//   timestamps are kept.

import { canonicalUrl } from './parse.js';
import { linkEntities, relevance, itemId, norm, INTERNATIONAL } from './editorial.js';
import { classify } from './taxonomy.js';

export const KEEP_DAYS = 21;

/** Resolve the team an official team site / team beat source belongs to, from the live roster dictionary. */
export function sourceTeam(src, dict) {
  if (!src.team?.name) return null;
  const t = dict.teamByName.get(norm(src.team.name));
  return t ? { type: 'team', id: String(t.team_id), name: t.name, method: 'source_team' } : null;
}

/**
 * Normalize one fetched item into a stored source-wire record (or a rejection). Pure: used by the ingest loop and
 * by the coverage audit / tests.
 */
export async function normalizeItem(raw, src, dict, { startedAt, prev = null, now = Date.parse(startedAt) } = {}) {
  const canonical = canonicalUrl(raw.url);
  if (!canonical) return { reject: 'bad_url' };
  if (raw.published_at && Date.parse(raw.published_at) < now - KEEP_DAYS * 86400e3) return { reject: 'outside_window' };
  if ((src.exclude_tags || []).some((t) => (raw.tags || []).some((x) => String(x).trim().toLowerCase() === t.toLowerCase()))) return { reject: 'excluded_tag' };
  const id = await itemId(canonical);
  const summary = src.summary_policy === 'none' ? null : raw.summary || null;
  const item = { ...raw, summary };
  const entities = linkEntities(item, dict);
  const st = sourceTeam(src, dict);
  if (st && !entities.some((e) => e.type === 'team' && e.id === st.id)) entities.push(st);
  const rel = relevance(item, entities, src);
  const timestampQuality = raw.timestamp_quality === 'date_only' ? 'date_only' : raw.published_at ? 'publisher' : 'capture';
  const tax = classify(item, { entities, source: src, timestampQuality });
  const record = {
    item_id: id,
    source_id: src.source_id,
    source_name: src.name,
    source_kind: src.kind,
    source_tier: src.tier || null,
    attribution: src.attribution,
    priority: src.priority,
    canonical_url: canonical,
    headline: raw.headline,
    summary,
    byline: raw.byline,
    tags: (raw.tags || []).slice(0, 8),
    // An item with no publisher timestamp keeps its first capture time and is flagged: it can never pass as fresh news.
    published_at: raw.published_at || prev?.published_at || startedAt,
    timestamp_quality: timestampQuality,
    source_updated_at: raw.updated_at || null,
    first_captured_at: prev?.first_captured_at || startedAt,
    last_captured_at: startedAt,
    story_type: tax.story_type,
    event_type: tax.event_type,
    lane: tax.lane,
    materiality: tax.materiality,
    relevance: rel.score,
    relevance_reasons: rel.reasons,
    entities,
    rights: src.summary_policy === 'none' ? 'headline_link' : 'headline_link_summary'
  };
  return { id, record, rel, international: INTERNATIONAL.test(`${raw.headline} ${raw.summary || ''}`) };
}
