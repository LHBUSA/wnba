// Permanent storage policy for published PropBetEdge WNBA articles.
//
// Article bodies are historical newsroom assets. Once published they must not
// disappear because a cache/storage TTL elapsed. The index controls curation;
// this module controls retention. These are deliberately separate concerns.

export const ARTICLE_RETENTION_VERSION = 'pbe-news-retention/1.0.2';
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
 * We remember ids already rewritten rather than trusting index position, and we
 * also re-write any known article revised since the previous retention pass.
 * That matters because the legacy writer can reapply its old TTL when an existing
 * canonical story is updated; the next five-minute newsroom tick removes it again.
 */
export async function migrateArticleRetention(kv, index, { batchSize = 32 } = {}) {
  if (!kv) return { version: ARTICLE_RETENTION_VERSION, status: 'SKIPPED', reason: 'no_kv' };

  const cards = (index || []).filter((c) => c?.id);
  const ids = [...new Set(cards.map((c) => String(c.id)))];
  const prior = (await kv.get(ARTICLE_RETENTION_MIGRATION_KEY, 'json')) || {};
  const known = new Set(Array.isArray(prior.known_ids) ? prior.known_ids.map(String) : []);
  const priorAt = Date.parse(prior.at || 0) || 0;
  const changed = cards
    .filter((c) => known.has(String(c.id)))
    .filter((c) => Math.max(Date.parse(c.revised_at || 0) || 0, Date.parse(c.first_published_at || c.published_at || 0) || 0) > priorAt)
    .map((c) => String(c.id));
  const unseen = ids.filter((id) => !known.has(id));
  const pending = [...new Set([...changed, ...unseen])];
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

  const remainingNew = ids.filter((id) => !known.has(id)).length;
  const remainingChanged = Math.max(0, pending.length - batch.length);
  const next = {
    version: ARTICLE_RETENTION_VERSION,
    status: remainingNew === 0 && remainingChanged === 0 && missing === 0 ? 'COMPLETE' : 'IN_PROGRESS',
    at: new Date().toISOString(),
    total_indexed: ids.length,
    permanent: ids.length - remainingNew,
    remaining: remainingNew + remainingChanged + missing,
    rewritten_total: Number(prior.rewritten_total || 0) + rewritten,
    missing_total: Number(prior.missing_total || 0) + missing,
    rewritten_this_pass: rewritten,
    missing_this_pass: missing,
    revised_candidates_this_pass: changed.length,
    new_candidates_this_pass: unseen.length,
    // A few hundred ids is tiny and gives us deterministic future discovery.
    known_ids: [...known].filter((id) => ids.includes(id))
  };
  await kv.put(ARTICLE_RETENTION_MIGRATION_KEY, JSON.stringify(next));
  return next;
}
