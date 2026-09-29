// Homepage Top Story selection. Pure and deterministic: the same stories + context + clock always pick the
// same lead. This is homepage CURATION only — it never reads or writes article clocks beyond the canonical
// origin (first_published_at), and it never changes what the newsroom publishes or how /news orders it.
//
// Latest News stays chronological (frontPageEditorialStories). The Top Story is chosen by:
//   1. eligibility — listed, current, non-historical stories only;
//   2. a freshness pool — stories first published in the last 24h (then 72h, then newest eligible);
//   3. an editorial score — materiality class + slate context − a uniform age decay;
//   4. explicit tie-breaks — score, materiality, event recency, depth, game relevance, origin time, id last.
//
// Because every candidate decays at the same rate, the ranking between two stories never changes merely
// because the clock moved. The lead changes only when the candidate set or the slate context changes
// (a new story, a story leaving the pool/listing, games going final/live).
import { storyOriginIso, storyPublishedAt } from './news-ranking.js';

// 1.1.0: a preview's Top Story clock is its game (see leadClockOf), so tonight's playoff preview is not aged out by
// having been drafted days before tip.
export const HOMEPAGE_LEAD_POLICY = 'homepage-lead/1.1.0';

const HOUR = 3600e3;
const POOL_WINDOWS_H = [24, 72];
const DECAY_PER_HOUR = 2;
const RECENT_FINAL_WINDOW = 36 * HOUR;
const PREVIEW_WINDOW = 48 * HOUR;
const STALE_RESULT_AGE = 48 * HOUR;
const PREVIEW_DUE = 36 * HOUR;

export const MATERIALITY = Object.freeze({ VERY_HIGH: 100, HIGH: 75, MEDIUM: 50, LOW: 25, STALE: 10 });
const BOOST = Object.freeze({ postgame: 20, pregame: 15, live: 10, full_depth: 4 });

// Mirrors the newsroom's listedCard(): these states keep their URL but leave every listing.
const UNLISTED_QUALITY = new Set(['external_coverage', 'retired_from_index', 'legacy_acceptable', 'duplicate', 'superseded', 'retired', 'unlisted']);
const MATERIAL_BRIEF = /injur|availab|transaction|trade|sign|waive|release|roster|suspen|coach|fire|hire/i;

const ms = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : null;
};
const gamesOf = (c) => (c?.entities || []).filter((e) => e?.type === 'game' && e.id != null);
const teamsOf = (c) => (c?.entities || []).filter((e) => e?.type === 'team' && e.id != null).map((e) => String(e.id));

/**
 * The clock Top Story freshness reads. Every story uses its editorial origin (first publication) — never a revision
 * clock. A preview is the one exception: it becomes timely as its game approaches, so its clock is the later of its
 * origin and 36h before tip (capped at now). A preview drafted four days early is judged as of tonight's slate, not
 * as a four-day-old story; one drafted yesterday for a game next week is not promoted early.
 */
export function leadClockOf(c, now) {
  const origin = storyPublishedAt(c);
  if (c?.kind !== 'preview') return origin;
  const tips = gamesOf(c).map((g) => ms(g.start_utc)).filter((t) => t !== null && t > now);
  if (!tips.length || !origin) return origin;
  return Math.min(now, Math.max(origin, Math.min(...tips) - PREVIEW_DUE));
}

/** Can this story lead the homepage at all? Returns null when eligible, otherwise the reason it cannot. */
export function leadIneligibility(c) {
  if (!c || !c.id) return 'missing';
  if (c.historical_backfill === true) return 'historical_backfill';
  if (c.duplicate_of) return 'duplicate';
  if (c.superseded_by) return 'superseded';
  if (c.listing_ended_at && c.kind !== 'injury') return 'listing_ended';
  if (c.status && c.status !== 'published') return `status:${c.status}`;
  if (c.quality_state && UNLISTED_QUALITY.has(c.quality_state)) return `quality:${c.quality_state}`;
  if (!storyPublishedAt(c)) return 'no_origin_clock'; // a revised card with no origin clock claims no freshness
  return null;
}

