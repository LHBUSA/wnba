// Orchestrates one newsroom article pass: gather structured inputs from
// wnba-api (service binding), run every generator, gate, store in KV (and
// Supabase when bound). Deterministic ids: a re-run rewrites the same article
// only when its inputs changed (input_hash) or the generator version moved.

import { injuryArticles, transactionArticles, resultArticles, previewArticles, trendArticles, propArticles, marketMoveArticles, withSlug, cardOf, regate, slugFor, ARTICLE_VERSION } from './articles.js';
import { briefArticles, underlyingEvent, BRIEF_VERSION } from './briefs.js';
import { PREVIEW_LEAD_MS } from './deep.js';
import { withheldBySourcePolicy } from './sources.js';
import { assessDepth, sectionKey, DEPTH_VERSION } from './depth.js';
import { reviewStory, needsReview, assessStored, listedCard, lateCoverage, LEGACY_POLICY_VERSION, QUALITY_STATES } from './legacy.js';
import { reconcileArticle, RECONCILE_VERSION } from './reconcile.js';
import { internationalArticles, INTL_VERSION } from './international.js';
import { mergeArticles, applyTrendDecisions, trendMarketOf, sharedFactsUnchanged, findPredecessor } from './lifecycle.js';
import { qualityFailures } from './quality.js';
import { articleIdentityFailures, auditStoredIdentity, IDENTITY_VERSION } from './identity.js';
import { regularSeasonIds, playoffContext, seasonOverTeams, PLAYOFF_CONTEXT_VERSION } from './playoff-context.js';
import { isConfigured as editorialConfigured, modelOf as edModelOf, budgetOf, draftDigest, editArticle, EDITORIAL_KINDS, EDITORIAL_DESK_VERSION } from './editorial-desk.js';
import { callEntry, readCallLog, appendCallLog, spentUsd } from './openai-cost.js';
import { applyCorrections, CORRECTIONS_VERSION } from './corrections.js';

const et = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replaceAll('-', '');
const add = (s, n) => { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + n)); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; };

// The Worker is scheduled every 10 minutes. Keep the guard slightly below the cron interval so
// normal Cloudflare scheduling jitter cannot turn a 10-minute source cadence into a 20/30-minute
// article cadence. Input hashes below still guarantee unchanged stories are never rewritten.
export const ARTICLE_RUN_MIN_GAP_MS = 9 * 60e3;

// Story identity, editorial-origin clock, duplicate repair and supersession live in lifecycle.js.
export { articleFirstPublishedAt, injuryIdentity } from './lifecycle.js';

/**
 * Known factual defects in stories written by older generators, found in production and fixed at the generator.
 * A match rebuilds the story in place (same id, URL and first publication) through the normal gate.
 */
