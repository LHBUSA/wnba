// Run the REAL newsroom article pass (workers/wnba-news/src/articles-run.js runArticles) locally against the
// live public wnba-api and the live source wire, with an in-memory KV. Nothing is written anywhere remote.
// Reports every produced story, its gate result and (optionally) full bodies.
//
//   node scripts/newsroom-pass-dryrun.mjs                 # summary: published / held with reasons
//   node scripts/newsroom-pass-dryrun.mjs --show=<regex>   # print full article(s) whose headline matches
//   node scripts/newsroom-pass-dryrun.mjs --json=<file>    # write every produced article (gated) to a file
//   node scripts/newsroom-pass-dryrun.mjs --seed-index     # seed the in-memory KV with the live index (lifecycle view)
import fs from 'node:fs';
import { runArticles } from '../workers/wnba-news/src/articles-run.js';
import { buildDictionary } from '../workers/wnba-news/src/editorial.js';
import { newsroomMediaFrom } from '../workers/wnba-news/src/media-resolve.js';
import { classify, TAXONOMY_VERSION } from '../workers/wnba-news/src/taxonomy.js';
import { NEWS_SOURCES } from '../workers/wnba-news/src/sources.js';

const API = process.env.WNBA_API || 'https://wnba-api.sales-fd3.workers.dev';
const NEWS = process.env.WNBA_NEWS || 'https://wnba-news.sales-fd3.workers.dev';
const UA = { 'user-agent': 'pbe-newsroom-pass-dryrun/1' };
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? (process.argv.includes(`--${k}`) ? true : null);

const PLAYERS = JSON.parse(fs.readFileSync(new URL('../data/newsroom-media.json', import.meta.url))).players || {};
const mediaFor = (a) => newsroomMediaFrom(PLAYERS, a);

const cache = new Map();
async function apiGet(path) {
  if (!cache.has(path)) cache.set(path, fetch(API + path, { headers: UA }).then((r) => r.json()).then((b) => { if (!b?.ok) throw new Error(`api_${path}_${b?.error?.code}`); return b.data; }));
  return cache.get(path);
}

const players = await apiGet('/v1/players');
const teams = [];
const seen = new Set();
for (const p of players.players) if (p.team && !seen.has(p.team.team_id)) { seen.add(p.team.team_id); teams.push(p.team); }
const rawDict = { players: players.players.map((p) => ({ athlete_id: p.athlete_id, name: p.name, team_id: p.team_id, position: p.position ?? null, experience_years: p.experience_years ?? null })), teams };
const dict = { ...buildDictionary(rawDict), teamsList: teams };

// The Worker feeds the brief desk its full stored item records; the public wire serves the same records.
// --items=<file>: the stored item records (`wrangler kv key get --remote news:v1:items`), which the brief desk needs.
// Without it, the public wire's cluster summaries stand in and the brief desk may not run.
let externalItems;
if (arg('items')) {
  // Re-type stored items exactly as the Worker's ingest does when the taxonomy version moves.
  const srcById = new Map(NEWS_SOURCES.map((s) => [s.source_id, s]));
  externalItems = Object.values(JSON.parse(fs.readFileSync(arg('items'), 'utf8'))).map((it) => {
    if (it.event_type && it.materiality && it.taxonomy === TAXONOMY_VERSION) return it;
    const tax = classify(it, { entities: it.entities || [], source: srcById.get(it.source_id) || { priority: it.priority }, timestampQuality: it.timestamp_quality || 'publisher' });
    return { ...it, event_type: tax.event_type, lane: tax.lane, story_type: tax.story_type, materiality: tax.materiality, taxonomy: TAXONOMY_VERSION };
  });
}
else {
  const wire = await fetch(`${NEWS}/v1/news?limit=100`, { headers: UA }).then((r) => r.json()).catch(() => null);
  externalItems = (wire?.data?.items || []).map((it) => ({ ...it, item_id: it.item_id || it.id, canonical_url: it.canonical_url || it.url, source_id: it.source_id || it.source?.id, source_name: it.source_name || it.source?.name }));
}

const store = new Map();
if (arg('seed-index')) {
  const live = await fetch(`${NEWS}/v1/articles?archive=1&limit=500`, { headers: UA }).then((r) => r.json());
  store.set('art:v1:index', JSON.stringify(live.data.items.map(({ media, video, listed, archive_state, ...c }) => c)));
}
const env = {
  NEWS_KV: {
    async get(k, t) { const v = store.get(k); if (v === undefined) return null; return t === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); }
  },
  ...(process.env.OPENAI_API_KEY ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY } : {}),
  ...(arg('editorial') ? { NEWS_EDITORIAL: String(arg('editorial')) } : {})
};

const t0 = Date.now();
const gated = [];
const status = await runArticles(env, { apiGet, dict, externalItems, force: true, mediaFor, inspect: (a) => gated.push(a) });
const items = [...store.entries()].filter(([k]) => k.startsWith('art:v1:item:')).map(([, v]) => JSON.parse(v));
const held = JSON.parse(store.get('art:v1:held') || '[]');
console.log(`pass ${((Date.now() - t0) / 1000).toFixed(1)}s runs=${JSON.stringify(status.runs)} produced=${status.produced} written=${status.written} held=${status.held}`);
if (status.editorial) console.log('editorial', JSON.stringify(status.editorial));
if (status.errors?.length) console.log('errors', status.errors);
console.log('\nWRITTEN');
for (const a of items) console.log(`  ${a.kind.padEnd(12)} ${String(a.depth?.words ?? '').padStart(4)}w ${String(a.depth?.class || '').padEnd(5)} ${a.editorial?.status ? `[ed:${a.editorial.status}] ` : ''}${a.headline}`);
console.log('\nHELD');
for (const h of held) console.log(`  ${h.kind.padEnd(12)} ${h.headline}\n      ${h.failures.join(' || ').slice(0, 400)}`);
const show = arg('show');
if (show) {
  const re = new RegExp(show, 'i');
  const all = gated;
  for (const a of all.filter((x) => re.test(x.headline))) {
    console.log(`\n==== ${a.headline}\n${a.deck}\n`);
    for (const [i, p] of (a.body || []).entries()) { const s = (a.sections || []).find((x) => x.first === i); if (s?.title) console.log(`## ${s.title}`); console.log(p + '\n'); }
  }
}
if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify({ status, items, held }, null, 1));