/** Slate context the selector needs, derived from the Today hero + /v1/today data. */
export function homepageLeadContext({ hero = null, data = null, now = Date.now() } = {}) {
  const ids = (games) => (games || []).map((g) => String(g?.game_id ?? '')).filter(Boolean);
  const recentFinal = (data?.last_results?.games || []).filter((g) => {
    const at = ms(g?.start_utc);
    return g?.status?.state === 'post' && at !== null && now - at <= RECENT_FINAL_WINDOW;
  });
  const upcoming = hero?.upcomingGames || [];
  const live = hero?.liveGames || [];
  const teamIds = (games) => games.flatMap((g) => [g?.away?.team_id, g?.home?.team_id]).filter((x) => x != null).map(String);
  return {
    now,
    mode: hero?.mode || 'DESK',
    postseason: /post\s*season|playoff|final/i.test(String(data?.phase || '')),
    finalGameIds: new Set([...ids(hero?.finalGames), ...ids(recentFinal)]),
    upcomingGameIds: new Set(ids(upcoming)),
    liveGameIds: new Set(ids(live)),
    upcomingTeamIds: new Set(teamIds(upcoming)),
    liveTeamIds: new Set(teamIds(live))
  };
}

// Materiality class for one story in this context: { points, label }.
function materiality(c, ctx) {
  const kind = c?.kind === 'result' ? 'performance' : c?.kind;
  const games = gamesOf(c);
  const gameIds = games.map((g) => String(g.id));
  const starts = games.map((g) => ms(g.start_utc)).filter((x) => x !== null);
  const knownCurrent = gameIds.some((id) => ctx.upcomingGameIds.has(id) || ctx.liveGameIds.has(id) || ctx.finalGameIds.has(id));
  const po = ctx.postseason ? 'playoff' : 'game';

  if (kind === 'injury') return { points: MATERIALITY.VERY_HIGH, label: 'availability change' };
  if (kind === 'transaction') return { points: MATERIALITY.VERY_HIGH, label: 'roster transaction' };
  if (kind === 'brief') {
    const ev = `${c.event_type || ''} ${c.desk || ''} ${c.facts?.brief?.event_type || ''}`;
    return MATERIAL_BRIEF.test(ev)
      ? { points: MATERIALITY.VERY_HIGH, label: 'material news brief' }
      : { points: MATERIALITY.MEDIUM, label: 'news brief' };
  }
  if (kind === 'performance') {
    // A result story about a game long past is late coverage, not a current result.
    const latest = starts.length ? Math.max(...starts) : null;
    if (latest !== null && ctx.now - latest > STALE_RESULT_AGE && !knownCurrent) return { points: MATERIALITY.MEDIUM, label: `late ${po} result` };
    return ctx.postseason
      ? { points: MATERIALITY.VERY_HIGH, label: 'playoff result/performance' }
      : { points: MATERIALITY.HIGH, label: 'game result/performance' };
  }
  if (kind === 'preview') {
    const ahead = starts.filter((t) => t > ctx.now);
    if (starts.length && !ahead.length) return { points: MATERIALITY.STALE, label: 'preview of a game already played' };
    const soon = ahead.some((t) => t - ctx.now <= PREVIEW_WINDOW);
    if (soon && ctx.postseason) return { points: MATERIALITY.HIGH, label: 'playoff preview' };
    return { points: MATERIALITY.MEDIUM, label: 'game preview' };
  }
  if (kind === 'commissioned_feature') {
    const current = gameIds.some((id) => ctx.upcomingGameIds.has(id) || ctx.liveGameIds.has(id))
      || starts.some((t) => t > ctx.now && t - ctx.now <= PREVIEW_WINDOW);
    return current
      ? { points: MATERIALITY.VERY_HIGH, label: 'current-event feature' }
      : { points: MATERIALITY.MEDIUM, label: 'feature' };
  }
  if (kind === 'trend') return { points: MATERIALITY.LOW, label: 'generic team trend' };
  if (kind === 'props' || kind === 'market') return { points: MATERIALITY.LOW, label: 'statistical/market trend' };
  return { points: MATERIALITY.MEDIUM, label: kind === 'winba_index' ? 'current WinBA edition' : `${kind || 'story'}` };
}

