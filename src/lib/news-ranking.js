// Pure newsroom ranking rules. Kept outside the page renderer so freshness behavior is testable.

const HOUR = 3600e3;
const TOP_STORY_MAX_AGE = 72 * HOUR;

const publishedAt = (c) => Date.parse(c?.published_at || '') || 0;
const group = (c) => (c?.kind === 'result' ? 'performance' : c?.kind);
const isPhoto = (c) => c?.media && (c.media.layout === 'single' || c.media.layout === 'matchup');

/**
 * Lead selection is freshness-first. Editorial priority can break a near-tie only
 * inside the newest hour of coverage; an older injury can never outrank a much
 * newer performance/preview merely because it is an injury.
 */
export function chooseLead(items, { tieWindowMs = HOUR } = {}) {
  if (!items?.length) return null;
  const ranked = [...items].sort((a, b) => publishedAt(b) - publishedAt(a));
  const newestAt = publishedAt(ranked[0]);
  const near = ranked.filter((c) => newestAt - publishedAt(c) <= tieWindowMs);

  for (const kind of ['injury', 'performance', 'preview']) {
    const pool = near.filter((c) => group(c) === kind);
    if (!pool.length) continue;
    const newestKindAt = publishedAt(pool[0]);
    const sameMoment = pool.filter((c) => newestKindAt - publishedAt(c) <= tieWindowMs);
    return sameMoment.find(isPhoto) || pool[0];
  }

  return ranked[0];
}

/**
 * Top Stories is intentionally current. Variety is useful only among stories
 * that are actually fresh; old coverage is never promoted to fill the rail.
 */
export function topStories(items, lead, { limit = 3, maxAgeMs = TOP_STORY_MAX_AGE, now = Date.now() } = {}) {
  const fresh = [...(items || [])]
    .filter((c) => {
      const at = publishedAt(c);
      return at > 0 && now - at <= maxAgeMs;
    })
    .sort((a, b) => publishedAt(b) - publishedAt(a));

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
