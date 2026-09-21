# Newsroom P0 handoff — two invariants for the quality session

Two P0 defects found by measuring production on 2026-09-21. Both live in files
owned by the active quality session, so they are written up here rather than
patched: `articles-run.js`, `legacy.js`, `depth.js`, `deep.js`, `articles.js`,
`storycraft.js`, `brief-story.js`.

Everything below was measured against live production, not inferred.

---

## P0-1 — Identity failure is advisory, not fail-closed

### Required invariant

> If `identity_audit.pass === false`, the article can never become publicly
> listable or `current_quality` later in the same pipeline. No subsequent
> storycraft, depth or review success may resurrect it.

Today it can, and does.

### Exact execution path

`runArticles()` in `workers/wnba-news/src/articles-run.js`:

1. **line ~129** — `a.identity_failures = articleIdentityFailures(a, { dict })`
   stamps failures on newly generated articles.
2. **line ~196** — `auditStoredIdentity(next, …)` audits the stored catalogue.
   On failure (`workers/wnba-news/src/identity.js`, end of the function) it
   retires the card **directly**:

   ```js
   Object.assign(card, { quality_state: 'retired_from_index', quality_review: review, revisions });
   await putItem({ ...item, quality_state: 'retired_from_index', … });
   ```

3. **the legacy/quality review pass** then calls `reviewStory()`
   (`workers/wnba-news/src/legacy.js`) for every card needing review.

### Exact overwrite point

`reviewStory()` in `legacy.js`, the `d.pass` branch:

```js
if (d.pass) return stamp('current_quality', `meets the current ${d.label} ${d.contract} contract`, { depth });
```

`d` comes from `assessStored(item)`, which is **depth + storycraft only**:

```js
const craft = storyCraftAssessment(item);
return { ...depth, pass: depth.pass && craft.pass, failures: [...depth.failures, ...craft.failures], storycraft: craft };
```

Identity never enters `d`. And the integrity branch below it filters `d.failures`
through `INTEGRITY`, so identity failures cannot reach it either:

```js
const integrity = d.failures.filter((f) => INTEGRITY.test(f));
if (integrity.length) return stamp('retired_from_index', …);
```

So an identity-retired card whose depth and storycraft pass is re-stamped
`current_quality` in the same run, and returns to every public listing.

### Evidence from production

* The 1.0.0 audit retired 18 records; **16 were re-stamped `current_quality`**
  in the same pass and stayed listed. (Those 16 were also false positives, fixed
  separately in `identity.js` 1.1.0 — but the resurrection is independent of
  that and still live.)