// Slate-context boost: does this story cover the games the desk is about right now?
function contextBoost(c, ctx) {
  const kind = c?.kind === 'result' ? 'performance' : c?.kind;
  const gameIds = gamesOf(c).map((g) => String(g.id));
  const teams = teamsOf(c);
  if (kind === 'performance' && gameIds.some((id) => ctx.finalGameIds.has(id))) {
    return { points: BOOST.postgame, label: ctx.mode === 'FINAL' ? 'covers the slate that just went final' : 'covers a game that finished in the last 36h' };
  }
  if (['PREGAME', 'BETWEEN', 'OFFDAY'].includes(ctx.mode)) {
    if (kind === 'preview' && gameIds.some((id) => ctx.upcomingGameIds.has(id))) return { points: BOOST.pregame, label: 'previews an upcoming slate game' };
    if ((kind === 'injury' || kind === 'transaction') && teams.some((t) => ctx.upcomingTeamIds.has(t))) return { points: BOOST.pregame, label: 'availability for an upcoming slate team' };
  }
  if (ctx.mode === 'LIVE' && (kind === 'injury' || kind === 'transaction') && teams.some((t) => ctx.liveTeamIds.has(t))) {
    return { points: BOOST.live, label: 'availability for a live game team' };
  }
  return { points: 0, label: null };
}

/** Score one story. Exported for diagnostics/tests. */
export function scoreHomepageStory(c, ctx) {
  const originAt = storyPublishedAt(c);
  const ageHours = Math.max(0, (ctx.now - leadClockOf(c, ctx.now)) / HOUR);
  const mat = materiality(c, ctx);
  const boost = contextBoost(c, ctx);
  const depth = (c?.depth_class || c?.depth?.class) === 'full' ? BOOST.full_depth : 0;
  const decay = Math.round(ageHours * DECAY_PER_HOUR * 100) / 100;
  const starts = gamesOf(c).map((g) => ms(g.start_utc)).filter((x) => x !== null);
  return {
    id: c.id,
    kind: c.kind,
    first_published_at: storyOriginIso(c),
    age_hours: Math.round(ageHours * 100) / 100,
    materiality: mat.points,
    materiality_label: mat.label,
    context_boost: boost.points,
    context_label: boost.label,
    depth_bonus: depth,
    age_decay: decay,
    score: Math.round((mat.points + boost.points + depth - decay) * 100) / 100,
    // Tie-break inputs, all explicit story fields — never the id except as the final fallback.
    event_distance_ms: starts.length ? Math.min(...starts.map((t) => Math.abs(ctx.now - t))) : Number.POSITIVE_INFINITY,
    depth_words: Number(c?.depth?.words) || 0,
    game_relevant: boost.points > 0 ? 1 : 0,
    origin_ms: originAt
  };
}

function compareScored(a, b) {
  return (b.score - a.score)
    || (b.materiality - a.materiality)
    || (a.event_distance_ms - b.event_distance_ms)
    || (b.depth_bonus - a.depth_bonus)
    || (b.depth_words - a.depth_words)
    || (b.game_relevant - a.game_relevant)
    || (b.origin_ms - a.origin_ms)
    || String(a.id).localeCompare(String(b.id));
}

function reasonFor(lead, runnerUp, newest, poolLabel) {
  if (!lead) return 'no eligible story';
  const what = `${lead.materiality_label}${lead.context_label ? ` (${lead.context_label})` : ''}`;
  if (poolLabel === 'fallback') return `no eligible story in the last ${POOL_WINDOWS_H.at(-1)}h — newest legitimate story leads`;
  if (newest && newest.id !== lead.id) {
    return `fresh ${what} outranks newer ${newest.materiality_label} (${lead.score} vs ${newest.score})`;
  }
  if (runnerUp) return `newest ${what} is also the strongest current story (${lead.score} vs ${runnerUp.materiality_label} ${runnerUp.score})`;
  return `only eligible story in the ${poolLabel} pool: ${what}`;
}

/**
 * Choose the homepage Top Story.
 * Returns { lead, diagnostics }. `diagnostics` is non-user-facing and explains the choice.
 */
