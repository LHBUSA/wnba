// Legacy-story policy — wnba-legacy-policy/1.0.0.
//
// The newsroom standard moves (depth ladder, additive Intelligence, desk contracts). Stories published under older
// generators are never deleted and never rewritten merely to improve metrics. Each live story carries ONE intentional
// state, reviewed deterministically:
//
//   current_quality             meets the current gate for its class and desk.
//   quality_upgrade_available   below the current standard, but the current generator can rebuild it from records
//                               that still exist — the run's bounded upgrade pass does so through the normal gate.
//   legacy_acceptable           below the current standard, legitimate when published, sound (no integrity failure), and
//                               the records to rebuild it are no longer in reach. Preserved in the archive but not promoted
//                               under an earlier standard.
//   external_coverage           another publisher's coverage, not a newsroom event (briefs.js). Unlisted, URL kept.
//   retired_from_index          no longer deserves standalone listing: an integrity failure under the current checks, or
//                               the development it reports has ended (an injury listing that is over). Unlisted, URL kept.
//
// Every state preserves the URL, first publication time, revision history and generator version; the review is stamped
// on the card (`quality_review`) and re-run only when this policy version changes or the story is revised.

import { assessDepth } from './depth.js';
import { intelligenceOf } from '../../../src/lib/intelligence.js';
import { storyCraftAssessment } from './storycraft.js';

export const LEGACY_POLICY_VERSION = 'wnba-legacy-policy/1.2.0';
export const QUALITY_STATES = ['current_quality', 'quality_upgrade_available', 'legacy_acceptable', 'external_coverage', 'retired_from_index'];
export const UNLISTED_STATES = new Set(['external_coverage', 'retired_from_index', 'legacy_acceptable']);
const LISTING_OVER_MS = 12 * 3600e3;

/** Is a card shown in newsroom listings (front page, desks, team/player lists, sitemaps, related)? */
export const listedCard = (c) => Boolean(c) && !c.superseded_by && c.status !== 'external_coverage' && !UNLISTED_STATES.has(c.quality_state);

// Failures that say the copy itself is unsound under current checks, as opposed to merely shorter or thinner.
// (An Intelligence module that restates the body is not here: the renderer suppresses non-additive copy on read.)
const INTEGRITY = /(duplicate paragraphs|repeated sentence|phrase repetition|play-by-play language without|unsupported characterisation|scouting language|unsourced financial|identity:|storycraft:)/;

/** The stored item assessed as it renders today (legacy Intelligence copy recomputed additively). */
export function assessStored(item, { now = Date.now() } = {}) {
  const intel = intelligenceOf(item);
  const depth = assessDepth({ ...item, intelligence: intel }, { now });
  const craft = storyCraftAssessment(item);
  return {
    ...depth,
    pass: depth.pass && craft.pass,
    failures: [...depth.failures, ...craft.failures],
    storycraft: craft
  };
}

/**
 * The state for one live card. `item` is the stored article; `regeneration` is the outcome of the run's attempt to
 * rebuild it with the current generator (null = not attempted/not possible, { passed, failures } otherwise);
 * `cards` lets a story see later stories for the same subject.
 */
export function reviewStory({ card, item, now = Date.now(), regeneration = null, cards = [], withheld = false, deskDecision = null }) {
  const at = new Date(now).toISOString();
  const generator = String(card.input_hash || '').split('|')[0] || item?.generator?.version || null;
  const stamp = (state, reason, extra = {}) => ({ policy: LEGACY_POLICY_VERSION, state, reason, at, generator, ...extra });
  if (card.status === 'external_coverage') return stamp('external_coverage', card.coverage_review?.reason || 'publisher coverage, not a newsroom event');
  if (withheld) return stamp('retired_from_index', 'its only publisher report is from a source under policy review; withheld from public listings');
  if (!item) return stamp('legacy_acceptable', 'stored item unavailable for review; left as published');
  const d = assessStored(item, { now });
  const depth = { class: d.class, score: d.score, words: d.words, contract: d.contract };
  // A development that is over, with a later story for the same player, is not current news however well it was written.
  const later = card.kind === 'injury' ? cards.find((c) => c.id !== card.id && !c.superseded_by && String(c.lead_player_id) === String(card.lead_player_id) && Date.parse(c.first_published_at || 0) > Date.parse(card.first_published_at || 0)) : null;
  if (card.kind === 'injury' && card.listing_ended_at && later && Date.parse(later.first_published_at || 0) <= now) {
    return stamp('retired_from_index', `the injury listing this story reports ended ${card.listing_ended_at.slice(0, 10)} and a later story covers the player (${later.id}); kept at its URL`, { depth, superseded_by_story: later.id });
  }
  // A trend the current trend desk withholds as immaterial no longer stands alone.
  if (card.kind === 'trend' && deskDecision?.decision === 'withheld') return stamp('retired_from_index', `the current trend desk withholds it: ${deskDecision.reason}`, { depth });
  if (d.pass) return stamp('current_quality', `meets the current ${d.label} ${d.contract} contract`, { depth });
  const integrity = d.failures.filter((f) => INTEGRITY.test(f));
  if (integrity.length) return stamp('retired_from_index', `fails a current integrity check: ${integrity[0].replace(/^depth: /, '')}`, { depth, failures: d.failures.slice(0, 4) });
  if (regeneration?.passed) return stamp('quality_upgrade_available', 'the current generator rebuilt it to standard; the upgrade is written this pass', { depth });
  if (regeneration && !regeneration.passed) return stamp('legacy_acceptable', `published under ${generator}; the current generator cannot rebuild it to the ${d.label} standard from today's records (${(regeneration.failures || [])[0]?.replace(/^depth: /, '') || 'held'}); kept as a legitimate short story`, { depth, failures: d.failures.slice(0, 4) });
  return stamp('legacy_acceptable', `published under ${generator}; below the current ${d.label} standard (${d.failures[0]?.replace(/^depth: /, '') || 'substance'}) and outside the current generators' windows; kept as a legitimate short story`, { depth, failures: d.failures.slice(0, 4) });
}

/**
 * Lanes that carry their own editorial gate are outside this policy.
 *
 * A WinBA Index is generated, gated and frozen by the WinBA lane against its own
 * contract, and this policy cannot regenerate it. Assessing it against the
 * article depth contracts therefore has only one possible outcome — it falls
 * through to `legacy_acceptable` and leaves every listing — which is what
 * happened to the first published edition.
 */
const SELF_GATED_KINDS = new Set(['winba_index']);

/** Does a card need (re)review? */
export const needsReview = (c, { rewrittenIds = new Set() } = {}) => !SELF_GATED_KINDS.has(c?.kind) && !c.superseded_by && !rewrittenIds.has(c.id) && (c.quality_review?.policy !== LEGACY_POLICY_VERSION || Boolean(c.revised_at && Date.parse(c.revised_at) > Date.parse(c.quality_review?.at || 0)));
