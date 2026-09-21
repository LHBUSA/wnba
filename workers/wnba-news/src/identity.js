// Newsroom identity integrity — deterministic subject/team/event coherence.
//
// A publisher cluster can mention several players and teams. These helpers decide
// who the event is actually about from headline consensus, bind a player only to
// her own roster team, and fail closed when a generated/stored story contradicts
// those identities.

import { eventType } from './taxonomy.js';

export const IDENTITY_VERSION = 'wnba-news-identity/1.0.0';

const norm = (s) => String(s || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[’‘`]/g, "'")
  .toLowerCase()
  .replace(/[^a-z0-9' ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const key = (e) => `${e?.type || ''}:${e?.id || ''}`;
const uniqEntities = (entities) => {
  const out = new Map();
  for (const e of entities || []) if (e?.type && e?.id && !out.has(key(e))) out.set(key(e), e);
  return [...out.values()];
};

function mentionPos(headline, name) {
  const h = ` ${norm(headline)} `;
  const n = norm(name);
  if (!n) return -1;
  const i = h.indexOf(` ${n} `);
  return i < 0 ? -1 : i;
}

/**
 * Select the player who is the grammatical/event subject across publisher
 * headlines. First-named support beats mere mentions. If a multi-player cluster
 * has no headline signal, return null rather than guessing from entity order.
 */
export function headlineConsensusPlayer(members, entities, { canonicalHeadline = null } = {}) {
  const players = uniqEntities(entities).filter((e) => e.type === 'player' && e.name);
  if (!players.length) return { player: null, support: 0, mentions: 0, scores: [] };
  if (players.length === 1) return { player: players[0], support: 1, mentions: 1, scores: [{ id: String(players[0].id), first: 1, mentions: 1, score: 111 }] };

  const rows = players.map((player) => ({ player, firstSources: new Set(), mentionSources: new Set(), first: 0, mentions: 0, canonicalFirst: 0, score: 0 }));
  for (const m of members || []) {
    const headline = String(m?.headline || '');
    const source = String(m?.source_id || m?.source_name || m?.publisher || m?.item_id || headline);
    const hits = rows.map((row) => ({ row, pos: mentionPos(headline, row.player.name) })).filter((x) => x.pos >= 0).sort((a, b) => a.pos - b.pos);
    if (!hits.length) continue;
    for (const hit of hits) hit.row.mentionSources.add(source);
    hits[0].row.firstSources.add(source);
  }
  if (canonicalHeadline) {
    const hits = rows.map((row) => ({ row, pos: mentionPos(canonicalHeadline, row.player.name) })).filter((x) => x.pos >= 0).sort((a, b) => a.pos - b.pos);
    if (hits.length) hits[0].row.canonicalFirst = 1;
  }
  for (const row of rows) {
    row.first = row.firstSources.size;
    row.mentions = row.mentionSources.size;
    row.score = row.first * 100 + row.mentions * 10 + row.canonicalFirst * 5;
  }
  rows.sort((a, b) => b.score - a.score || String(a.player.id).localeCompare(String(b.player.id)));
  const best = rows[0];
  if (!best?.mentions) return { player: null, support: 0, mentions: 0, scores: rows.map((r) => ({ id: String(r.player.id), first: r.first, mentions: r.mentions, score: r.score })) };
  if (rows[1] && rows[1].score === best.score) return { player: null, support: best.first, mentions: best.mentions, ambiguous: true, scores: rows.map((r) => ({ id: String(r.player.id), first: r.first, mentions: r.mentions, score: r.score })) };
  return { player: best.player, support: best.first, mentions: best.mentions, scores: rows.map((r) => ({ id: String(r.player.id), first: r.first, mentions: r.mentions, score: r.score })) };
}

/**
 * Cluster event type by publisher consensus first, then materiality. A single
 * contextual follow-up ("...as awards loom") cannot override three reports of
 * the concrete record event.
 */
export function consensusEventType(members) {
  const rows = new Map();
  for (const m of members || []) {
    const type = m?.event_type || eventType(m?.headline || '', { categories: m?.tags || [] });
    const source = String(m?.source_id || m?.source_name || m?.publisher || m?.item_id || m?.headline || '');
    const row = rows.get(type) || { type, sources: new Set(), members: 0, maxScore: -Infinity, earliest: Infinity };
    row.sources.add(source);
    row.members += 1;
    if (Number.isFinite(m?.materiality?.score)) row.maxScore = Math.max(row.maxScore, m.materiality.score);
    const at = Date.parse(m?.published_at || 0);
    if (Number.isFinite(at) && at > 0) row.earliest = Math.min(row.earliest, at);
    rows.set(type, row);
  }
  const ranked = [...rows.values()].map((r) => ({ ...r, publishers: r.sources.size }))
    .sort((a, b) => b.publishers - a.publishers || b.members - a.members || b.maxScore - a.maxScore || a.earliest - b.earliest || a.type.localeCompare(b.type));
  const best = ranked[0] || null;
  return best ? { type: best.type, publishers: best.publishers, members: best.members, alternatives: ranked.map((r) => ({ type: r.type, publishers: r.publishers, members: r.members, maxScore: r.maxScore })) } : { type: null, publishers: 0, members: 0, alternatives: [] };
}

export function teamForPlayer(player, entities, dict = null) {
  if (!player) return null;
  const dictPlayer = dict?.playerById?.get?.(String(player.id)) || null;
  const teamId = String(player.team_id || dictPlayer?.team_id || '');
  if (!teamId) return null;
  const entity = uniqEntities(entities).find((e) => e.type === 'team' && String(e.id) === teamId);
  if (entity) return entity;
  const team = dict?.teamById?.get?.(teamId) || null;
  return { type: 'team', id: teamId, name: team?.name || null, short_name: team?.short_name || null, method: 'player_roster_team' };
}

export function headlineTeam(members, entities) {
  const teams = uniqEntities(entities).filter((e) => e.type === 'team' && e.name);
  if (teams.length === 1) return teams[0];
  const scores = teams.map((team) => ({
    team,
    mentions: (members || []).filter((m) => mentionPos(m?.headline, team.name) >= 0).length
  })).sort((a, b) => b.mentions - a.mentions || String(a.team.id).localeCompare(String(b.team.id)));
  return scores[0]?.mentions && (!scores[1] || scores[0].mentions > scores[1].mentions) ? scores[0].team : null;
}

function evidenceMembers(article) {
  return (article?.evidence || []).filter((e) => e?.kind === 'publisher_report' && e.headline).map((e, i) => ({
    item_id: `evidence-${i}`,
    source_id: e.publisher || `source-${i}`,
    source_name: e.publisher || null,
    headline: e.headline,
    published_at: e.published_at || article.first_published_at || article.published_at || null,
    event_type: eventType(e.headline || '')
  }));
}

/** Failures that make an article unsafe to publish/list, not stylistic issues. */
export function articleIdentityFailures(article, { dict = null } = {}) {
  if (!article) return ['identity: missing article'];
  const failures = [];
  const entities = uniqEntities([
    ...(article.entities || []),
    ...(article.facts?.brief?.linked_entities || [])
  ]);
  const leadId = article.lead_player_id == null ? null : String(article.lead_player_id);
  const leadEntity = leadId ? entities.find((e) => e.type === 'player' && String(e.id) === leadId) : null;
  const dictPlayer = leadId ? dict?.playerById?.get?.(leadId) || null : null;
  const leadName = leadEntity?.name || dictPlayer?.name || null;

  if (leadId && !leadEntity && !dictPlayer) failures.push(`identity: lead player ${leadId} is not present in article entities or roster dictionary`);
  if (leadName && article.primary_subject && norm(article.primary_subject) !== norm(leadName)) {
    failures.push(`identity: primary subject "${article.primary_subject}" disagrees with lead player "${leadName}"`);
  }

  // For stored history, compare against the team captured on the article's
  // player entity. Do not retroactively judge an old story by today's roster
  // dictionary after a legitimate trade.
  const expectedTeam = String(leadEntity?.team_id || '');
  if (leadId && expectedTeam && article.lead_team_id != null && String(article.lead_team_id) !== expectedTeam) {
    failures.push(`identity: lead player ${leadName || leadId} was linked to team ${expectedTeam} in this event, not lead team ${article.lead_team_id}`);
  }

  if (article.kind === 'brief' || article.facts?.brief) {
    const reports = evidenceMembers(article);
    if (reports.length) {
      const subject = headlineConsensusPlayer(reports, entities, { canonicalHeadline: reports[0]?.headline || null });
      if (subject.player && (!leadId || String(subject.player.id) !== leadId)) {
        failures.push(`identity: publisher-headline consensus names ${subject.player.name} (${subject.player.id}) as subject, not lead player ${leadName || leadId || 'none'}`);
      }
      const event = consensusEventType(reports);
      const storedType = article.facts?.brief?.event_type || article.context?.brief?.event_type || article.event_type || null;
      if (event.type && event.publishers >= 2 && storedType && event.type !== storedType) {
        failures.push(`identity: publisher-headline consensus is event "${event.type}" from ${event.publishers} publishers, not stored "${storedType}"`);
      }
    }
  }
  return [...new Set(failures)];
}

/**
 * Versioned full-catalog audit. New/revised stories are also checked pre-publish;
 * this pass exists to clean historical records created by older generators.
 */
export async function auditStoredIdentity(cards, { dict = null, getItem, putItem, at = new Date().toISOString() } = {}) {
  const result = { version: IDENTITY_VERSION, checked: 0, passed: 0, retired: 0, unavailable: 0, failures: [] };
  for (const card of cards || []) {
    if (!card || card.superseded_by) continue;
    const auditedAt = Date.parse(card.identity_audit?.at || 0);
    const revisedAt = Date.parse(card.revised_at || card.first_published_at || card.published_at || 0);
    if (card.identity_audit?.version === IDENTITY_VERSION && auditedAt >= revisedAt) continue;

    const item = await getItem(card.id).catch(() => null);
    if (!item) { result.unavailable += 1; continue; }
    result.checked += 1;
    const failures = articleIdentityFailures(item, { dict });
    card.identity_audit = { version: IDENTITY_VERSION, at, ok: failures.length === 0, failures: failures.slice(0, 5) };
    if (!failures.length) { result.passed += 1; continue; }

    result.retired += 1;
    result.failures.push({ id: card.id, slug: card.slug, headline: card.headline, failures: failures.slice(0, 5) });
    const revision = { at, kind: 'integrity_retirement', note: failures[0], generator: IDENTITY_VERSION };
    const revisions = [...(item.revisions || []), revision].slice(-20);
    const review = { policy: IDENTITY_VERSION, state: 'retired_from_index', reason: failures[0], at, failures: failures.slice(0, 5) };
    Object.assign(card, { quality_state: 'retired_from_index', quality_review: review, revisions });
    await putItem({ ...item, quality_state: 'retired_from_index', quality_review: review, identity_audit: card.identity_audit, revisions });
  }
  return result;
}
