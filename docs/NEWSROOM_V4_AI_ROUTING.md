# WNBA Newsroom V4 — AI routing (stage 2)

Status: **BUILT, TESTED, ON MAIN — NOT DEPLOYED.** The `wnba-news` Worker deploy waits for the Tennis stage-1 proof
(owner order, 2026-09-29). Router `wnba-ai-router/1.0.0`, cost log `wnba-openai-cost/2.1.0`, desk `wnba-editorial/1.0.0`
(unchanged), eligibility `wnba-editorial-eligibility/1.0.0` (unchanged). Mirrors the Tennis reference router
(`tennis-ai-router`) so every PropBetEdge newsroom routes, logs and governs the same way.

## What changed, what did not

Unchanged (owner order): `paidEligibility` (new-story-only automatic calls; the legacy pass runs with
`allowEditorial:false`; existing revisions are model-free; one automatic attempt pinned), the WNBA token soft cap
(400k, warn 350k), nominal-cost telemetry naming (`nominal_standard_cost`, never "billed"), the canary route
`POST /run?editorial=canary` and the re-edit route `POST /run?editorial=reedit`.

New:

| file | what |
|---|---|
| `workers/wnba-news/src/ai-router.js` | lanes, pools, rates, trigger allow-list, flagship eligibility, `route()`, `laneEnv()` |
| `workers/wnba-news/src/editorial-pass.js` | `job.routing = route(...)` right after `paidEligibility`; lane reaches the desk via env overlay |
| `workers/wnba-news/src/editorial-desk.js` | `callModel` returns latency, response model, status, reasoning tokens; failed calls keep billed usage |
| `workers/wnba-news/src/openai-cost.js` | routed call entries, per-model nominal rates, immediate per-call writes, `by_lane`/`by_pool`/`by_model` |
| `workers/wnba-news/src/lifecycle.js` | `canonicalStoryKey()` — the transaction/brief id-drift fix |
| `scripts/ai-canary/` | offline blinded Sol-vs-Astra canary harness (`--dry` tested; never run against the API here) |

## Lanes

| lane | model (default) | pool | output cap | effort | when |
|---|---|---|---|---|---|
| `DETERMINISTIC` | none | none | 0 | — | trigger not on the allow-list; no key / `WNBA_EDITORIAL=off` |
| `VOLUME` | `gpt-5.4-mini` | volume | 2000 | low | defined for a future task; **never selected for article prose** |
| `STANDARD_EDITORIAL` | `gpt-5.6-sol` | premium | 5000 | medium | every eligible story by default |
| `FLAGSHIP_EDITORIAL` | `gpt-6-astra` | premium | 8000 | medium | flagship-eligible **and** `WNBA_AI_FLAGSHIP_ENABLED="true"` **and** class released in `WNBA_AI_FLAGSHIP_CLASSES` |

Pools: `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol` → premium; `gpt-5.4-mini`, `gpt-5.4-nano` → volume;
an unknown model → premium (the stricter guard). The complimentary daily pools are shared across the organisation.

## Eligibility (trigger allow-list, enforced inside `route()`)

| trigger | reaches a transport? | notes |
|---|---|---|
| `new_story` | yes | genuinely new canonical story (no stored predecessor), one attempt |
| `manual_reedit` | yes | admin re-edit naming ids + max + confirmed estimate |
| `canary` | yes | admin canary naming ids; writes discarded |
| `repair` | only as **attempt 2** of `manual_reedit` / `canary` | automatic passes are pinned to 1 attempt |
| `existing_revision` | **no** → `DETERMINISTIC`, `trigger_not_eligible:existing_revision` | |
| `legacy_upgrade` | **no** → `DETERMINISTIC`, `trigger_not_eligible:legacy_upgrade` | |
| anything else (`revision`, `backfill`, version change, correction, …) | **no** | |

Defence in depth: even if a caller bypassed `paidEligibility`, the router returns `DETERMINISTIC` for the trigger and
`laneEnv()` throws for any lane without a model, so the editorial desk never receives a transport environment.

## Flagship eligibility classes (proposal)

Deterministic from the stored story's `kind`, `facts` and depth class only — never from prose, never from a model.

