// Editorial pass: which stories may buy an OpenAI rewrite this pass, and what publishes for each.
//
// PAID BOUNDARY (wnba-editorial-eligibility/1.0.0). On an automatic pass only a GENUINELY NEW canonical story — one with
// no stored predecessor (same id, or the story the merge would map it onto) — may reach the OpenAI transport, and only
// once (one attempt). An EXISTING story is maintained deterministically whatever changed: no editorial record, an older
// desk version, a changed draft, new visuals, corrected metadata, a generator or depth-policy upgrade, a new box-score
// observation. Its published rewrite stands while its shared facts are unchanged; when facts change the deterministic
// revision publishes and the prior editorial record is kept as provenance. The legacy upgrade pass runs with
// allowEditorial:false and has no path to the transport at all. The ONLY paid route for an existing story is an
// explicit admin re-edit or canary naming its ids (editorialOptions.only).
//
// Lines of defence, in order: (1) new-story eligibility, (2) the AI router's trigger allow-list (ai-router.js — an
// ineligible trigger routes DETERMINISTIC whatever the caller decided), (3) the draft-digest cache, (4) the per-pass call
// cap, (5) the token soft cap, (6) the daily nominal emergency ceiling.
//
// ROUTING (wnba-ai-router/1.0.0). Every paid-eligible story gets job.routing = route(...): lane, model, pool, effort,
// output cap and reason. The lane reaches the desk through an env overlay (laneEnv), the same technique the canary
// route uses; a DETERMINISTIC lane never calls. Every call log entry carries the routing and is written the moment
// the call returns.

import { draftDigest, editArticle, modelOf, budgetOf, isConfigured, EDITORIAL_KINDS, EDITORIAL_DESK_VERSION } from './editorial-desk.js';
import { callEntry, readCallLog, callLogWriter, eligibleTokens, guardUsd, governanceOf, governanceState } from './openai-cost.js';
import { route, laneEnv, reachesTransport, aiConfig, ROUTER_VERSION } from './ai-router.js';
import { findPredecessor as realFindPredecessor, sharedFactsUnchanged } from './lifecycle.js';
import { listedCard as realListedCard, lateCoverage as realLateCoverage } from './legacy.js';

export const ELIGIBILITY_VERSION = 'wnba-editorial-eligibility/1.0.0';
// A new story the desk had to defer (per-pass cap or breaker) before it was ever edited keeps its one call for a day.
export const PENDING_NEW_STORY_MS = 24 * 3600e3;

/**
 * Pure: may this story buy a model call on this pass, and under which class?
 *   allowEditorial false (legacy upgrade) -> never.  explicit ids (admin re-edit / canary) -> yes.
 *   no predecessor -> new_story.  predecessor -> no, unless it is a new story still pending its first call.
 */
export function paidEligibility({ allowEditorial = true, explicit = false, canary = false, existing, pe = null, now = Date.now() }) {
  if (!allowEditorial) return { paid: false, cls: 'legacy_upgrade' };
  if (explicit) return { paid: true, cls: canary ? 'canary' : 'manual_reedit' };
  if (!existing) return { paid: true, cls: 'new_story' };
  if (pe?.status === 'deferred' && pe.pending_new_story && now - Date.parse(pe.pending_since || '') < PENDING_NEW_STORY_MS) return { paid: true, cls: 'new_story' };
  return { paid: false, cls: 'existing_revision' };
}

const PAID_CLASSES = new Set(['new_story', 'manual_reedit', 'canary']);
// What an editorial record keeps of its routing decision (provenance: which lane/model/pool and why).
const routingRecord = (r) => (r ? { lane: r.lane, model: r.model, pool: r.pool, reason: r.reason, flagship_eligible: Boolean(r.flagship_eligible), flagship_class: r.flagship_class || null, router_version: r.router_version } : null);

