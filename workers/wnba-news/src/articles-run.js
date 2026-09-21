// Orchestrates one newsroom article pass: gather structured inputs from
// wnba-api (service binding), run every generator, gate, store in KV (and
// Supabase when bound). Deterministic ids: a re-run rewrites the same article
// only when its inputs changed (input_hash) or the generator version moved.

import { injuryArticles, transactionArticles, resultArticles, previewArticles, trendArticles, propArticles, marketMoveArticles, withSlug, cardOf, ARTICLE_VERSION } from './articles.js';
import { briefArticles, underlyingEvent, BRIEF_VERSION } from './briefs.js';
import { withheldBySourcePolicy } from './sources.js';
import { assessDepth, DEPTH_VERSION } from './depth.js';
import { reviewStory, needsReview, assessStored, listedCard, LEGACY_POLICY_VERSION, QUALITY_STATES } from './legacy.js';
import { reconcileArticle, RECONCILE_VERSION } from './reconcile.js';
import { internationalArticles, INTL_VERSION } from './international.js';
import { mergeArticles } from './lifecycle.js';
import { qualityFailures } from './quality.js';
import { articleIdentityFailures, auditStoredIdentity, IDENTITY_VERSION } from './identity.js';

const et = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replaceAll('-', '');
const add = (s, n) => { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + n)); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; };

// The Worker is scheduled every 10 minutes. Keep the guard slightly below the cron interval so
// normal Cloudflare scheduling jitter cannot turn a 10-minute source cadence into a 20/30-minute
// article cadence. Input hashes below still guarantee unchanged stories are never rewritten.
export const ARTICLE_RUN_MIN_GAP_MS = 9 * 60e3;

// Story identity, editorial-origin clock, duplicate repair and supersession live in lifecycle.js.
export { articleFirstPublishedAt, injuryIdentity } from './lifecycle.js';