export const KNOWN_DEFECTS = [
  // wnba-articles <= 1.5.0: the schedule's season.type went null, the regular-season id set was empty, and every
  // result reported both teams' records as 0-0.
  ['zero_records', /\bwere 0-0 and the [A-Z][\w’']+ 0-0\b/],
  // wnba-articles <= 1.5.0 injury copy: a template headline in place of the fact, and "started none ... played 0
  // minutes" for a player who had not played in the window.
  ['uneven_stretch_template', /\bafter an uneven recent stretch\b/],
  ['zero_minutes', /\bstarted none and played 0(?:\.0)? minutes\b/]
];
export const KNOWN_DEFECTS_VERSION = 'wnba-known-defects/1.1.0';
export function knownDefect(item) {
  const text = [item?.headline, item?.deck, ...(item?.body || [])].join(' ');
  return KNOWN_DEFECTS.find(([, re]) => re.test(text))?.[0] || null;
}

export async function runArticles(env, { apiGet, dict, externalItems, force = false, intlGet = null, breaking = false, backfillInternational = false, mediaFor = null, inspect = null, editorialOptions = null }) {
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
  const [inj, tx, sched, longSched, standings, props, playoffs, seasonInfo] = await Promise.all([
    soft('/v1/injuries'),
    soft('/v1/transactions'),
    soft(`/v1/schedule?from=${add(today, -14)}&to=${add(today, 7)}`),
    soft(`/v1/schedule?from=${add(today, -50)}&to=${today}`),
    soft('/v1/standings'),
    soft('/v1/props'),
    // Postseason series (game numbers, if-necessary games, series score) and the season-type date windows.
    soft('/v1/playoffs'),
    soft('/v1/season')
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
  // ESPN's schedule no longer always carries season.type; when it is missing the phase comes from the /v1/season
  // date windows (and playoff notes), so records never silently collapse to 0-0.
  const seasonTypes = seasonInfo?.types || [];
  const regIds = new Set();
  for (let from = `${season}0501`; from < today;) {
    const to = [add(from, 59), today].sort()[0];
    const chunk = await soft(`/v1/schedule?from=${from}&to=${to}`);
    for (const id of regularSeasonIds(chunk?.games || [], seasonTypes)) regIds.add(id);
    from = add(to, 1);
  }
  const ctx = { api, injuries: inj?.items || [], externalByPlayer, schedule: games, standingsById, now, transactions: tx?.items || [], dict, finals, upcoming, finalsByTeam, teams: dict.teamsList || [], props, season, regIds, seasonTypes, playoffs: playoffs?.season === season ? playoffs : null, previewLeadMs: PREVIEW_LEAD_MS, meter, asOf: started };
  const runs = {};
  const produced = [];
  let coverageDecisions = [];
  const deskDecisions = {};
  let trendDecisions = null; // the COMPLETE trend-desk measurement of this pass (status keeps a trimmed copy)
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
    ['brief', async () => { const xs = await briefArticles({ externalItems, structured: produced, now, existingIds: new Set(priorIndex.map((c) => c.id)), ctx: { api, injuries: inj?.items || null, transactions: tx?.items || [], schedule: games, standingsById, season, dict, playoffs: ctx.playoffs } }); coverageDecisions = xs.decisions || []; return xs; }, true]
  ]) {
    if (!on) { runs[name] = 'skipped (daily)'; continue; }
    try {
      const xs = await fn(ctx);
      runs[name] = xs.length;
      if (Array.isArray(xs.decisions) && name !== 'brief') deskDecisions[name] = xs.decisions.slice(0, 30);
      if (name === 'trend' && Array.isArray(xs.decisions)) trendDecisions = xs.decisions;
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
  const priorIds = new Set(priorIndex.map((c) => c.id));
  const getStored = (id) => env.NEWS_KV.get(`art:v1:item:${id}`, 'json');
  // The complete publication gate chain for one candidate (deterministic draft or editorial rewrite). Pure: nothing is
  // written to the candidate here.
  //   gate.js (+ Intelligence contract) · reconcile (prose lint, season, injuries, co-leaders, market, rest, comment text)
  //   · identity (subject/roster/event consensus) · quality (provenance, visuals, storycraft) · depth ladder.
  const assessCandidate = (a) => {
    const gate = regate(a);
    const reconcile = reconcileArticle(a, { season, injuries: feed });
    const identity = articleIdentityFailures(a, { dict });
    const quality = qualityFailures(a, { media: mediaFor ? mediaFor(a) : null, generatedAt: a.provenance?.generated_at || a.updated_at });
    const depth = assessDepth(a, { now });
    const failures = [...new Set([...gate.failures, ...reconcile.failures, ...identity, ...quality, ...(depth.pass ? [] : depth.failures)])];
    return { failures, gate, reconcile, identity, quality, depth };
  };
  const stampAssessment = (a, r) => {
    a.gate = r.gate;
    a.reconcile = { ...r.reconcile, failures: [...r.reconcile.failures, ...r.identity, ...r.quality, ...(r.depth.pass ? [] : r.depth.failures.filter((f) => !r.gate.failures.includes(f)))] };
    a.identity_failures = r.identity;
    a.quality = r.quality;
    a.depth = r.depth;
    a.status = r.failures.length ? 'held' : 'published';
    return a;
  };

  // Editorial desk (editorial-desk.js): bounded per pass, parallel, fail-closed, cached by draft digest.
  const edOn = editorialConfigured(env);
  // editorialOptions (admin canary only): { only: Set of story ids the desk may touch, force: ignore the rewrite cache,
  // maxCalls }. The normal cron pass passes none.
  const edOnly = editorialOptions?.only || null;
  const edBudget = { ...budgetOf(env), ...(editorialOptions?.maxCalls ? { maxCalls: editorialOptions.maxCalls } : {}), ...(editorialOptions?.attempts ? { attempts: editorialOptions.attempts } : {}) };
  // Cost telemetry + daily circuit breaker (openai-cost.js). The trigger names why a call was paid for.
  const edTrigger = editorialOptions?.trigger || (backfillInternational ? 'backfill' : force && !breaking ? 'manual_reedit' : null);
  const callLog = [];
  let spentToday = null;
  const edDeadline = Date.now() + edBudget.deadlineMs;
  const edNames = { players: [...(dict.playerById?.values?.() || [])].map((p) => p.name).filter(Boolean), teams: (dict.teamsList || []).map((t) => ({ name: t.name, short_name: t.short_name })) };
  const edStats = { configured: edOn, provider: 'openai', model: edOn ? edModelOf(env) : null, version: EDITORIAL_DESK_VERSION, calls: 0, applied: 0, cached: 0, fallback: 0, deferred: 0, not_eligible: 0, failures: [], usage: { input_tokens: 0, output_tokens: 0 } };
  let edCalls = 0;
  const edRecord = (status, extra = {}) => ({ provider: 'openai', model: edOn ? edModelOf(env) : null, version: EDITORIAL_DESK_VERSION, status, failures: [], at: started, ...extra });

  const gateMany = async (list) => {
    // Phase A: slug, late-coverage check, the deterministic draft through every gate, the stored rewrite (if any).
    const jobs = [];
    for (const a0 of list) {
      const a = await withSlug(a0);
      // A story that has never been published and would arrive long after its event is late coverage, not news.
      const late = priorIds.has(a.id) ? null : lateCoverage(a, now);
      if (late) {
        a.status = 'held';
        a.reconcile = { ok: false, failures: [late] };
        a.depth = { class: null, score: null, words: null };
        held.push({ id: a.id, kind: a.kind, headline: a.headline, depth: a.depth, failures: [late], at: started });
        jobs.push({ a, done: true, final: a });
        continue;
      }
      const det = assessCandidate(a);
      stampAssessment(a, det);
      const job = { a, det, final: null };
      jobs.push(job);
      if (!EDITORIAL_KINDS.has(a.kind)) { edStats.not_eligible += 1; continue; }
      // The desk improves how a PUBLISHABLE story is written; it never makes a held story publishable. A draft the
      // gates hold (too thin for its class, a lint failure, anything) stays held: a rewrite cannot add evidence, so
      // lifting it over a floor could only be padding. No model call is made for it.
      if (det.failures.length) { a.editorial = edRecord('draft_held'); edStats.draft_held = (edStats.draft_held || 0) + 1; continue; }
      if (!edOn) { a.editorial = edRecord('unconfigured'); continue; }
      if (edOnly && !edOnly.has(a.id)) { a.editorial = edRecord('not_selected'); continue; }
      // A story that is not (or no longer) listed — retired, late coverage, withdrawn, superseded — never buys a rewrite.
      const listedPrev = priorIndex.find((c) => c.id === a.id) || findPredecessor(a, priorIndex, { now }).prev;
      if (listedPrev && !listedCard(listedPrev) && !edOnly) { a.editorial = edRecord('not_listed'); edStats.not_listed = (edStats.not_listed || 0) + 1; continue; }
      job.digest = await draftDigest(a);
      // The stored story this draft will revise: the same id, or the predecessor the merge will map it onto (an injury
      // draft gets a new id whenever its feed listing changes; the merge keeps the original story and URL).
      const predId = priorIds.has(a.id) ? a.id : findPredecessor(a, priorIndex, { now }).prev?.id || null;
      const prev = predId && !editorialOptions?.force ? await getStored(predId).catch(() => null) : null;
      const pe = prev?.editorial;
      job.prev = prev;
      let miss = !prev ? 'no_stored_item' : !pe ? 'no_editorial_record' : pe.version !== EDITORIAL_DESK_VERSION ? 'desk_version' : pe.draft_digest !== job.digest ? 'draft_changed' : !['applied', 'fallback'].includes(pe.status) ? `status_${pe.status}` : null;
      if (!miss) {
        if (pe.status === 'applied' && prev.editorial_draft) {
          // Reuse the stored rewrite: same draft, same facts — no model call, and the lifecycle sees an unchanged story.
          const cand = { ...a, headline: prev.headline, deck: prev.deck, body: prev.body, sections: prev.sections, visuals: a.visuals };
          const r = assessCandidate(cand);
          if (!r.failures.length) { job.cached = { cand, r, record: { ...pe } }; continue; }
          miss = `reuse_failed: ${r.failures[0]}`.slice(0, 140);
        } else if (pe.status === 'fallback') { a.editorial = { ...pe }; job.decided = true; continue; }
        else miss = 'applied_without_draft';
      }
      (edStats.cache_misses ||= {})[miss.split(':')[0]] = ((edStats.cache_misses || {})[miss.split(':')[0]] || 0) + 1;
      if (/^reuse_failed/.test(miss) && (edStats.reuse_failures ||= []).length < 6) edStats.reuse_failures.push({ id: a.id, reason: miss });
      if ((edStats.miss_detail ||= []).length < 25) edStats.miss_detail.push({ id: a.id, kind: a.kind, miss: miss.slice(0, 40), stored_status: pe?.status || null, stored_digest: pe?.draft_digest || null, digest: job.digest });
      job.needsCall = true;
    }
    // Phase B: model calls — new stories first, then by desk; bounded by count, deadline and concurrency.
    const rank = { injury: 0, result: 1, performance: 1, preview: 2, transaction: 3, brief: 4, trend: 5 };
    const queue = jobs.filter((j) => j.needsCall).sort((x, y) => (priorIds.has(x.a.id) - priorIds.has(y.a.id)) || ((rank[x.a.kind] ?? 9) - (rank[y.a.kind] ?? 9)) || String(y.a.published_at).localeCompare(String(x.a.published_at)));
    if (queue.length && spentToday === null) spentToday = spentUsd(await readCallLog(env.NEWS_KV, started).catch(() => []));
    const runJob = async (job) => {
      const trigger = edTrigger || (job.prev ? 'revision' : 'new_story');
      const onCall = (c) => callLog.push(callEntry({ worker: 'wnba-news', id: job.prev?.id || job.a.id, model: edModelOf(env), trigger: editorialOptions?.canary ? (c.attempt > 1 ? 'repair' : 'canary') : c.attempt > 1 ? 'repair' : trigger, digest: job.digest, at: new Date().toISOString(), ...c }));
      const r = await editArticle(env, job.a, { keyOf: sectionKey, assess: assessCandidate, draftAssessment: job.det, names: edNames, attempts: edBudget.attempts, onCall, timeoutMs: Math.max(5e3, Math.min(edBudget.timeoutMs, edDeadline - Date.now())) });
      job.edited = r;
    };
    let qi = 0;
    const worker = async () => {
      while (qi < queue.length) {
        const job = queue[qi]; qi += 1;
        if (edCalls >= edBudget.maxCalls || Date.now() > edDeadline - 5e3) { job.deferred = true; continue; }
        // Daily circuit breaker: past the ceiling, no paid call — the deterministic draft stands.
        if (edBudget.dailyMaxUsd && (spentToday || 0) + spentUsd(callLog) >= edBudget.dailyMaxUsd) { job.deferred = true; edStats.breaker = true; continue; }
        edCalls += 1;
        await runJob(job).catch((e) => { job.edited = { article: null, editorial: { ...edRecord('fallback'), failures: [`desk: ${String(e?.message || e).slice(0, 160)}`] } }; });
      }
    };
    await Promise.all(Array.from({ length: Math.min(edBudget.concurrency, queue.length) }, worker));
    if (callLog.length) {
      await appendCallLog(env.NEWS_KV, started, callLog.splice(0)).catch((e) => errors.push(`openai cost log: ${e.message}`));
    }
    // Phase C: choose what publishes. A rewrite publishes only when it passed every gate; otherwise the deterministic
    // draft publishes if IT passes; otherwise the story is held with both sets of reasons.
    const out = [];
    for (const job of jobs) {
      if (job.done) { out.push(job.final); continue; }
      const { a } = job;
      let final = a;
      if (job.cached) {
        final = stampAssessment(job.cached.cand, job.cached.r);
        final.editorial = { ...job.cached.record, cached: true };
        final.editorial_draft = { headline: a.headline, deck: a.deck, body: a.body, sections: a.sections };
        edStats.cached += 1;
      } else if (job.edited) {
        edStats.calls += job.edited.editorial.attempts || 1;
        edStats.usage.input_tokens += job.edited.editorial.usage?.input_tokens || 0;
        edStats.usage.output_tokens += job.edited.editorial.usage?.output_tokens || 0;
        const record = { ...job.edited.editorial, draft_digest: job.digest, at: started };
        if (job.edited.article) {
          final = stampAssessment(job.edited.article, job.edited.gate || assessCandidate(job.edited.article));
          final.editorial = record;
          final.editorial_draft = { headline: a.headline, deck: a.deck, body: a.body, sections: a.sections };
          if (!priorIds.has(a.id)) final.slug = slugFor(final);
          edStats.applied += 1;
        } else {
          a.editorial = record;
          edStats.fallback += 1;
          if (edStats.failures.length < 12) edStats.failures.push({ id: a.id, kind: a.kind, failures: record.failures.slice(0, 4) });
        }
      } else if (job.deferred) {
        // A published rewrite is not replaced by the deterministic draft just because this pass ran out of budget:
        // with unchanged facts the stored story stands (no revision); with changed facts the fresh draft publishes.
        const p = job.prev;
        if (p?.editorial?.status === 'applied' && sharedFactsUnchanged(p, a)) {
          const keep = { ...p, visuals: a.visuals, sections: (p.sections || []).map((sec, i) => ({ ...sec, ...(a.sections?.[i]?.visuals ? { visuals: a.sections[i].visuals } : {}) })) };
          final = stampAssessment(keep, assessCandidate(keep));
          if (final.status !== 'published') final = a;
          else edStats.kept_published_rewrite = (edStats.kept_published_rewrite || 0) + 1;
        }
        if (final === a) a.editorial = edRecord('deferred', { draft_digest: job.digest, failures: ['editorial budget for this pass used; the deterministic draft stands and the desk retries next pass'] });
        edStats.deferred += 1;
      }
      if (inspect) inspect(final);
      if (final.status !== 'published') {
        const edFail = final.editorial?.status === 'fallback' ? final.editorial.failures.map((x) => `editorial: ${x}`) : [];
        held.push({ id: final.id, kind: final.kind, headline: final.headline, depth: { class: final.depth.class, score: final.depth.score, words: final.depth.words }, failures: [...new Set([...final.gate.failures, ...final.reconcile.failures, ...edFail])].slice(0, 10), at: started });
      } else publishable.push(final);
      out.push(final);
    }
    return out;
  };
  const gateOne = async (a0) => (await gateMany([a0]))[0];
  await gateMany(produced);

  // Legacy upgrade pass (legacy.js): a live story below the current standard whose records are still in reach is rebuilt
  // by the CURRENT generator for its desk and goes through exactly the same gate. Bounded per pass; never creates a story.
  const producedIds = new Set(produced.map((a) => a.id));
  const regenerations = new Map();
  const getItem = (id) => env.NEWS_KV.get(`art:v1:item:${id}`, 'json');
  let upgradeBudget = 40; // one-time/current-policy cleanup can rebuild far more of the existing catalog
  for (const c of priorIndex) {
    if (upgradeBudget <= 0) break;
    if (!listedCard(c) || producedIds.has(c.id) || !['result', 'performance', 'transaction', 'trend'].includes(c.kind)) continue;
    // A listed story written by an older generator may carry a known factual defect that its depth review cannot see
    // (knownDefect): it is rebuilt in place by the current generator whatever its review state.
    const olderGenerator = String(c.input_hash || '').split('|')[0] !== ARTICLE_VERSION;
    if (!needsReview(c) && !olderGenerator) continue;
    const item = await getItem(c.id).catch(() => null);
    if (!item) continue;
    const defect = olderGenerator ? knownDefect(item) : null;
    // A listed game/trend/transaction story from an older generator is rebuilt in place so it carries the current
    // copy and its frozen data visuals (same id, URL and first publication; the normal gate decides).
    const visualBacklog = olderGenerator && !(item.visuals || []).length && ['result', 'performance', 'transaction', 'trend'].includes(c.kind);
    if (!defect && !visualBacklog && (!needsReview(c) || assessStored(item, { now }).pass)) continue;
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
  const { index: next, written, repairs, events, novelty } = await mergeArticles({
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

  const writtenIdsEarly = new Set(events.map((e) => e.id));
  // Trend lifecycle: only a complete, error-free trend-desk pass may change which trend episodes are current. The
  // team's published story is current; a run the desk measured as no longer material ends and leaves every listing.
  const trendLifecycle = trendDecisions && typeof runs.trend === 'number'
    ? applyTrendDecisions(next, trendDecisions, { at: started, publishedIds: new Set(publishable.filter((a) => a.kind === 'trend').map((a) => a.id)) })
    : null;

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
  // A preview of an if-necessary playoff game the series has not forced is not current news: it leaves the listings
  // (URL kept) and returns automatically when the generator previews the game again (written => current_quality).
  const unforced = [];
  if (ctx.playoffs) {
    for (const c of next) {
      if (c.kind !== 'preview' || c.superseded_by || writtenIdsEarly.has(c.id) || c.quality_state === 'retired_from_index') continue;
      const gid = (c.entities || []).find((e) => e?.type === 'game')?.id;
      const po = gid ? playoffContext(ctx.playoffs, gid) : null;
      if (!po || po.needed) continue;
      c.quality_state = 'retired_from_index';
      c.quality_review = { policy: LEGACY_POLICY_VERSION, state: 'retired_from_index', reason: `Game ${po.game_number} of the ${po.round.toLowerCase()} is an if-necessary game the series has not forced; the preview returns if it is played`, at: started, unforced_if_necessary: true };
      unforced.push(c.id);
    }
  }
  // Reviewed editorial corrections: a published story that was wrong is retired with its correction (corrections.js).
  // Listed cards the current newsroom cannot stand behind and cannot rebuild:
  //   * during the postseason, an eliminated team's injury listing affects no game (same rule as generation);
  //   * an older-generator story with a known defect the upgrade pass could not rebuild in place.
  // Both leave the listings with a stated reason; the URL and record stay. Decided once per defect-list version.
  const overTeams = seasonOverTeams(ctx.playoffs);
  const legacyRetired = [];
  for (const c of next) {
    if (c.superseded_by || c.correction || !listedCard(c) || writtenIdsEarly.has(c.id)) continue;
    if (c.kind === 'injury' && overTeams.has(String(c.lead_team_id))) {
      c.quality_state = 'retired_from_index';
      c.quality_review = { policy: LEGACY_POLICY_VERSION, state: 'retired_from_index', reason: 'the team’s season is over, so this injury listing affects no remaining game; kept at its URL', at: started, season_over: true };
      legacyRetired.push({ id: c.id, reason: 'season_over' });
      continue;
    }
    if (c.defect_review === KNOWN_DEFECTS_VERSION || !['injury', 'result', 'performance', 'transaction', 'trend'].includes(c.kind)) continue;
    if (String(c.input_hash || '').split('|')[0] === ARTICLE_VERSION) { c.defect_review = KNOWN_DEFECTS_VERSION; continue; }
    const item = await env.NEWS_KV.get(`art:v1:item:${c.id}`, 'json').catch(() => null);
    const defect = item ? knownDefect(item) : null;
    c.defect_review = KNOWN_DEFECTS_VERSION;
    if (!defect || regenerations.get(c.id)?.passed) continue;
    c.quality_state = 'legacy_acceptable';
    c.quality_review = { policy: LEGACY_POLICY_VERSION, state: 'legacy_acceptable', reason: `published under an older generator with a known copy defect (${defect}) the current generator no longer writes, and its records are out of reach for an in-place rebuild; kept at its URL`, at: started, known_defect: defect };
    legacyRetired.push({ id: c.id, reason: defect });
  }
  const corrections = await applyCorrections(next, { at: started, getItem: (id) => env.NEWS_KV.get(`art:v1:item:${id}`, 'json'), putItem: (a) => env.NEWS_KV.put(`art:v1:item:${a.id}`, JSON.stringify(a), { expirationTtl: 120 * 86400 }) });
  // Every live story gets an intentional quality state (legacy.js). Rewritten stories passed the gate this pass.
  const writtenIds = new Set(events.map((e) => e.id));
  let reviewed = 0;
  const reviewLimit = 500; // full current catalog review after a policy/version change
  for (const c of next) {
    if (c.superseded_by) continue;
    if (writtenIds.has(c.id) && !c.correction && !lateCoverage(c)) { c.quality_state = 'current_quality'; c.quality_review = { policy: LEGACY_POLICY_VERSION, state: 'current_quality', reason: 'written this pass through the current gate', at: started, generator: String(c.input_hash || '').split('|')[0] || null }; continue; }
    if (!needsReview(c) || reviewed >= reviewLimit) continue;
    reviewed += 1;
    const teamName = c.kind === 'trend' ? (ctx.teams || []).find((t) => String(t.team_id) === String(c.lead_team_id))?.short_name : null;
    const deskDecision = teamName ? (trendDecisions || []).find((x) => x.team === teamName && x.market === trendMarketOf(c)) || null : null;
    const review = reviewStory({ card: c, item: await getItem(c.id).catch(() => null), now, regeneration: regenerations.has(c.id) ? regenerations.get(c.id) : null, cards: next, withheld: withheldBySourcePolicy(c), deskDecision });
    c.quality_state = review.state;
    c.quality_review = review;
  }
  await env.NEWS_KV.put('art:v1:index', JSON.stringify(next));
  await env.NEWS_KV.put('art:v1:held', JSON.stringify(held.slice(0, 100)));
  const status = { at: started, trigger: backfillInternational ? 'backfill_international' : breaking ? 'breaking' : force ? 'forced' : 'cadence', backfill: backfill ? [...backfill] : null, version: ARTICLE_VERSION, brief_version: BRIEF_VERSION, reconcile_version: RECONCILE_VERSION, runs, produced: produced.length, written, held: held.length, published_total: next.filter(listedCard).length, legacy_policy: LEGACY_POLICY_VERSION, upgrades_attempted: [...regenerations.entries()].map(([id, r]) => ({ id, rebuilt: Boolean(r), passed: Boolean(r?.passed) })), depth_version: DEPTH_VERSION, newsroom_health: newsroomHealth(next, { produced: publishable, held, events }), identity_version: IDENTITY_VERSION, integrity_audit: integrityAudit, coverage_decisions: coverageDecisions.slice(0, 60), desk_decisions: deskDecisions, demotions, corrections: { version: CORRECTIONS_VERSION, applied: corrections }, unforced_previews_retired: unforced, legacy_retired: legacyRetired, editorial: { ...edStats, budget: { max_calls: edBudget.maxCalls, attempts: edBudget.attempts, daily_max_usd: edBudget.dailyMaxUsd, spent_before_pass_usd: spentToday } }, lifecycle: { novelty, trend: trendLifecycle, repairs: repairs.slice(0, 40), events: events.slice(0, 40) }, subrequests: meter(), errors: errors.slice(0, 10) };
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
