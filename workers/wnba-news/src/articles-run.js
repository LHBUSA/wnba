// Orchestrates one newsroom article pass: gather structured inputs from
// wnba-api (service binding), run every generator, gate, store in KV (and
// Supabase when bound). Deterministic ids: a re-run rewrites the same article
// only when its inputs changed (input_hash) or the generator version moved.

import { injuryArticles, transactionArticles, resultArticles, previewArticles, trendArticles, propArticles, marketMoveArticles, withSlug, cardOf, ARTICLE_VERSION } from './articles.js';
import { briefArticles, BRIEF_VERSION } from './briefs.js';
import { reconcileArticle, RECONCILE_VERSION } from './reconcile.js';
import { mergeArticles } from './lifecycle.js';

const et = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replaceAll('-', '');
const add = (s, n) => { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + n)); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; };

// The Worker is scheduled every 10 minutes. Keep the guard slightly below the cron interval so
// normal Cloudflare scheduling jitter cannot turn a 10-minute source cadence into a 20/30-minute
// article cadence. Input hashes below still guarantee unchanged stories are never rewritten.
export const ARTICLE_RUN_MIN_GAP_MS = 9 * 60e3;

// Story identity, editorial-origin clock, duplicate repair and supersession live in lifecycle.js.
export { articleFirstPublishedAt, injuryIdentity } from './lifecycle.js';