export async function runArticles(env, { apiGet, dict, externalItems, force = false, intlGet = null, breaking = false, backfillInternational = false, mediaFor = null }) {
  const started = new Date().toISOString();
  const now = Date.now();
  const last = await env.NEWS_KV.get('art:v1:last_run', 'json');
  // Source ingest runs every five minutes; the article pass every ten, or immediately when ingest found a new material
  // official roster / injury / league event (the breaking path).
  if (!force && !breaking && last?.at && now - Date.parse(last.at) < ARTICLE_RUN_MIN_GAP_MS && last.version === ARTICLE_VERSION) return { skipped: 'ran_recently', last_at: last.at };

  const errors = [];
  // One fetch per distinct path per run: box scores, team and player records are shared by every generator
  // that needs them, so the run's subrequest count is the number of DISTINCT records, not of requests.
  const meterState = { issued: 0, fetched: 0 };
  const cache = new Map();
  const soft = (path) => {
    meterState.issued += 1;
    if (!cache.has(path)) {
      meterState.fetched += 1;
      cache.set(path, apiGet(path).catch((e) => { errors.push(`${path}: ${e.message}`); return null; }));
    }
    return cache.get(path);
  };
  const meter = () => ({ ...meterState });
  const today = et();
  const [inj, tx, sched, longSched, standings, props] = await Promise.all([
    soft('/v1/injuries'),
    soft('/v1/transactions'),
    soft(`/v1/schedule?from=${add(today, -14)}&to=${add(today, 7)}`),
    soft(`/v1/schedule?from=${add(today, -50)}&to=${today}`),
    soft('/v1/standings'),
    soft('/v1/props')
  ]);
  const standingsById = new Map((standings?.groups || []).flatMap((g) => g.entries.map((e) => [e.team_id, { ...e, conference_name: g.name }])));
  const games = sched?.games || [];
  const finals = games.filter((g) => g.status?.state === 'post' && g.status?.completed).sort((a, b) => b.start_utc.localeCompare(a.start_utc)).slice(0, 10);
  const upcoming = games.filter((g) => g.status?.state === 'pre').sort((a, b) => a.start_utc.localeCompare(b.start_utc)).slice(0, 8);
  const finalsByTeam = new Map();
  for (const g of (longSched?.games || []).filter((x) => x.status?.state === 'post' && x.status?.completed).sort((a, b) => b.start_utc.localeCompare(a.start_utc))) {
    for (const t of [g.home?.team_id, g.away?.team_id]) { if (!finalsByTeam.has(t)) finalsByTeam.set(t, []); finalsByTeam.get(t).push(g); }
  }
  const externalByPlayer = new Map();
  for (const it of externalItems) for (const e of it.entities || []) if (e.type === 'player') { if (!externalByPlayer.has(e.id)) externalByPlayer.set(e.id, []); externalByPlayer.get(e.id).push(it); }
  for (const v of externalByPlayer.values()) v.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));

  const api = (path) => soft(path);
  // Regular-season game ids: a team schedule carries preseason games with the same season.year, so records
  // computed from team schedules are filtered by the league schedule, where season.type === 2.
  const season = games[0]?.season?.year || Number(today.slice(0, 4));
  const regIds = new Set();
  for (let from = `${season}0501`; from < today;) {
    const to = [add(from, 59), today].sort()[0];
    const chunk = await soft(`/v1/schedule?from=${from}&to=${to}`);
    for (const g of chunk?.games || []) if (g.season?.type === 2) regIds.add(String(g.game_id));
    from = add(to, 1);
  }
  const ctx = { api, injuries: inj?.items || [], externalByPlayer, schedule: games, standingsById, now, transactions: tx?.items || [], dict, finals, upcoming, finalsByTeam, teams: dict.teamsList || [], props, season, regIds, meter, asOf: started };
  const runs = {};
  const produced = [];
  let coverageDecisions = [];
  const deskDecisions = {};
  const priorIndex = (await env.NEWS_KV.get('art:v1:index', 'json')) || [];
  // Backfill: regenerate EXISTING international stories (same id, slug, origin) with the current generator.
  const backfill = backfillInternational ? new Set(priorIndex.filter((c) => c.kind === 'international' && !c.superseded_by).map((c) => (c.entities || []).find((e) => e?.type === 'intl_game')?.id).filter(Boolean).map(String)) : null;
  // Trends run once per ET day per generator version: a new trend generator is picked up by the normal pass.
  const trendKey = `art:v1:trends:${today}:${ARTICLE_VERSION}`;
  const doTrends = (await env.NEWS_KV.get(trendKey)) === null || force;
  for (const [name, fn, on] of [
    ['injury', injuryArticles, true], ['transaction', transactionArticles, true], ['result', resultArticles, true],
    ['preview', previewArticles, true], ['trend', trendArticles, doTrends], ['props', propArticles, true], ['market', marketMoveArticles, true],
    // International desk: medal-game results from wnba-international (material events only, 12-hour window).
    ['international', () => internationalArticles({ intlGet, now, backfill }), Boolean(intlGet)],
    // Material source-wire events run last so the brief generator can suppress events already covered by a
    // structured injury/transaction story. A source cluster is one stable brief: corroboration revises it,
    // while a different material cluster becomes a genuinely new newsroom article.
    ['brief', async () => { const xs = await briefArticles({ externalItems, structured: produced, now, existingIds: new Set(priorIndex.map((c) => c.id)), ctx: { api, injuries: inj?.items || null, transactions: tx?.items || [], schedule: games, standingsById, season, dict } }); coverageDecisions = xs.decisions || []; return xs; }, true]
  ]) {
    if (!on) { runs[name] = 'skipped (daily)'; continue; }
    try {
      const xs = await fn(ctx);
      runs[name] = xs.length;
      if (Array.isArray(xs.decisions) && name !== 'brief') deskDecisions[name] = xs.decisions.slice(0, 20);
      produced.push(...xs);
    } catch (e) {
      runs[name] = `error: ${e.message}`;
      errors.push(`${name}: ${e.stack || e.message}`.slice(0, 300));
    }
  }
  if (doTrends) await env.NEWS_KV.put(trendKey, "1", { expirationTtl: 3 * 86400 });

  const index = priorIndex;
  const held = [];
  const publishable = [];
  const feed = inj?.items || [];
  const gateOne = async (a0) => {
    const a = await withSlug(a0);
    // Added gate: gate.js validate() has already run inside finalize(); reconcile checks what a number gate
    // cannot see (season provenance, absence context, injury-feed completeness, co-leaders, market alignment,
    // rest semantics, provider comment text, prose lint). A failure holds the story.
    a.reconcile = reconcileArticle(a, { season, injuries: feed });
    if (!a.reconcile.ok) a.status = 'held';
    // Identity is a publication invariant, not a quality preference: subject,
    // roster team and publisher-headline event consensus must agree.
    a.identity_failures = articleIdentityFailures(a, { dict });
    if (a.identity_failures.length) {
      a.status = 'held';
      a.reconcile.failures.push(...a.identity_failures);
    }
    // Provenance chronology, resolved visuals and the Intelligence contract.
    a.quality = qualityFailures(a, { media: mediaFor ? mediaFor(a) : null, generatedAt: a.provenance?.generated_at || a.updated_at });
    if (a.quality.length) { a.status = 'held'; a.reconcile.failures.push(...a.quality); }
    // Newsroom depth ladder (depth.js): a deterministic class from the evidence, then the desk's substance contract.
    // Word count is a diagnostic; substance, repetition and Intelligence duplication decide.
    a.depth = assessDepth(a, { now });
    if (!a.depth.pass) { a.status = 'held'; a.reconcile.failures.push(...a.depth.failures.filter((f) => !a.gate.failures.includes(f))); }
    if (a.status !== 'published') { held.push({ id: a.id, kind: a.kind, headline: a.headline, depth: { class: a.depth.class, score: a.depth.score, words: a.depth.words }, failures: [...new Set([...a.gate.failures, ...a.reconcile.failures])].slice(0, 8), at: started }); return a; }
    publishable.push(a);
    return a;
  };
  for (const a0 of produced) await gateOne(a0);

  // Legacy upgrade pass (legacy.js): a live story below the current standard whose records are still in reach is rebuilt
  // by the CURRENT generator for its desk and goes through exactly the same gate. Bounded per pass; never creates a story.
  const producedIds = new Set(produced.map((a) => a.id));
  const regenerations = new Map();
  const getItem = (id) => env.NEWS_KV.get(`art:v1:item:${id}`, 'json');
  let upgradeBudget = 40; // one-time/current-policy cleanup can rebuild far more of the existing catalog
  for (const c of priorIndex) {
    if (upgradeBudget <= 0) break;
    if (!listedCard(c) || producedIds.has(c.id) || !['result', 'performance', 'transaction', 'trend'].includes(c.kind) || !needsReview(c)) continue;
    const item = await getItem(c.id).catch(() => null);
    if (!item || assessStored(item, { now }).pass) continue;
    upgradeBudget -= 1;
    let xs = [];
    try {
      if (c.kind === 'result' || c.kind === 'performance') {
        const gameId = (item.entities || []).find((e) => e?.type === 'game')?.id || item.context?.game?.game_id;
        if (gameId) xs = await resultArticles({ ...ctx, finals: [{ game_id: gameId }] });
      } else if (c.kind === 'transaction') {
        const day = String(item.published_at || '').slice(0, 10);
        const moves = (tx?.items || []).filter((t) => String(t.team?.team_id) === String(c.lead_team_id) && String(t.date).slice(0, 10) === day);
        if (moves.length) xs = await transactionArticles({ ...ctx, transactions: moves, windowDays: 60 });
      } else if (c.kind === 'trend' && !doTrends) {
        xs = await trendArticles({ ...ctx, teams: (ctx.teams || []).filter((t) => String(t.team_id) === String(c.lead_team_id)) });
      }
    } catch (e) { errors.push(`legacy upgrade ${c.id}: ${e.message}`.slice(0, 200)); }
    const mine = xs.filter((a) => a.id === c.id || (c.kind === 'trend' && a.lead_team_id === c.lead_team_id));
    if (!mine.length) { regenerations.set(c.id, null); continue; }
    const before = publishable.length;
    const a = await gateOne(mine[0]);
    regenerations.set(c.id, { passed: publishable.length > before, failures: a.depth?.failures?.length ? a.depth.failures : [...(a.gate?.failures || []), ...(a.reconcile?.failures || [])] });
  }

  // New material event = new story; same event with new data = revision that keeps its editorial origin.
  // Existing duplicate/poisoned cards are repaired deterministically inside the merge on every pass.
  const { index: next, written, repairs, events } = await mergeArticles({
    index,
    articles: publishable,
    started,
    now,
    feed: Array.isArray(inj?.items) ? inj.items : null,
    getItem: (id) => env.NEWS_KV.get(`art:v1:item:${id}`, 'json'),
    putItem: (a) => env.NEWS_KV.put(`art:v1:item:${a.id}`, JSON.stringify(a), { expirationTtl: 120 * 86400 }),
    versionOf: (a) => (a.kind === 'brief' ? BRIEF_VERSION : a.kind === 'international' ? INTL_VERSION : ARTICLE_VERSION),
    cardOf
  });

  // Full versioned catalog audit: historical stories from older generators are
  // rechecked against today's roster dictionary and their own publisher evidence.
  // Any identity conflict is unlisted/noindexed while the historical URL remains.
  const integrityAudit = await auditStoredIdentity(next, {
    dict,
    at: started,
    getItem: (id) => env.NEWS_KV.get(`art:v1:item:${id}`, 'json'),
    putItem: (a) => env.NEWS_KV.put(`art:v1:item:${a.id}`, JSON.stringify(a), { expirationTtl: 120 * 86400 })
  });

  // Standalone stories that were only another publisher's feature (no underlying development) are demoted to external
  // coverage — deliberately, once per brief-generator version, keeping the item, its URL and its revision history.
  const demotions = await demoteExternalCoverage(next, { at: started, getItem: (id) => env.NEWS_KV.get(`art:v1:item:${id}`, 'json'), putItem: (a) => env.NEWS_KV.put(`art:v1:item:${a.id}`, JSON.stringify(a), { expirationTtl: 120 * 86400 }) });
  // Every live story gets an intentional quality state (legacy.js). Rewritten stories passed the gate this pass.
  const writtenIds = new Set(events.map((e) => e.id));
  let reviewed = 0;
  const reviewLimit = 500; // full current catalog review after a policy/version change
  for (const c of next) {
    if (c.superseded_by) continue;
    if (writtenIds.has(c.id)) { c.quality_state = 'current_quality'; c.quality_review = { policy: LEGACY_POLICY_VERSION, state: 'current_quality', reason: 'written this pass through the current gate', at: started, generator: String(c.input_hash || '').split('|')[0] || null }; continue; }
    if (!needsReview(c) || reviewed >= reviewLimit) continue;
    reviewed += 1;
    const teamName = c.kind === 'trend' ? (ctx.teams || []).find((t) => String(t.team_id) === String(c.lead_team_id))?.short_name : null;
    const deskDecision = teamName ? (deskDecisions.trend || []).find((x) => x.team === teamName) || null : null;
    const review = reviewStory({ card: c, item: await getItem(c.id).catch(() => null), now, regeneration: regenerations.has(c.id) ? regenerations.get(c.id) : null, cards: next, withheld: withheldBySourcePolicy(c), deskDecision });
    c.quality_state = review.state;
    c.quality_review = review;
  }
  await env.NEWS_KV.put('art:v1:index', JSON.stringify(next));
  await env.NEWS_KV.put('art:v1:held', JSON.stringify(held.slice(0, 100)));
  const status = { at: started, trigger: backfillInternational ? 'backfill_international' : breaking ? 'breaking' : force ? 'forced' : 'cadence', backfill: backfill ? [...backfill] : null, version: ARTICLE_VERSION, brief_version: BRIEF_VERSION, reconcile_version: RECONCILE_VERSION, runs, produced: produced.length, written, held: held.length, published_total: next.filter(listedCard).length, legacy_policy: LEGACY_POLICY_VERSION, upgrades_attempted: [...regenerations.entries()].map(([id, r]) => ({ id, rebuilt: Boolean(r), passed: Boolean(r?.passed) })), depth_version: DEPTH_VERSION, newsroom_health: newsroomHealth(next, { produced: publishable, held, events }), identity_version: IDENTITY_VERSION, integrity_audit: integrityAudit, coverage_decisions: coverageDecisions.slice(0, 20), desk_decisions: deskDecisions, demotions, lifecycle: { repairs: repairs.slice(0, 40), events: events.slice(0, 40) }, subrequests: meter(), errors: errors.slice(0, 10) };
  await env.NEWS_KV.put('art:v1:last_run', JSON.stringify(status));
  return status;
}