| class id | rule | why |
|---|---|---|
| `finals_result` | `result`/`performance`, `facts.playoff.round` is the Finals (not semifinals), depth full/deep | the season's highest-stakes game stories |
| `series_clinch_result` | `result`/`performance`, `facts.playoff.decided_by_this_game`, depth deep | a series ends: clinch + elimination in one story |
| `decider_preview` | `preview`, `facts.playoff.stakes` contains `decider` (winner-take-all), depth full/deep | Game 3 / Game 5 / Game 7 previews |
| `major_trend_episode` | `trend`, depth deep, run ≥ 9 of the window one way (`atsW/atsL/ov/un`), ≥ 4 games by 10+ (`materiality.big`) | the rare long betting-trend run, not routine 7-of-10 streaks |
| `rich_packet` | any editorial kind at depth deep with ≥ `WNBA_AI_FLAGSHIP_RICH_EVIDENCE` (8) cited records | unusually rich structured packet |
| `commissioned` | commissioned editorial feature | listed for policy completeness; commissions run their own lane today and do not pass through this desk |

Release plan: none released. A class is released (added to `WNBA_AI_FLAGSHIP_CLASSES`) only after the offline canary
shows Astra beats Sol on that class **and** both pass the fact gate. Default stays Sol.

## Telemetry (KV `openai:v1:calls:<UTC day>`, one entry per actual Responses API call)

`worker, sport:'wnba', id, model, response_model, trigger, attempt, story_class, routing_lane, routing_reason, pool,
router_version, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, total_eligible_tokens, latency_ms,
status, response_id, nominal_standard_cost, digest, error, at`.

- `status`: `completed | incomplete | failed | refusal | empty | malformed | http_<code> | timeout | transport_error`.
- Billed usage on an incomplete / failed / refused / malformed response is recorded (it was logged as 0 before).
  A timeout or transport error has no body and logs 0 tokens with its status.
- Each entry is written **immediately** after its call (`callLogWriter`: appends serialized through one promise chain,
  the day log read once and extended in memory, a failed write kept pending and retried at the end of the pass; the
  pass reports `openai cost log: N entries unwritten` only if a retry also fails). The newsroom lease makes the pass the
  only writer.
- `nominal_standard_cost` = standard-rate equivalent from the rates table, cached input at the cached rate; **never a
  billed amount**. Only `gpt-5.6-sol` has a default rate (input 1.25, cached 0.125, output 10 per 1M); every other model
  reports `null` until `WNBA_AI_RATES` sets it. The nominal emergency ceiling counts an unpriced call at the standard
  constant, so an unpriced model is never free for the breaker.
- `GET /v1/newsroom/openai-cost` (admin) adds `by_lane`, `by_pool`, `by_model`, `totals.reasoning_tokens`,
  `totals.unpriced_calls`, `rates_usd_per_mtok`. Pre-2.1.0 entries group under `unrouted`.
- Each editorial record carries `routing { lane, model, pool, reason, flagship_eligible, flagship_class, router_version }`;
  the pass summary (`edStats.routing`) counts lanes and reasons.

## Id-drift fix (canonical story key)

Two desks minted a new id for the same canonical story, so the story became a `new_story` and bought a rewrite:

- **transaction** — id hashed the day's moves list; a second move the same day minted a new id. Key now
  `transaction:<team>:<YYYY-MM-DD>`.
- **brief** — id hashed the source-wire cluster id; a re-clustered event minted a new id. Key now
  `brief:<family>:player:<id>` (or `brief:<coaching|front_office>:team:<id>` with no player), families as the event
  registry (`injury`≡`availability`, roster lane, coaching, front_office, awards), matched only within the registry's
  72h same-event window. League-level briefs with no subject keep their cluster identity.

`findPredecessor` finds the prior card, so the drafted story is an `existing_revision` (0 calls) and the merge keeps its
id and URL. Computed from existing card fields — no index migration.

## Env knobs

| var | default | meaning |
|---|---|---|
| `WNBA_AI_STANDARD_MODEL` | `WNBA_EDITORIAL_MODEL` → `gpt-5.6-sol` | standard lane model |
| `WNBA_AI_FLAGSHIP_MODEL` | `gpt-6-astra` | flagship lane model |
| `WNBA_AI_FLAGSHIP_ENABLED` | `false` | only the exact string `true` enables |
| `WNBA_AI_FLAGSHIP_CLASSES` | empty (none) | comma list of released class ids |
| `WNBA_AI_VOLUME_MODEL` | `gpt-5.4-mini` | volume lane (unused for prose) |
| `WNBA_AI_STANDARD_MAX_OUTPUT` | `WNBA_EDITORIAL_MAX_OUTPUT_TOKENS` → 5000 | standard output cap |
| `WNBA_AI_FLAGSHIP_MAX_OUTPUT` | 8000 | flagship output cap |
| `WNBA_AI_VOLUME_MAX_OUTPUT` | 2000 | volume output cap |
| `WNBA_AI_STANDARD_EFFORT` | `WNBA_EDITORIAL_EFFORT` → `medium` | standard reasoning effort |
| `WNBA_AI_FLAGSHIP_EFFORT` | `medium` | flagship reasoning effort |
| `WNBA_AI_VOLUME_EFFORT` | `low` | volume reasoning effort |
| `WNBA_AI_FLAGSHIP_RICH_EVIDENCE` | 8 | `rich_packet` threshold |
| `WNBA_AI_POOLS` | — | JSON `{ model: pool }` override |
| `WNBA_AI_RATES` | — | JSON `{ model: { input, cached_input, output } }` nominal rates |

