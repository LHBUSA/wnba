// Permanent storage policy for published PropBetEdge WNBA articles.
//
// Article bodies are historical newsroom assets. Once published they must not
// disappear because a cache/storage TTL elapsed. The index controls curation;
// this module controls retention. These are deliberately separate concerns.

export const ARTICLE_RETENTION_VERSION = 'pbe-news-retention/1.0.0';
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
 * The migration is bounded and resumes across article passes until complete.
 */
export async function migrateArticleRetention(kv, index, { batchSize = 24 } = {}) {
  if (!kv) return { version: ARTICLE_RETENTION_VERSION, status: 'SKIPPED', reason: 'no_kv' };

  const ids = [...new Set((index || []).map((c) => String(c?.id || '')).filter(Boolean))];
  const prior = (await kv.get(ARTICLE_RETENTION_MIGRATION_KEY, 'json')) || {};
  if (prior.done && Number(prior.total || 0) >= ids.length) {
    return { ...prior, version: ARTICLE_RETENTION_VERSION, status: 'COMPLETE' };
  }

  let cursor = Math.max(0, Math.min(Number(prior.cursor || 0), ids.length));
  // If the prior migration finished but the index later gained legacy keys, resume
  // at the old total. New writes already use putArticle and need no migration.
  if (prior.done && ids.length > Number(prior.total || 0)) cursor = Number(prior.total || 0);

  const batch = ids.slice(cursor, cursor + Math.max(1, batchSize));
  let rewritten = 0;
  let missing = 0;
  for (const id of batch) {
    const item = await kv.get(articleItemKey(id), 'json');
    if (!item) { missing += 1; continue; }
    await putArticle(kv, item);
    rewritten += 1;
  }

  cursor += batch.length;
  const done = cursor >= ids.length;
  const next = {
    version: ARTICLE_RETENTION_VERSION,
    status: done ? 'COMPLETE' : 'IN_PROGRESS',
    at: new Date().toISOString(),
    total: ids.length,
    cursor,
    done,
    rewritten_total: Number(prior.rewritten_total || 0) + rewritten,
    missing_total: Number(prior.missing_total || 0) + missing,
    rewritten_this_pass: rewritten,
    missing_this_pass: missing
  };
  await kv.put(ARTICLE_RETENTION_MIGRATION_KEY, JSON.stringify(next));
  return next;
}