/**
 * Demote standalone News Briefs whose source was only publisher coverage (a feature, profile or commentary piece with
 * no underlying development). The card leaves every listing (status external_coverage), the item keeps serving its
 * historical record at the same URL with a notice, and both record a revision. Reviewed once per brief version.
 */
export async function demoteExternalCoverage(cards, { at, getItem, putItem }) {
  const out = [];
  for (const c of cards) {
    if (c.kind !== 'brief' || c.duplicate_of || c.superseded_by || c.coverage_review?.version === BRIEF_VERSION) continue;
    const item = await getItem(c.id).catch(() => null);
    if (!item) continue;
    const members = (item.evidence || []).filter((e) => e.kind === 'publisher_report').map((e, i) => ({ item_id: `${c.id}-${i}`, headline: e.headline, source_name: e.publisher, published_at: e.published_at, entities: item.facts?.brief?.linked_entities || [], ...(item.facts?.brief?.event_type && item.facts?.brief?.materiality ? { event_type: item.facts.brief.event_type } : {}) }));
    const u = members.length ? underlyingEvent(members) : { event: true, reason: 'no publisher report to review' };
    c.coverage_review = { version: BRIEF_VERSION, at, decision: u.event ? 'standalone' : 'external_coverage', reason: u.reason };
    if (u.event) continue;
    const note = `Moved to external coverage: ${u.reason}. The publisher's report remains linked from the player and team pages; this record is kept.`;
    const revision = { at, kind: 'demoted_to_external_coverage', note, generator: BRIEF_VERSION };
    c.status = 'external_coverage';
    c.demoted_at = at;
    c.revisions = [...(c.revisions || []), revision].slice(-20);
    await putItem({ ...item, status: 'external_coverage', external_coverage: { at, reason: u.reason, source_url: item.context?.brief?.source_url || null, source_name: item.context?.brief?.source_name || null }, revisions: c.revisions });
    out.push({ id: c.id, slug: c.slug, reason: u.reason });
  }
  return out;
}

