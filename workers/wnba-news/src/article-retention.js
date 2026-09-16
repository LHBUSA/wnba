// Permanent storage policy for published PropBetEdge WNBA articles.
//
// Article bodies are historical newsroom assets. Once published they must not
// disappear because a cache/storage TTL elapsed. The index controls curation;
// this module controls retention. These are deliberately separate concerns.

export const ARTICLE_RETENTION_VERSION = 'pbe-news-retention/1.0.1';
export const ARTICLE_RETENTION_MIGRATION_KEY = 'art:v1:migration:permanent-retention-v1';

export const articleItemKey = (id) => `art:v1:item:${id}`;

/** Write a published article with no KV expiration. */
export async function putArticle(kv, article) {
  if (!kv) throw new Error('article_retention_no_kv');
  if (!article?.id) throw new Error('article_retention_missing_id');
  await kv.put(articleItemKey(article.id), JSON.stringify(article));
}

/**
 * Remove the legacy 120-day expiry from already-published article bodies.
 * Re-putting an existing KV value without expiration makes that key persistent.
 *
 * We remember ids already rewritten rather than trusting index position: the
 * newsroom may insert/sort cards as new stories arrive, and a positional cursor
 * could otherwise miss a new article. Every newly-seen id is made permanent on
 * a later five-minute newsroom tick.
 */
export async function migrateArticleRetention(kv, index, { batchSize = 32 } = {}) {
  if (!kv) return { version: ARTICLE_RETENTION_VERSION, status: 'SKIPPED', reason: 'no_kv' };

  const ids = [...new Set((index || []).map((c) => String(c?.id || '')).filter(Boolean))];
  const prior = (await kv.get(ARTICLE_RETENTION_MIGRATION_KEY, 'json')) || {};
  const known = new Set(Array.isArray(prior.known_ids) ? prior.known_ids.map(String) : []);
  const pending = ids.filter((id) => !known.has(id));
  const batch = pending.slice(0, Math.max(1, batchSize));

  let rewritten = 0;
  let missing = 0;
  for (const id of batch) {
    const item = await kv.get(articleItemKey(id), 'json');
    if (!item) {
      // Do not mark missing bodies complete. If a writer and this migration race,
      // the next cron pass should try again after the body lands.
      missing += 1;
      continue;
    }
    await putArticle(kv, item);
    known.add(id);
    rewritten += 1;
  }

  const remaining = ids.filter((id) => !known.has(id)).length;
  const next = {
    version: ARTICLE_RETENTION_VERSION,
    status: remaining === 0 ? 'COMPLETE' : 'IN_PROGRESS',
    at: new Date().toISOString(),
    total_indexed: ids.length,
    permanent: ids.length - remaining,
    remaining,
    rewritten_total: Number(prior.rewritten_total || 0) + rewritten,
    missing_total: Number(prior.missing_total || 0) + missing,
    rewritten_this_pass: rewritten,
    missing_this_pass: missing,
    // A few hundred ids is tiny and gives us deterministic future discovery.
    known_ids: [...known].filter((id) => ids.includes(id))
  };
  await kv.put(ARTICLE_RETENTION_MIGRATION_KEY, JSON.stringify(next));
  return next;
}