* The Caitlin Clark / Minnesota Lynx record stayed retired **only because
  storycraft also failed it** (`quality_review.reason` = "storycraft:
  editorial-process prose leaked into reader-facing copy"), not because identity
  failed it. Had its prose been clean, a story asserting a player plays for a
  team she does not play for would have been restored to the newsroom.

### Regression fixture

The record is real and still in the catalogue:

* id `6ff81a94599c`, slug `caitlin-clark-honored-for-the-minnesota-lynx-the-season-behind-it-6ff81a`
* `lead_player_id` 4433403 (Clark, **Fever, team 5**), `lead_team_id` **8** (Lynx)
* `facts.brief.event_type` `awards`; four publisher reports all name Olivia Miles first
* `articleIdentityFailures` returns, today:
  * `identity: lead player Caitlin Clark was linked to team 5 in this event, not lead team 8`
  * `identity: publisher-headline consensus names Olivia Miles (4433791) as subject, not lead player Caitlin Clark`
  * `identity: publisher-headline consensus is event "record" from 4 publishers, not stored "awards"`

A sufficient test: take that stored item, give it body copy that passes depth
and storycraft, run the full pass, and assert the card is **not**
`current_quality` and **not** listed. It fails today.

There is also a second live wrong-team record for the same shape:
`azzi-fudd-injury-update-for-the-new-york-liberty-…` (Fudd is **Wings, team 3**;
story says Liberty, team 9). A correct Dallas Wings version of that story exists
alongside it.

### Required behaviour

Identity is a truth gate, so it should be evaluated in the same place as the
other integrity failures rather than applied and then overridden. Either:

* feed identity failures into `assessStored`/`d.failures` so `INTEGRITY` sees
  them and `d.pass` is false; or
* have `reviewStory` refuse to return `current_quality` when the card carries
  `identity_audit.ok === false`, whatever depth and storycraft say.

The second is the smaller change and directly expresses the invariant. Either
way the ordering dependency disappears: it must not matter whether the audit
runs before or after the review.

---

## P0-2 — A depth class carries no substance obligation

### Required invariant

> A rich evidence packet in a Full/Deep class must be materially used by the
> generator. A sparse packet belongs in Flash/Brief. A rich packet must not
> produce a 300-word article that still calls itself Full.
>
> **Not** solved by blind word-count enforcement.

### Measured on production, all 98 live articles

| class | n | words min/median/max | own target | below target | evidence dimensions min/med/max |
|---|---|---|---|---|---|
| brief | 10 | 305 / 468 / 607 | 350–650 | 4/10 | 4 / 4 / 5 |
| **full** | **82** | **303 / 454 / 766** | **650–1100** | **73/82** | 6 / 8 / 10 |
| deep | 2 | 957 / 998 / 998 | 1000–1600 | 2/2 | 7 / 7 / 7 |

* `depth.pass === false` on **0** articles.
* `depth.failures` non-empty on **0** articles.
* **79 of 98** carry a word-shortfall diagnostic with no publication consequence.
* **36 articles have ≥ 8 evidence dimensions and under 450 words** — the packet
  is rich, the class is correctly assigned, and the output is roughly half the
  class's own target.
* `counter_case` is the only unmet element anywhere, on 18 articles.

The classifier is not the problem: it reads the fact block and assigns Full
correctly. The problem is that Full then obliges nothing. `requiredWords` was
deliberately demoted to a diagnostic (documented in
`docs/NEWSROOM_QUALITY_CONTRACT.md` §2), which was right — Australia–Italy at
632 words against a 640 target should not have been blocked — but nothing took
its place, so "Full" is now a label rather than a contract.

### Suggested shape of the obligation (not padding)

Make the class assert that its evidence was *spent*, per dimension rather than
per word. For example, for each dimension present in `depth.dimensions`, require
that the article contains a section or paragraph that actually reports it, and
fail the class when the ratio of used-to-available dimensions falls below a
threshold. That way:

* a rich packet rendered thinly **fails** and is either developed or reclassified
  down, which is the honest outcome;
* a sparse packet rendered completely **passes** at Flash/Brief;
* no article is ever improved by adding words, only by reporting more of what is
  already grounded.

A useful second signal already exists: median sections per desk (injury 6, game
5, preview 5) against median dimensions (8, 8, 6) — the gap between what is
known and what is written is directly visible in those two numbers.

### Also worth fixing while in there

Section headings are heavily templated, which the editorial-depth brief
explicitly calls out: **28 distinct headings across 544 sections**, with
`"The read"` on **96 of 98** articles, `"What matters next"` 83×, `"The market"`
65×, `"The listing"` 37×, `"Her role and the rotation"` 37×.

---

## What the WinBA lane guarantees, so it is not a suspect here

The WinBA editorial lane runs as a post-pass after the article pass and cannot
affect either invariant:

* the WinBA sentence is never written into `body`, so `classifyDepth`'s word
  count is unchanged;
* `evidenceDimensions` reads `facts`/`evidence`/`kind` only, never `entities`,
  so the `metric` entity cannot add a dimension;
* both properties are asserted against the real assessor in
  `tests/winba-editorial.test.mjs` ("WinBA cannot raise a story's depth class,
  dimensions or pass state").
