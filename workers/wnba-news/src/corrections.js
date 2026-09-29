// Newsroom corrections — a reviewed, versioned registry of published stories that were WRONG.
//
// A correction is an editorial decision, never an automatic one: each entry names the story id, what was wrong and
// the date it was decided. Applying it:
//   * retires the card from every listing (quality_state retired_from_index) and keeps its URL and first publication
//     time — the record stays public, with the correction shown on the page (article.js renders quality_review.reason);
//   * appends ONE integrity_correction revision to the card and the stored item (idempotent across passes);
//   * is sticky: reviewStory (legacy.js) honours card.correction, so no later review can re-list the story.
// A corrected story is never rewritten into a different claim at the same URL.

export const CORRECTIONS_VERSION = 'wnba-corrections/1.0.0';

export const CORRECTIONS = [
  {
    id: '467ed1ad4743',
    decided_at: '2026-09-29',
    reason: 'this brief reported a Minnesota Lynx coaching change, but its source (ESPN, September 28) reported Cheryl Reeve being named WNBA Coach of the Year; the award was misclassified as a coaching change and no change occurred'
  }
];

export async function applyCorrections(cards, { at, getItem, putItem, registry = CORRECTIONS }) {
  const applied = [];
  for (const fix of registry) {
    const c = cards.find((x) => x.id === fix.id);
    if (!c || c.correction?.decided_at === fix.decided_at) continue;
    const revision = { at, kind: 'integrity_correction', note: `Correction: ${fix.reason}.`, generator: CORRECTIONS_VERSION };
    const review = { policy: CORRECTIONS_VERSION, state: 'retired_from_index', reason: `corrected: ${fix.reason}`, at };
    c.correction = { decided_at: fix.decided_at, reason: fix.reason, applied_at: at };
    c.quality_state = 'retired_from_index';
    c.quality_review = review;
    c.revisions = [...(c.revisions || []), revision].slice(-20);
    const item = await getItem(c.id).catch(() => null);
    if (item) await putItem({ ...item, correction: c.correction, quality_state: c.quality_state, quality_review: review, revisions: c.revisions });
    applied.push({ id: c.id, slug: c.slug });
  }
  return applied;
}