export function selectHomepageLead(stories = [], context = {}) {
  const ctx = context.finalGameIds ? context : homepageLeadContext(context);
  const excluded = [];
  const eligible = [];
  for (const c of stories || []) {
    const why = leadIneligibility(c);
    if (why) excluded.push({ id: c?.id ?? null, reason: why });
    else eligible.push(c);
  }

  let pool = [];
  let poolLabel = 'fallback';
  for (const h of POOL_WINDOWS_H) {
    pool = eligible.filter((c) => ctx.now - leadClockOf(c, ctx.now) <= h * HOUR && storyPublishedAt(c) <= ctx.now + 5 * 60e3);
    if (pool.length) { poolLabel = `${h}h`; break; }
  }

  let ranked;
  if (pool.length) {
    ranked = pool.map((c) => scoreHomepageStory(c, ctx)).sort(compareScored);
  } else {
    // Graceful fallback: nothing current — the newest legitimate story leads, chronologically.
    ranked = eligible.map((c) => scoreHomepageStory(c, ctx))
      .sort((a, b) => (b.origin_ms - a.origin_ms) || String(a.id).localeCompare(String(b.id)));
  }

  const byId = new Map(eligible.map((c) => [c.id, c]));
  const top = ranked[0] || null;
  const newest = [...ranked].sort((a, b) => (b.origin_ms - a.origin_ms) || compareScored(a, b))[0] || null;
  const diagnostics = {
    policy: HOMEPAGE_LEAD_POLICY,
    now: new Date(ctx.now).toISOString(),
    mode: ctx.mode,
    postseason: ctx.postseason,
    pool: poolLabel,
    lead_story_id: top?.id ?? null,
    lead_kind: top?.kind ?? null,
    lead_first_published_at: top?.first_published_at ?? null,
    lead_score: top?.score ?? null,
    lead_components: top ? {
      materiality: top.materiality, materiality_label: top.materiality_label,
      context_boost: top.context_boost, context_label: top.context_label,
      depth_bonus: top.depth_bonus, age_hours: top.age_hours, age_decay: top.age_decay
    } : null,
    runner_up_ids: ranked.slice(1, 4).map((r) => r.id),
    ranking: ranked.map((r) => ({ id: r.id, kind: r.kind, score: r.score, materiality: r.materiality_label, context: r.context_label, age_hours: r.age_hours })),
    excluded,
    selection_reason: reasonFor(top, ranked[1] || null, newest, poolLabel)
  };
  return { lead: top ? byId.get(top.id) : null, diagnostics };
}

// Latest News desks: result and performance are one game desk; trend, props and market moves one market desk.
const RAIL_DESK = Object.freeze({ result: 'game', performance: 'game', injury: 'availability', transaction: 'roster', brief: 'brief', preview: 'preview', commissioned_feature: 'feature', winba_index: 'feature', international: 'international', trend: 'market', props: 'market', market: 'market' });
const railDesk = (c) => RAIL_DESK[c?.kind] || c?.kind || 'other';
const BREAKING_WINDOW = 12 * HOUR;

/** A fresh availability change, roster move or material brief: shown in Latest News whatever the desk mix. */
export function isBreakingStory(c, now = Date.now()) {
  const at = storyPublishedAt(c);
  if (!at || now - at > BREAKING_WINDOW) return false;
  if (c.kind === 'injury' || c.kind === 'transaction') return true;
  return c.kind === 'brief' && MATERIAL_BRIEF.test(`${c.event_type || ''} ${c.desk || ''}`);
}

/**
 * Latest News rail: chronological (input order is newest-first and is preserved), without the lead.
 * Selection, never a reorder, in four steps: (1) breaking news always gets a slot; (2) one story per desk not
 * already shown (the lead counts), so a varied slate shows a result, an injury, a preview and a feature rather
 * than two trends and two previews; (3) up to `maxPerKind` per desk; (4) anything left, chronologically — when
 * only one desk has news the rail is filled from it rather than left empty. Copy is never rotated to fake variety.
 */
export function latestNewsRail(chronological = [], lead = null, { limit = 4, maxPerKind = 2, now = Date.now() } = {}) {
  const rest = (chronological || []).filter((c) => c?.id !== lead?.id);
  const counts = new Map(lead ? [[railDesk(lead), 1]] : []);
  const chosen = new Set();
  const take = (c) => { chosen.add(c.id); counts.set(railDesk(c), (counts.get(railDesk(c)) || 0) + 1); };
  const pass = (ok) => { for (const c of rest) { if (chosen.size >= limit) return; if (!chosen.has(c.id) && ok(c)) take(c); } };
  pass((c) => isBreakingStory(c, now));
  pass((c) => !counts.get(railDesk(c)));
  pass((c) => (counts.get(railDesk(c)) || 0) < maxPerKind);
  pass(() => true);
  return rest.filter((c) => chosen.has(c.id));
}
