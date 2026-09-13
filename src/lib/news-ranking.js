// Pure newsroom ranking rules. Kept outside the page renderer so freshness behavior is testable.

const HOUR = 3600e3;
const TOP_STORY_MAX_AGE = 72 * HOUR;

// Editorial freshness is the moment PropBetEdge first published this canonical story.
// A source record can move, a market capture can refresh and the article can be revised,
// but none of those events make the same story brand-new again.
export const storyPublishedAt = (c) => Date.parse(c?.first_published_at || c?.published_at || '') || 0;
const group = (c) => (c?.kind === 'result' ? 'performance' : c?.kind);
const isPhoto = (c) => c?.media && (c.media.layout === 'single' || c.media.layout === 'matchup');

/**
 * Lead selection is freshness-first by canonical newsroom publication time.
 * A newly published material News Brief is always allowed to take the lead.
 * Revisions to an existing story never reset its headline age. For genuinely
 * new structured stories, editorial priority may break a near-tie inside one hour.
 */
export function chooseLead(items, { tieWindowMs = HOUR } = {}) {
  if (!items?.length) return null;
  const ranked = [...items].sort((a, b) => storyPublishedAt(b) - storyPublishedAt(a));
  const newest = ranked[0];
  if (group(newest) === 'brief') return newest;

  const newestAt = storyPublishedAt(newest);
  const near = ranked.filter((c) => newestAt - storyPublishedAt(c) <= tieWindowMs);

  for (const kind of ['injury', 'performance', 'preview']) {
    const pool = near.filter((c) => group(c) === kind);
    if (!pool.length) continue;
    const newestKindAt = storyPublishedAt(pool[0]);
    const sameMoment = pool.filter((c) => newestKindAt - storyPublishedAt(c) <= tieWindowMs);
    return sameMoment.find(isPhoto) || pool[0];
  }

  return newest;
}

/**
 * Top Stories is intentionally current. Variety is useful only among stories
 * that were actually published recently; revising old coverage does not make
 * it fresh enough to re-enter this rail.
 */
export function topStories(items, lead, { limit = 3, maxAgeMs = TOP_STORY_MAX_AGE, now = Date.now() } = {}) {
  const fresh = [...(items || [])]
    .filter((c) => {
      const at = storyPublishedAt(c);
      return at > 0 && now - at <= maxAgeMs;
    })
    .sort((a, b) => storyPublishedAt(b) - storyPublishedAt(a));

  const out = [];
  const seen = new Set(lead ? [group(lead)] : []);
  for (const c of fresh) {
    if (out.length >= limit) break;
    if (c.id === lead?.id || seen.has(group(c))) continue;
    out.push(c);
    seen.add(group(c));
  }
  for (const c of fresh) {
    if (out.length >= limit) break;
    if (c.id === lead?.id || out.some((x) => x.id === c.id)) continue;
    out.push(c);
  }
  return out;
}

export const NEWS_RANKING = Object.freeze({
  lead_tie_window_ms: HOUR,
  top_story_max_age_ms: TOP_STORY_MAX_AGE
});