export async function runArticles(env, { apiGet, dict, externalItems, force = false }) {
  const started = new Date().toISOString();
  const now = Date.now();
  const last = await env.NEWS_KV.get('art:v1:last_run', 'json');
  if (!force && last?.at && now - Date.parse(last.at) < ARTICLE_RUN_MIN_GAP_MS && last.version === ARTICLE_VERSION) return { skipped: 'ran_recently', last_at: last.at };

  const errors = [];
  // One fetch per distinct path per run: box scores, team and player records are shared by every generator
  // that needs them, so the run's subrequest count is the number of DISTINCT records, not of requests.
  const meterState = { issued: 0, fetched: 0 };
  const cache = new Map();
  const soft = (path) => {
    meterState.issued += 1;
    if (!cache.has(path)) {
      meterState.fetched += 1;
      cache.set(path, apiGet(path).catch((e) => { errors.push(`${path}: ${e.message}`); return null; }));
    }
    return cache.get(path);
  };
  const meter = () => ({ ...meterState });
  const today = et();
  const [inj, tx, sched, longSched, standings, props] = await Promise.all([
    soft('/v1/injuries'),
    soft('/v1/transactions'),
    soft(`/v1/schedule?from=${add(today, -14)}&to=${add(today, 7)}`),
    soft(`/v1/schedule?from=${add(today, -50)}&to=${today}`),
    soft('/v1/standings'),
    soft('/v1/props')
  ]);
  const standingsById = new Map((standings?.groups || []).flatMap((g) => g.entries.map((e) => [e.team_id, { ...e, conference_name: g.name }])));
  const games = sched?.games || [];
  const finals = games.filter((g) => g.status?.state === 'post' && g.status?.completed).sort((a, b) => b.start_utc.localeCompare(a.start_utc)).slice(0, 10);
  const upcoming = games.filter((g) => g.status?.state === 'pre').sort((a, b) => a.start_utc.localeCompare(b.start_utc)).slice(0, 8);
  const finalsByTeam = new Map();
  for (const g of (longSched?.games || []).filter((x) => x.status?.state === 'post' && x.status?.completed).sort((a, b) => b.start_utc.localeCompare(a.start_utc))) {
    for (const t of [g.home?.team_id, g.away?.team_id]) { if (!finalsByTeam.has(t)) finalsByTeam.set(t, []); finalsByTeam.get(t).push(g); }
  }
  const externalByPlayer = new Map();
  for (const it of externalItems) for (const e of it.entities || []) if (e.type === 'player') { if (!externalByPlayer.has(e.id)) externalByPlayer.set(e.id, []); externalByPlayer.get(e.id).push(it); }
  for (const v of externalByPlayer.values()) v.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));

  const api = (path) => soft(path);
  // Regular-season game ids: a team schedule carries preseason games with the same season.year, so records
  // computed from team schedules are filtered by the league schedule, where season.type === 2.
  const season = games[0]?.season?.year || Number(today.slice(0, 4));
  const regIds = new Set();
  for (let from = `${season}0501`; from < today;) {
    const to = [add(from, 59), today].sort()[0];
    const chunk = await soft(`/v1/schedule?from=${from}&to=${to}`);
    for (const g of chunk?.games || []) if (g.season?.type === 2) regIds.add(String(g.game_id));
    from = add(to, 1);
  }
  const ctx = { api, injuries: inj?.items || [], externalByPlayer, schedule: games, standingsById, now, transactions: tx?.items || [], dict, finals, upcoming, finalsByTeam, teams: dict.teamsList || [], props, season, regIds, meter, asOf: started };
  const runs = {};
  const produced = [];
  const doTrends = (await env.NEWS_KV.get(`art:v1:trends:${today}`)) === null || force;
  for (const [name, fn, on] of [
    ['injury', injuryArticles, true], ['transaction', transactionArticles, true], ['result', resultArticles, true],
    ['preview', previewArticles, true], ['trend', trendArticles, doTrends], ['props', propArticles, true], ['market', marketMoveArticles, true],
    // Material source-wire events run last so the brief generator can suppress events already covered by a
    // structured injury/transaction story. A source cluster is one stable brief: corroboration revises it,
    // while a different material cluster becomes a genuinely new newsroom article.
    ['brief', () => briefArticles({ externalItems, structured: produced, now, ctx: { api, injuries: inj?.items || null, transactions: tx?.items || [], schedule: games, standingsById, season, dict } }), true]
  ]) {
    if (!on) { runs[name] = 'skipped (daily)'; continue; }
    try {
      const xs = await fn(ctx);
      runs[name] = xs.length;
      produced.push(...xs);
    } catch (e) {
      runs[name] = `error: ${e.message}`;
      errors.push(`${name}: ${e.stack || e.message}`.slice(0, 300));
    }
  }
  if (doTrends) await env.NEWS_KV.put(`art:v1:trends:${today}`, '1', { expirationTtl: 3 * 86400 });

  const index = (await env.NEWS_KV.get('art:v1:index', 'json')) || [];
  const held = [];
  const publishable = [];
  const feed = inj?.items || [];
  for (const a0 of produced) {
    const a = await withSlug(a0);
    // Added gate: gate.js validate() has already run inside finalize(); reconcile checks what a number gate
    // cannot see (season provenance, absence context, injury-feed completeness, co-leaders, market alignment,
    // rest semantics, provider comment text, prose lint). A failure holds the story.
    a.reconcile = reconcileArticle(a, { season, injuries: feed });
    if (!a.reconcile.ok) a.status = 'held';
    if (a.status !== 'published') { held.push({ id: a.id, kind: a.kind, headline: a.headline, failures: [...a.gate.failures, ...a.reconcile.failures].slice(0, 8), at: started }); continue; }
    publishable.push(a);
  }

  // New material event = new story; same event with new data = revision that keeps its editorial origin.
  // Existing duplicate/poisoned cards are repaired deterministically inside the merge on every pass.
  const { index: next, written, repairs, events } = await mergeArticles({
    index,
    articles: publishable,
    started,
    now,
    feed: Array.isArray(inj?.items) ? inj.items : null,
    getItem: (id) => env.NEWS_KV.get(`art:v1:item:${id}`, 'json'),
    putItem: (a) => env.NEWS_KV.put(`art:v1:item:${a.id}`, JSON.stringify(a), { expirationTtl: 120 * 86400 }),
    versionOf: (a) => (a.kind === 'brief' ? BRIEF_VERSION : ARTICLE_VERSION),
    cardOf
  });
  await env.NEWS_KV.put('art:v1:index', JSON.stringify(next));
  await env.NEWS_KV.put('art:v1:held', JSON.stringify(held.slice(0, 100)));
  const status = { at: started, version: ARTICLE_VERSION, brief_version: BRIEF_VERSION, reconcile_version: RECONCILE_VERSION, runs, produced: produced.length, written, held: held.length, published_total: next.filter((c) => !c.superseded_by).length, lifecycle: { repairs: repairs.slice(0, 40), events: events.slice(0, 40) }, subrequests: meter(), errors: errors.slice(0, 10) };
  await env.NEWS_KV.put('art:v1:last_run', JSON.stringify(status));
  return status;
}