/** Newsroom health: depth-class distribution, substance and structure by desk, upgrades and substance holds. */
export function newsroomHealth(cards, { produced = [], held = [], events = [] } = {}) {
  const live = cards.filter(listedCard);
  const median = (xs) => { const s = [...xs].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const byDesk = {};
  for (const a of produced) {
    const d = a.depth?.desk || a.depth?.contract || a.kind;
    byDesk[d] = byDesk[d] || { stories: 0, words: [], dims: [], sections: [], classes: {} };
    byDesk[d].stories += 1;
    byDesk[d].words.push(a.depth?.words ?? 0);
    byDesk[d].dims.push(a.depth?.dimensions?.length ?? 0);
    byDesk[d].sections.push(a.depth?.sections ?? 0);
    byDesk[d].classes[a.depth?.class] = (byDesk[d].classes[a.depth?.class] || 0) + 1;
  }
  const classes = {};
  for (const c of live) { const k = c.depth_class || c.depth?.class || c.quality_review?.depth?.class || 'unclassified'; classes[k] = (classes[k] || 0) + 1; }
  return {
    live_depth_classes: classes,
    by_desk: Object.fromEntries(Object.entries(byDesk).map(([k, v]) => [k, { stories: v.stories, median_words: median(v.words), median_dimensions: median(v.dims), median_sections: median(v.sections), classes: v.classes }])),
    upgraded_in_place: live.filter((c) => (c.revisions || []).some((r) => r.kind === 'depth_upgrade' || r.kind === 'editorial_quality_upgrade')).length,
    held_for_substance: held.filter((h) => (h.failures || []).some((f) => f.startsWith('depth:'))).length,
    held_total: held.length,
    external_coverage: cards.filter((c) => c.status === 'external_coverage').length,
    quality_states: Object.fromEntries(QUALITY_STATES.map((k) => [k, cards.filter((c) => !c.superseded_by && (c.quality_state || (c.status === 'external_coverage' ? 'external_coverage' : null)) === k).length])),
    unreviewed: cards.filter((c) => !c.superseded_by && !c.quality_state && c.status !== 'external_coverage').length,
    legacy_below_standard: cards.filter((c) => !c.superseded_by && ['legacy_acceptable', 'quality_upgrade_available'].includes(c.quality_state)).length,
    words_by_desk: Object.fromEntries([...new Set(live.map((c) => c.depth?.contract || c.quality_review?.depth?.contract || c.kind))].map((k) => { const ws = live.filter((c) => (c.depth?.contract || c.quality_review?.depth?.contract || c.kind) === k).map((c) => c.depth?.words ?? c.quality_review?.depth?.words).filter(Number.isFinite); return [k, median(ws)]; }).filter(([, v]) => v !== null)),
    market_modules_with_attached_market: live.filter((c) => c.intel?.rendered && c.has_market).length,
    intelligence_suppressed_non_additive: live.filter((c) => c.intel?.suppressed).length,
    visual_failures_this_run: held.filter((h) => (h.failures || []).some((f) => f.startsWith('visual:'))).length,
    provenance_failures_this_run: held.filter((h) => (h.failures || []).some((f) => f.startsWith('provenance:'))).length,
    duplication_failures_this_run: [...held, ...produced.map((a) => ({ failures: a.depth?.failures || [] }))].filter((h) => (h.failures || []).some((f) => /repeated|restates|duplicate/.test(f))).length,
    idea_repetitions_diagnostic: produced.reduce((s, a) => s + (a.depth?.idea_repetitions || 0), 0),
    revisions_this_run: events.filter((e) => e.event === 'revision').length
  };
}