export function makeEditorialGate({
  env, started, now, priorIndex, priorIds, getStored, withSlug, assessCandidate, stampAssessment, slugFor, sectionKey,
  names, held, publishable, errors, inspect = null, editorialOptions = null, fetchImpl,
  findPredecessor = realFindPredecessor, listedCard = realListedCard, lateCoverage = realLateCoverage, editImpl = editArticle
}) {
  const edOn = isConfigured(env);
  // editorialOptions (admin only): { only: Set of story ids, force: ignore the rewrite cache, canary, attempts, maxCalls }.
  // The normal cron pass passes none.
  const edOnly = editorialOptions?.only || null;
  const explicit = Boolean(edOnly);
  const base = budgetOf(env);
  const edBudget = {
    ...base,
    ...(explicit && editorialOptions?.maxCalls ? { maxCalls: editorialOptions.maxCalls } : {}),
    // Automatic passes: ONE attempt per new story, whatever the environment says. A corrective repair attempt exists
    // only for explicit admin/canary work.
    attempts: explicit ? Math.max(1, Math.min(2, Number(editorialOptions?.attempts || 1))) : 1
  };
  const callLog = [];
  // Each call's log entry is persisted immediately (serialized; retried at the end of the pass).
  const logWriter = env?.NEWS_KV ? callLogWriter(env.NEWS_KV, started) : null;
  const aiCfg = aiConfig(env);
  const routing = { version: ROUTER_VERSION, lanes: {}, reasons: {}, flagship_eligible: 0, flagship_enabled: aiCfg.flagshipEnabled };
  let todayLog = null;
  const gov = governanceOf(env);
  // An explicit admin re-edit/canary may pass the WNBA token soft cap (never the nominal emergency ceiling).
  const overrideCap = explicit && Boolean(editorialOptions?.overrideCap);
  const edDeadline = Date.now() + edBudget.deadlineMs;
  const eligibility = {
    version: ELIGIBILITY_VERSION,
    new_story_candidates: 0, new_story_openai_calls: 0,
    existing_revision_candidates: 0, existing_revision_openai_calls: 0,
    legacy_upgrade_candidates: 0, legacy_upgrade_openai_calls: 0,
    manual_reedit_calls: 0, canary_calls: 0
  };
  const edStats = { configured: edOn, provider: 'openai', model: edOn ? modelOf(env) : null, version: EDITORIAL_DESK_VERSION, calls: 0, applied: 0, cached: 0, fallback: 0, deferred: 0, maintained: 0, not_eligible: 0, failures: [], usage: { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 }, eligibility, routing };
  let edCalls = 0;
  const edRecord = (status, extra = {}) => ({ provider: 'openai', model: edOn ? modelOf(env) : null, version: EDITORIAL_DESK_VERSION, status, failures: [], at: started, ...extra });
  // Existing-story maintenance record: the deterministic revision publishes; the editorial origin is kept, not re-bought.
  const provenanceOf = (pe) => (pe?.status === 'deterministic_revision' ? pe.previous || null : pe ? { status: pe.status, version: pe.version || null, model: pe.model || null, at: pe.at || null, draft_digest: pe.draft_digest || null } : null);

  const gateMany = async (list, { allowEditorial = true } = {}) => {
    // Phase A: slug, late-coverage check, the deterministic draft through every gate, eligibility, the stored rewrite.
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
      // The desk improves how a PUBLISHABLE story is written; it never makes a held story publishable. A held draft
      // stays held and no model call is made for it.
      if (det.failures.length) { a.editorial = edRecord('draft_held'); edStats.draft_held = (edStats.draft_held || 0) + 1; continue; }
      if (!edOn) { a.editorial = edRecord('unconfigured'); continue; }
      if (edOnly && !edOnly.has(a.id)) { a.editorial = edRecord('not_selected'); continue; }
      // The stored story this draft will revise: the same id, or the predecessor the merge will map it onto (an injury
      // draft gets a new id whenever its feed listing changes; the merge keeps the original story and URL).
      const predCard = priorIndex.find((c) => c.id === a.id) || findPredecessor(a, priorIndex, { now }).prev || null;
      // A story that is not (or no longer) listed — retired, late coverage, withdrawn, superseded — never buys a rewrite.
      if (predCard && !listedCard(predCard) && !explicit) { a.editorial = edRecord('not_listed'); edStats.not_listed = (edStats.not_listed || 0) + 1; continue; }
      job.digest = await draftDigest(a);
      const prev = predCard ? await getStored(predCard.id).catch(() => null) : null;
      const pe = prev?.editorial || null;
      job.prev = prev;
      job.pe = pe;
      const elig = paidEligibility({ allowEditorial, explicit, canary: Boolean(editorialOptions?.canary), existing: Boolean(predCard), pe, now });
      job.cls = elig.cls;
      // The router enforces its own trigger allow-list: a non-paid class routes DETERMINISTIC (trigger_not_eligible:<cls>)
      // even if a caller got paidEligibility wrong.
      job.routing = route({ story: a, trigger: elig.cls, attempt: 1, env, hasKey: edOn });
      routing.lanes[job.routing.lane] = (routing.lanes[job.routing.lane] || 0) + 1;
      if (job.routing.flagship_eligible) routing.flagship_eligible += 1;
      if (Object.keys(routing.reasons).length < 20 || routing.reasons[job.routing.reason]) routing.reasons[job.routing.reason] = (routing.reasons[job.routing.reason] || 0) + 1;
      eligibility[`${elig.cls === 'canary' ? 'manual_reedit' : elig.cls}_candidates`] = (eligibility[`${elig.cls === 'canary' ? 'manual_reedit' : elig.cls}_candidates`] || 0) + 1;
      // Second line of defence: the draft-digest cache (free for every class; an admin `force` bypasses it).
      if (!editorialOptions?.force && pe && pe.draft_digest === job.digest) {
        if (pe.status === 'applied' && prev.editorial_draft) {
          const cand = { ...a, headline: prev.headline, deck: prev.deck, body: prev.body, sections: prev.sections, visuals: a.visuals };
          const r = assessCandidate(cand);
          if (!r.failures.length) { job.cached = { cand, r, record: { ...pe } }; continue; }
          if ((edStats.reuse_failures ||= []).length < 6) edStats.reuse_failures.push({ id: a.id, reason: `reuse_failed: ${r.failures[0]}`.slice(0, 140) });
        } else if (['fallback', 'deterministic_revision'].includes(pe.status)) { a.editorial = { ...pe }; job.decided = true; continue; }
      }
      if (!elig.paid) { job.maintain = true; continue; }
      // A paid-eligible story the router sends to the DETERMINISTIC lane makes no call: the deterministic draft stands.
      if (!reachesTransport(job.routing)) { job.routedOff = true; continue; }
      // An explicit re-edit is not bought twice for the same draft on the same day (canary work is exempt).
      if (elig.cls === 'manual_reedit') {
        todayLog ||= await readCallLog(env.NEWS_KV, started).catch(() => []);
        if (todayLog.some((c) => c.id === (prev?.id || a.id) && c.digest === job.digest && c.trigger === 'manual_reedit' && !c.error)) { job.maintain = true; job.duplicateManual = true; continue; }
      }
      if ((edStats.miss_detail ||= []).length < 25) edStats.miss_detail.push({ id: a.id, kind: a.kind, cls: elig.cls, stored_status: pe?.status || null, stored_digest: pe?.draft_digest || null, digest: job.digest });
      job.needsCall = true;
    }

    // Phase B: model calls. Structurally absent when allowEditorial is false; only paid classes may enter.
    const rank = { injury: 0, result: 1, performance: 1, preview: 2, transaction: 3, brief: 4, trend: 5 };
    const queue = allowEditorial
      ? jobs.filter((j) => j.needsCall && PAID_CLASSES.has(j.cls)).sort((x, y) => (priorIds.has(x.a.id) - priorIds.has(y.a.id)) || ((rank[x.a.kind] ?? 9) - (rank[y.a.kind] ?? 9)) || String(y.a.published_at).localeCompare(String(x.a.published_at)))
      : [];
    if (queue.length && todayLog === null) todayLog = await readCallLog(env.NEWS_KV, started).catch(() => []);
    const runJob = async (job) => {
      // Invariant: an existing story on an automatic pass can never reach the transport.
      if (!allowEditorial || !PAID_CLASSES.has(job.cls) || (job.cls === 'new_story' && explicit)) throw new Error(`editorial eligibility violated: ${job.cls}`);
      // Second invariant: only a STANDARD/FLAGSHIP routing decision reaches the transport (laneEnv throws otherwise).
      const laneEnvironment = laneEnv(env, job.routing);
      const onCall = (c) => {
        const trigger = c.attempt > 1 ? 'repair' : job.cls;
        // A repair attempt is re-checked against the router's allow-list (attempt 2 of manual_reedit/canary only).
        const r = c.attempt > 1 ? route({ story: job.a, trigger: 'repair', attempt: c.attempt, parentTrigger: job.cls, env, hasKey: edOn }) : job.routing;
        const entry = callEntry({ worker: 'wnba-news', id: job.prev?.id || job.a.id, model: job.routing.model, trigger, digest: job.digest, at: new Date().toISOString(), story_class: job.a.kind, routing: { ...job.routing, reason: r.lane === job.routing.lane ? job.routing.reason : `${job.routing.reason}; repair: ${r.reason}` }, rates: aiCfg.rates, ...c });
        callLog.push(entry);
        if (job.cls === 'new_story') eligibility.new_story_openai_calls += 1;
        else if (job.cls === 'canary') eligibility.canary_calls += 1;
        else eligibility.manual_reedit_calls += 1;
        return logWriter ? logWriter.append(entry) : undefined;
      };
      job.edited = await editImpl(laneEnvironment, job.a, { keyOf: sectionKey, assess: assessCandidate, draftAssessment: job.det, names, attempts: edBudget.attempts, onCall, fetchImpl, timeoutMs: Math.max(5e3, Math.min(edBudget.timeoutMs, edDeadline - Date.now())) });
    };
    let qi = 0;
    const worker = async () => {
      while (qi < queue.length) {
        const job = queue[qi]; qi += 1;
        if (edCalls >= edBudget.maxCalls || Date.now() > edDeadline - 5e3) { job.deferred = true; continue; }
        // WNBA operating guard: at the eligible-token soft cap new AI rewrites defer to deterministic copy for the rest
        // of the UTC day (explicit admin override excepted).
        const tokens = eligibleTokens(todayLog) + eligibleTokens(callLog);
        if (!overrideCap && gov.soft_cap_tokens && tokens >= gov.soft_cap_tokens) { job.deferred = true; edStats.token_cap = true; continue; }
        // Emergency fallback: the nominal (standard-rate) ceiling, far above normal usage. No override.
        if (edBudget.dailyMaxUsd && guardUsd(todayLog) + guardUsd(callLog) >= edBudget.dailyMaxUsd) { job.deferred = true; edStats.breaker = true; continue; }
        edCalls += 1;
        await runJob(job).catch((e) => { job.edited = { article: null, editorial: { ...edRecord('fallback'), failures: [`desk: ${String(e?.message || e).slice(0, 160)}`] } }; });
      }
    };
    await Promise.all(Array.from({ length: Math.min(edBudget.concurrency, queue.length) }, worker));
    // Entries were written as each call returned; this retries any write that failed and reports what never landed.
    if (logWriter) {
      const fl = await logWriter.flush().catch((e) => ({ pending: -1, failures: [String(e?.message || e)] }));
      if (fl.failures.length) edStats.call_log_write_retries = fl.failures.length;
      if (fl.pending) errors.push(`openai cost log: ${fl.pending} entr${fl.pending === 1 ? 'y' : 'ies'} unwritten${fl.failures.length ? ` (${fl.failures[fl.failures.length - 1]})` : ''}`);
    }

    // Phase C: choose what publishes. A rewrite publishes only when it passed every gate; otherwise the deterministic
    // draft publishes if IT passes; otherwise the story is held with both sets of reasons.
    const out = [];
    for (const job of jobs) {
      if (job.done) { out.push(job.final); continue; }
      const { a } = job;
      let final = a;
      // With unchanged shared facts a published rewrite stands (new visuals attached); otherwise the fresh draft.
      const keepRewrite = () => {
        const p = job.prev;
        if (p?.editorial?.status !== 'applied' || !sharedFactsUnchanged(p, a)) return null;
        const keep = { ...p, visuals: a.visuals, sections: (p.sections || []).map((sec, i) => ({ ...sec, ...(a.sections?.[i]?.visuals ? { visuals: a.sections[i].visuals } : {}) })) };
        const k = stampAssessment(keep, assessCandidate(keep));
        return k.status === 'published' ? k : null;
      };
      if (job.cached) {
        final = stampAssessment(job.cached.cand, job.cached.r);
        final.editorial = { ...job.cached.record, cached: true };
        final.editorial_draft = { headline: a.headline, deck: a.deck, body: a.body, sections: a.sections };
        edStats.cached += 1;
      } else if (job.maintain) {
        // Existing-story maintenance: model-free by construction.
        const kept = keepRewrite();
        if (kept) { final = kept; edStats.kept_published_rewrite = (edStats.kept_published_rewrite || 0) + 1; }
        else a.editorial = edRecord('deterministic_revision', { draft_digest: job.digest, eligibility: job.cls, previous: provenanceOf(job.pe), ...(job.duplicateManual ? { failures: ['manual re-edit already paid for this draft today'] } : {}) });
        edStats.maintained += 1;
      } else if (job.edited) {
        edStats.calls += job.edited.editorial.attempts || 1;
        edStats.usage.input_tokens += job.edited.editorial.usage?.input_tokens || 0;
        edStats.usage.output_tokens += job.edited.editorial.usage?.output_tokens || 0;
        edStats.usage.reasoning_tokens += job.edited.editorial.usage?.reasoning_tokens || 0;
        const record = { ...job.edited.editorial, draft_digest: job.digest, eligibility: job.cls, routing: routingRecord(job.routing), at: started };
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
      } else if (job.routedOff) {
        // Paid-eligible, but the router chose the DETERMINISTIC lane: no call; the deterministic draft publishes.
        a.editorial = edRecord('deterministic', { draft_digest: job.digest, eligibility: job.cls, routing: routingRecord(job.routing), failures: [`routing: ${job.routing.reason}`] });
        edStats.routed_deterministic = (edStats.routed_deterministic || 0) + 1;
      } else if (job.deferred) {
        const kept = keepRewrite();
        if (kept) { final = kept; edStats.kept_published_rewrite = (edStats.kept_published_rewrite || 0) + 1; }
        else {
          const pending = job.cls === 'new_story';
          a.editorial = edRecord('deferred', { draft_digest: job.digest, ...(pending ? { pending_new_story: true, pending_since: job.pe?.pending_since || started } : {}), failures: [pending ? 'editorial budget for this pass used; the deterministic draft stands and this new story keeps its one call for 24h' : 'editorial budget for this pass used; the deterministic draft stands'] });
        }
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
  const budgetReport = () => ({ max_calls: edBudget.maxCalls, attempts: edBudget.attempts, nominal_emergency_usd: edBudget.dailyMaxUsd, ...(todayLog ? { before_pass: governanceState(todayLog, env) } : { soft_cap_tokens: gov.soft_cap_tokens }) });
  return { gateMany, edStats, edBudget, budgetReport };
}

// Explicit admin re-edit / bounded backfill: named ids, an explicit max count, and a confirmed cost estimate before
// anything runs. The estimate is an upper bound per attempt: a generous input size and the full output cap.
export const REEDIT_MAX_IDS = 10;
const EST_INPUT_TOKENS = 12000;
export function reeditPlan({ ids = [], max = null, confirmUsd = null, repair = false, maxOutputTokens = 5000, costUsd }) {
  const list = [...new Set(ids.map((x) => String(x).trim()).filter(Boolean))];
  if (!list.length) return { ok: false, error: 'ids required: name each article id (no catalog or version sweeps)' };
  if (list.some((x) => !/^[A-Za-z0-9_-]{4,120}$/.test(x) || /^(all|catalog|every|\*)$/i.test(x))) return { ok: false, error: 'ids must be specific article ids' };
  const n = Number(max);
  if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'max required: an explicit integer count of paid stories' };
  if (n < list.length) return { ok: false, error: `max ${n} is below the ${list.length} named ids` };
  if (n > REEDIT_MAX_IDS || list.length > REEDIT_MAX_IDS) return { ok: false, error: `at most ${REEDIT_MAX_IDS} stories per re-edit` };
  const attempts = repair ? 2 : 1;
  const estimate = Math.round(list.length * attempts * costUsd(EST_INPUT_TOKENS, maxOutputTokens) * 1e4) / 1e4;
  const confirmed = confirmUsd !== null && confirmUsd !== '' && Number(confirmUsd) >= estimate;
  return { ok: true, ids: list, max: n, attempts, estimate_usd: estimate, confirmed, ...(confirmed ? {} : { detail: `not executed: pass confirm_usd >= ${estimate} to run` }) };
}
