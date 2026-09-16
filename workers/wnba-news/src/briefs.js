// Public version boundary for the WNBA News Brief engine.
//
// The implementation in briefs-core.js is the audited 2.1.0 generator. Taxonomy
// hardening in wnba-taxonomy/1.1.2 changed what qualifies as a material event,
// so stored briefs must be re-reviewed even when their prose generator did not
// otherwise change. Exposing 2.1.1 here invalidates the prior coverage review
// exactly once while preserving the implementation and every existing story URL.

import * as core from './briefs-core.js';

export * from './briefs-core.js';

export const BRIEF_VERSION = 'wnba-briefs/2.1.1';

export async function briefArticles(args) {
  const out = await core.briefArticles(args);
  // Keep lifecycle input hashes aligned with the public generator version. The
  // core implementation still stamps 2.1.0 internally; rewriting only that
  // prefix makes this migration visible to mergeArticles without changing facts.
  for (const article of out) {
    if (typeof article?.input_hash !== 'string') continue;
    if (article.input_hash === core.BRIEF_VERSION) article.input_hash = BRIEF_VERSION;
    else if (article.input_hash.startsWith(`${core.BRIEF_VERSION}|`)) {
      article.input_hash = `${BRIEF_VERSION}${article.input_hash.slice(core.BRIEF_VERSION.length)}`;
    }
  }
  return out;
}
