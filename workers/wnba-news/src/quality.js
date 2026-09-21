// Pre-publication quality checks that sit beside gate.js (numbers/quotations) and reconcile.js (prose lint, season,
// injuries): temporal provenance, resolved visuals and the shared Intelligence contract. Pure — the media resolver
// is injected so this module stays testable without the media manifest.

import { intelligenceFailures } from '../../../src/lib/intelligence.js';
import { storyCraftFailures, storyCraftAssessment } from './storycraft.js';

export const QUALITY_VERSION = 'wnba-quality/1.1.0';
const ms = (x) => { const v = Date.parse(x || ''); return Number.isFinite(v) ? v : null; };
const SKEW_MS = 60e3; // clock skew tolerated between the data service and the newsroom Worker

/**
 * Temporal provenance. A revision generated at `generated_at` may only rest on evidence observed at or before that
 * instant: the source observation, every evidence record's capture time and the article's source clock.
 */
export function provenanceFailures(a, { generatedAt = a.provenance?.generated_at || a.updated_at } = {}) {
  const out = [];
  const gen = ms(generatedAt);
  if (gen === null) return ['provenance: no generation time'];
  const obs = ms(a.provenance?.source_observed_at);
  if (obs !== null && obs > gen + SKEW_MS) out.push(`provenance: source observed ${a.provenance.source_observed_at} after the article was generated ${generatedAt}`);
  for (const e of a.evidence || []) {
    const c = ms(e.captured_at);
    if (c !== null && c > gen + SKEW_MS) out.push(`provenance: evidence "${String(e.source || e.publisher).slice(0, 60)}" captured ${e.captured_at} after generation ${generatedAt}`);
  }
  if (a.provenance && ms(a.published_at) !== null && ms(a.published_at) > gen + SKEW_MS) out.push(`provenance: source clock ${a.published_at} is later than generation ${generatedAt}`);
  if (a.first_published_at && a.revised_at && ms(a.revised_at) < ms(a.first_published_at)) out.push('provenance: revision precedes first publication');
  return out;
}

/** Visual resolution: no standalone story runs blank (approved subject photo, team composition or the deterministic story visual). */
export function visualFailures(a, media) {
  if (media === undefined) return [];
  if (a.kind !== 'international') {
    const ok = media && ((media.subjects || []).length || (media.teams || []).length || (media.layout === 'brand' && media.visual?.desk));
    return ok ? [] : ['visual: story has no resolved hero (approved photo, team composition or story visual)'];
  }
  if (!media || !['intl_photo', 'intl_game'].includes(media.layout) || !media.visual?.teams?.length) return ['visual: international story has no resolved hero (approved photo or scoreboard)'];
  const [w, l] = media.visual.teams;
  if (!w.name || !l.name || !Number.isFinite(w.score) || !Number.isFinite(l.score)) return ['visual: scoreboard is missing teams or score'];
  return [];
}

/** Everything this module checks, for one generated article. */
export function qualityFailures(a, { media = null, generatedAt } = {}) {
  return [
    ...provenanceFailures(a, { generatedAt }),
    ...visualFailures(a, media ?? undefined),
    ...storyCraftFailures(a),
    ...(a.intelligence ? intelligenceFailures(a) : [])
  ];
}

export function qualityAssessment(a, { media = null, generatedAt } = {}) {
  const failures = qualityFailures(a, { media, generatedAt });
  return {
    version: QUALITY_VERSION,
    pass: failures.length === 0,
    failures,
    storycraft: storyCraftAssessment(a)
  };
}
