// WNBA newsroom production boundary.
//
// The core Worker owns ingest/article generation. This boundary adds two policies
// that must not be conflated with editorial curation:
//   1) published article bodies are permanent historical records;
//   2) /v1/articles remains the curated current newsroom while archive=1 exposes
//      the complete publication catalog, including stories no longer promoted.

import core from './index.js';
import { listedCard } from './legacy.js';
import { withheldBySourcePolicy } from './sources.js';
import { mediaFor } from './media.js';
import { permanentArticleEnv } from './article-kv.js';
import { ARTICLE_RETENTION_MIGRATION_KEY, ARTICLE_RETENTION_VERSION, migrateArticleRetention } from './article-retention.js';

const SERVICE = 'wnba-news';
const VERSION = '2.1.1';

export default {
  async scheduled(event, env, ctx) {
    // The core writer sees a NEWS_KV binding that strips legacy expirations from
    // art:v1:item:* writes. New stories and revisions are durable immediately.
    const durableEnv = permanentArticleEnv(env);
    await core.scheduled(event, durableEnv, ctx);

    // One-time/backfill repair for article bodies written before this boundary.
    // It can safely run beside ingest: missing/racing items remain pending and
    // are retried on the next five-minute newsroom tick.
    ctx.waitUntil((async () => {
      const index = (await durableEnv.NEWS_KV.get('art:v1:index', 'json')) || [];
      await migrateArticleRetention(durableEnv.NEWS_KV, index, { batchSize: 40 });
    })());
  },

  async fetch(request, env, ctx) {
    const durableEnv = permanentArticleEnv(env);
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/v1/articles' && url.searchParams.get('archive') === '1') {
      return archiveRoute(durableEnv, url);
    }

    if (path === '/health') {
      const response = await core.fetch(request, durableEnv, ctx);
      const body = await response.json().catch(() => null);
      if (!body) return response;
      const retention = await durableEnv.NEWS_KV.get(ARTICLE_RETENTION_MIGRATION_KEY, 'json');
      return j({
        ...body,
        version: VERSION,
        article_retention: retention || { version: ARTICLE_RETENTION_VERSION, status: 'PENDING_FIRST_PASS' }
      }, response.status);
    }

    // Manual article passes, if ever used, get the same permanent-write policy.
    return core.fetch(request, durableEnv, ctx);
  }
};

async function archiveRoute(env, url) {
  const index = ((await env.NEWS_KV.get('art:v1:index', 'json')) || [])
    .filter((c) => !withheldBySourcePolicy(c));
  const last = await env.NEWS_KV.get('art:v1:last_run', 'json');
  const retention = await env.NEWS_KV.get(ARTICLE_RETENTION_MIGRATION_KEY, 'json');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 200), 1), 500);
  const cat = url.searchParams.get('kind');
  const team = url.searchParams.get('team');
  const player = url.searchParams.get('player');
  const game = url.searchParams.get('game');
  const has = (c, t, id) => (c.entities || []).some((e) => e && e.type === t && String(e.id) === String(id));

  const list = index
    .filter((c) => (!cat || c.kind === cat || c.desk === cat || (cat === 'performance' && c.kind === 'result'))
      && (!team || has(c, 'team', team) || String(c.lead_team_id || '') === String(team))
      && (!player || has(c, 'player', player) || String(c.lead_player_id || '') === String(player))
      && (!game || has(c, 'game', game)))
    .sort((a, b) => String(b.first_published_at || b.published_at || '').localeCompare(String(a.first_published_at || a.published_at || '')))
    .map(({ input_hash, ...c }) => ({
      ...c,
      listed: listedCard(c),
      archive_state: c.duplicate_of ? 'duplicate' : c.superseded_by ? 'superseded' : c.status === 'external_coverage' ? 'external_coverage' : c.quality_state === 'retired_from_index' ? 'retired' : 'current',
      media: mediaFor(c),
      video: null
    }));

  return j({
    ok: true,
    data: {
      items: list.slice(0, limit),
      total: list.length,
      current: list.filter((c) => c.listed).length,
      historical: list.filter((c) => !c.listed).length
    },
    meta: {
      service: SERVICE,
      version: VERSION,
      catalog: 'COMPLETE_PUBLICATION_HISTORY',
      last_run_at: last?.at || null,
      article_retention: retention || { version: ARTICLE_RETENTION_VERSION, status: 'PENDING_FIRST_PASS' },
      served_at: new Date().toISOString()
    }
  }, 200, 30);
}

function j(body, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
      'access-control-allow-origin': '*'
    }
  });
}
