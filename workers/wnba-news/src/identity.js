// Newsroom identity integrity — deterministic subject/team/event coherence.
//
// A publisher cluster can mention several players and teams. These helpers decide
// who the event is actually about from headline consensus, bind a player only to
// her own roster team, and fail closed when a generated/stored story contradicts
// those identities.

import { eventType } from './taxonomy.js';

export const IDENTITY_VERSION = 'wnba-news-identity/1.2.0';

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
  const rankedAll = [...rows.values()].map((r) => ({ ...r, publishers: r.sources.size }));
  // "news" is a fallback classification, not a competing event. Once any
  // publisher identifies a concrete development inside a persisted cluster,
  // generic follow-up wording cannot vote that event back into generic news.
  const specific = rankedAll.filter((r) => r.type !== 'news');
  const ranked = (specific.length ? specific : rankedAll)
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

/**
 * Does `subject` name a team this story is actually about?
 *
 * `primary_subject` is the story's subject, and for game, performance and
 * transaction stories that is legitimately the TEAM ("Aces", "Wings", "Fire")
 * while the lead player is the standout inside it. Stored entities carry only
 * the full team name, so a bare short name has to match its last word(s).
 */
export function subjectNamesStoryTeam(subject, entities, { leadTeamId = null, dict = null } = {}) {
  const s = norm(subject);
  if (!s) return false;
  const teams = uniqEntities(entities).filter((e) => e.type === 'team');
  const leadId = leadTeamId == null ? null : String(leadTeamId);
  if (leadId && !teams.some((t) => String(t.id) === leadId)) {
    const lead = dict?.teamById?.get?.(leadId) || null;
    if (lead) teams.push({ type: 'team', id: leadId, name: lead.name, short_name: lead.short_name });
  }
  return teams.some((team) => {
    const dictTeam = dict?.teamById?.get?.(String(team.id)) || null;
    return [team.name, team.short_name, dictTeam?.name, dictTeam?.short_name]
      .filter(Boolean)
      .some((candidate) => {
        const n = norm(candidate);
        return n === s || n.endsWith(` ${s}`);
      });
  });
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

/**
 * In a story about one specific game, the lead team is the team the story turns
 * on — usually the winner — while the lead player can be the standout on the
 * other side ("Angel Reese's 16 and 16 not enough as the Fire beat the Dream").
 * That divergence is only legitimate when the story is structurally about that
 * game: a game entity is present and BOTH the player's roster team and the lead
 * team are teams in the story.
 *
 * It is exactly this structure that the wrong-team failures lack. The Clark
 * record carried no Fever entity at all; the Fudd/Liberty record carried no
 * game. Neither can borrow a game story's licence to diverge.
 */
function isGameStoryDivergence(article, entities, rosterTeamId) {
  const leadTeamId = article?.lead_team_id == null ? null : String(article.lead_team_id);
  if (!leadTeamId || !rosterTeamId) return false;
  const list = uniqEntities(entities);
  if (!list.some((e) => e.type === 'game')) return false;
  const teamIds = new Set(list.filter((e) => e.type === 'team').map((e) => String(e.id)));
  return teamIds.has(String(rosterTeamId)) && teamIds.has(leadTeamId);
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


// ---------------------------------------------------------------------------
// Identity modes
// ---------------------------------------------------------------------------

/**
 * What KIND of subject an article has.
 *
 * `player` — the default. A story about a development involving a person or a
 * team, where `primary_subject` names the person the story is about (or her
 * team, for a game story).
 *
 * `series` — a recurring multi-entity editorial product: a ranking, an index, a
 * leaderboard, an awards round-up. Its subject is the SERIES, not any one of
 * the dozens of people in it. "The WinBA Index" is the subject; Olivia Miles is
 * the leader of the board it publishes. Requiring
 * `primary_subject === lead_player.name` is simply the wrong invariant here, so
 * a series article is checked against its own contract instead — not exempted
 * from checking.
 *
 * The mode is declared on the article (`identity_mode`). It is also inferred
 * from `kind` for records written before the field existed, so a stored article
 * is never judged by the wrong contract merely because it predates this.
 */
export const SERIES_KINDS = Object.freeze({ winba_index: 'The WinBA Index' });

export function identityModeOf(article) {
  const declared = article?.identity_mode;
  if (declared === 'series' || declared === 'player') return declared;
  return SERIES_KINDS[String(article?.kind)] ? 'series' : 'player';
}

/**
 * The identity contract for a recurring ranking/index article.
 *
 * It asserts the things that can actually be wrong about a leaderboard: that it
 * is about the series it claims, that its frozen board exists and is coherent,
 * that the lead player really is the board's No. 1, and that the timestamps and
 * period agree.
 *
 * It deliberately does NOT require ranked players to appear in the current
 * roster dictionary: a board frozen in the past legitimately contains players
 * since released or traded, and demanding a current-roster match would reject
 * exactly the historical editions that are most correct.
 */
export function seriesIdentityFailures(article, { dict = null } = {}) {
  const failures = [];
  const seriesName = SERIES_KINDS[String(article?.kind)];
  if (!seriesName) return [`identity: "${article?.kind}" is not a registered editorial series`];

  if (article.primary_subject && norm(article.primary_subject) !== norm(seriesName)) {
    failures.push(`identity: series subject "${article.primary_subject}" is not the registered series "${seriesName}"`);
  }

  const period = String(article.period || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) failures.push(`identity: "${period || 'none'}" is not a valid ranking period`);

  const board = article.winba_board || null;
  if (!board) return [...failures, 'identity: the frozen board is missing'];
  if (board.period && String(board.period) !== period) {
    failures.push(`identity: the frozen board covers ${board.period}, not the article's ${period}`);
  }

  const rows = Array.isArray(board.rows) ? board.rows : [];
  if (!rows.length) return [...failures, 'identity: the frozen board has no ranked players'];

  // Internal coherence of the board itself.
  // `Number(null)` is 0 and 0 is finite, so the raw value has to be rejected
  // first or a missing score reads as a legitimate rating of zero.
  const scoreOf = (r) => (r?.score === null || r?.score === undefined || r?.score === '' ? NaN : Number(r.score));
  const unscored = rows.filter((r) => !Number.isFinite(scoreOf(r)));
  if (!rows.every((r, i) => Number(r.rank) === i + 1)) failures.push('identity: board ranks are not a complete 1..n sequence');
  if (!rows.every((r, i) => i === 0 || scoreOf(rows[i - 1]) >= scoreOf(r))) failures.push('identity: board scores do not descend with rank');
  if (unscored.length) failures.push(`identity: ${unscored.length} ranked ${unscored.length === 1 ? 'row has' : 'rows have'} no score`);
  const unidentified = rows.filter((r) => !/^\d+$/.test(String(r.player_id)) || !r.player_name);
  if (unidentified.length) failures.push(`identity: ${unidentified.length} ranked ${unidentified.length === 1 ? 'row does' : 'rows do'} not resolve to a named player id`);

  // The lead player must BE the board leader, and her team must be the team the
  // board froze for her — not today's roster.
  const leader = rows[0];
  const leadId = article.lead_player_id == null ? null : String(article.lead_player_id);
  if (!leadId) failures.push('identity: no lead player');
  else if (leadId !== String(leader.player_id)) {
    failures.push(`identity: lead player ${leadId} is not the board leader ${leader.player_name} (${leader.player_id})`);
  }
  if (article.lead_team_id != null && leader.team_id && String(article.lead_team_id) !== String(leader.team_id)) {
    failures.push(`identity: lead team ${article.lead_team_id} is not the board leader's frozen team ${leader.team_id}`);
  }
  // The leader must also be the same person the entity list links.
  const leaderEntity = (article.entities || []).find((e) => e?.type === 'player' && String(e.id) === String(leader.player_id)) || null;
  if (leaderEntity?.name && leader.player_name && norm(leaderEntity.name) !== norm(leader.player_name)) {
    failures.push(`identity: board leader "${leader.player_name}" disagrees with linked player "${leaderEntity.name}"`);
  }
  const dictLeader = dict?.playerById?.get?.(String(leader.player_id)) || null;
  if (dictLeader?.name && leader.player_name && norm(dictLeader.name) !== norm(leader.player_name)) {
    failures.push(`identity: board leader "${leader.player_name}" disagrees with roster name "${dictLeader.name}"`);
  }

  // Timestamps: a board cannot be observed after the story was generated, and a
  // completed period cannot be frozen before it closed.
  const snapshotAt = Date.parse(board.snapshot_at || '');
  const generatedAt = Date.parse(article.provenance?.generated_at || article.published_at || '');
  if (Number.isFinite(snapshotAt) && Number.isFinite(generatedAt) && snapshotAt > generatedAt + 60e3) {
    failures.push('identity: the frozen board is newer than the article that published it');
  }
  const frozenAt = Date.parse(board.frozen_at || '');
  if (Number.isFinite(frozenAt) && Number.isFinite(generatedAt) && frozenAt > generatedAt + 60e3) {
    failures.push('identity: the board was frozen after the article was generated');
  }

  return [...new Set(failures)];
}

/** Failures that make an article unsafe to publish/list, not stylistic issues. */
export function articleIdentityFailures(article, { dict = null } = {}) {
  if (!article) return ['identity: missing article'];
  // A ranking/index is a different kind of subject, so it gets a different
  // contract rather than an exemption.
  if (identityModeOf(article) === 'series') return seriesIdentityFailures(article, { dict });
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
  // A team subject alongside a player lead is coherent, not a contradiction:
  // "Jackie Young's 35 points lead the Aces past the Storm" has subject Aces
  // and lead player Young. Only a subject naming neither the lead player nor a
  // team in the story is an identity failure. Wrong-team attribution is caught
  // by the roster check below, which is the check that owns that question.
  if (leadName && article.primary_subject
    && norm(article.primary_subject) !== norm(leadName)
    && !subjectNamesStoryTeam(article.primary_subject, entities, { leadTeamId: article.lead_team_id, dict })) {
    failures.push(`identity: primary subject "${article.primary_subject}" disagrees with lead player "${leadName}"`);
  }

  // For stored history, compare against the team captured on the article's
  // player entity. Do not retroactively judge an old story by today's roster
  // dictionary after a legitimate trade.
  const expectedTeam = String(leadEntity?.team_id || '');
  if (leadId && expectedTeam && article.lead_team_id != null && String(article.lead_team_id) !== expectedTeam
    && !isGameStoryDivergence(article, entities, expectedTeam)) {
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
  const result = { version: IDENTITY_VERSION, checked: 0, passed: 0, retired: 0, restored: 0, unavailable: 0, failures: [], restorations: [] };
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
    if (!failures.length) {
      result.passed += 1;
      // A record this audit retired under an earlier, wrong contract has to be
      // able to come back. The retirement is not erased — it stays in the
      // revision history with a restoration entry beside it — and nothing about
      // the publication itself moves: published_at, first_published_at, the
      // slug and the body are untouched. Only the listing state changes,
      // because the reason for withholding it turned out to be invalid.
      if (card.quality_state === 'retired_from_index' && String(card.quality_review?.policy || '').startsWith('wnba-news-identity/')) {
        const note = `restored: the identity failure that retired this record does not hold under ${IDENTITY_VERSION}`;
        const revisions = [...(item.revisions || []), { at, kind: 'integrity_restoration', note, generator: IDENTITY_VERSION }].slice(-20);
        const review = { policy: IDENTITY_VERSION, state: 'current_quality', reason: note, at, restored_from: card.quality_review || null };
        Object.assign(card, { quality_state: 'current_quality', quality_review: review, revisions });
        await putItem({ ...item, quality_state: 'current_quality', quality_review: review, identity_audit: card.identity_audit, revisions });
        result.restored = (result.restored || 0) + 1;
        (result.restorations = result.restorations || []).push({ id: card.id, slug: card.slug, was: item.quality_review?.reason || null });
      }
      continue;
    }

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