Existing knobs keep their meaning: `WNBA_EDITORIAL_MAX_CALLS` (2), `WNBA_EDITORIAL_ATTEMPTS` (ignored on automatic
passes), `WNBA_OPENAI_DAILY_TOKEN_SOFT_CAP` (400k), `WNBA_OPENAI_DAILY_TOKEN_WARN` (350k), `WNBA_OPENAI_DAILY_MAX_USD`
($25 nominal emergency). The canary route's `?model=` pins that model on the standard lane and disables flagship.

## Offline canary (`scripts/ai-canary/`)

```
node scripts/ai-canary/run.mjs --dry --drafts <drafts.json>      # pipeline check, no key, no network
node scripts/ai-canary/run.mjs --freeze-only --slugs a,b,c        # freeze real drafts from public GET /v1/articles/:slug
node scripts/ai-canary/run.mjs --drafts docs/evidence/ai-canary/<day>/drafts.frozen.json   # live (OPENAI_API_KEY in env)
```

Same instructions, packet, schema and rewrite gate as production, one attempt per model per draft. Outputs under
`docs/evidence/ai-canary/<date>/`: `blind-review.md` (VERSION A / VERSION B, order random per draft), `raw/*.json`
(blinded: model, response model, cap/effort and nominal cost stripped), `drafts.frozen.json`, and the sealed
`SEALED-model-key.json` + `SEALED-metrics.json` (fact/quality gate pass, words, repetition score, sections, input/output/
reasoning tokens, latency, nominal cost). Offline gates: the rewrite (fact) gate in full; quality = article validator +
provenance/visual/storycraft + depth contract + no depth regression. The live reconcile check (season/injury feed at run
time) is not reproducible offline. Never publishes; the only calls are the public read-only GET (when `--slugs`) and,
outside `--dry`, the Responses API. **Not run against the API in this build.**

## Deploy plan (when the Tennis stage-1 proof lands — owner go required)

1. Capture rollback: current `wnba-news` Worker version id + a KV snapshot of `art:v1:index` and today's
   `openai:v1:calls:<day>`.
2. Leave every new env var unset (defaults = Sol standard, flagship off, 5k cap). No secret changes.
3. `wrangler deploy` `wnba-news` from main (clean export). Verify `/health`, `/v1/articles`.
4. Watch the next cron passes: `art:v1:last_run.editorial.routing` shows lanes; `GET /v1/newsroom/openai-cost` shows
   `by_lane.STANDARD_EDITORIAL` for new stories only, `invariant_ok: true`, entries with routing fields and
   `reasoning_tokens`.
5. Run the offline canary on ~10 frozen production drafts across the flagship classes; score blind; decide per class.
6. Release a class only by setting `WNBA_AI_FLAGSHIP_ENABLED=true` + `WNBA_AI_FLAGSHIP_CLASSES=<class>`.

Rollback: `wrangler rollback <captured version>` (routing is code + env only; KV entries are additive and readable by
the previous version, which ignores the new fields). Kill switch without rollback: `WNBA_EDITORIAL=off` (all
deterministic) or `WNBA_AI_FLAGSHIP_ENABLED=false`.

## Acceptance checklist

- [ ] A genuinely new story gets model prose (lane `STANDARD_EDITORIAL`, one call, `trigger: new_story`).
- [ ] An existing revision does not (0 calls; `trigger_not_eligible:existing_revision` in `edStats.routing.reasons`).
- [ ] A same-day transaction with an added move and a re-clustered brief are existing revisions (0 calls, same URL).
- [ ] Legacy repair cannot reach a premium transport (`legacy_upgrade` → `DETERMINISTIC`; `laneEnv` refuses).
- [ ] Every call log entry records routing lane/reason, model + response model, pool, usage incl. reasoning tokens,
      latency, status; failed calls keep billed usage; entries appear during the pass, not only at its end.
- [ ] One automatic attempt (no `repair` entries from cron passes).
- [ ] Astra only on proven classes (flagship off by default; enabled + released class required).
- [ ] Fallback is fact-safe: a failed / incomplete / gate-failing rewrite publishes the deterministic draft.
