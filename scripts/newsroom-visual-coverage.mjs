// Article analytics coverage audit over the LIVE newsroom (newest listed articles).
// For each story: kind, depth class, words, eligible for data storytelling, what renders today (frozen contract
// visuals and/or legacy render-time analytics), visual types, evidence dimensions, and why a visual is absent.
//   node scripts/newsroom-visual-coverage.mjs [--limit=100] [--json=out.json]
import fs from 'node:fs';
import { articleAnalytics } from '../src/views/article-analytics.js';
import { evidenceDimensions } from '../workers/wnba-news/src/depth.js';

const NEWS = process.env.WNBA_NEWS || 'https://wnba-news.sales-fd3.workers.dev';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const limit = Number(arg('limit', 100));
const list = (await (await fetch(`${NEWS}/v1/articles?limit=200&cb=${Date.now()}`)).json()).data.items;
const origin = (c) => c.first_published_at || c.published_at || '';
const cards = [...list].sort((a, b) => origin(b).localeCompare(origin(a))).slice(0, limit);

const DESK = { result: 'RESULTS', performance: 'RESULTS', preview: 'PREVIEWS', injury: 'INJURIES', transaction: 'TRANSACTIONS', trend: 'TRENDS', market: 'MARKET', props: 'MARKET', international: 'INTERNATIONAL', commissioned_feature: 'FEATURES', winba_index: 'FEATURES', brief: 'BRIEFS' };
const rows = [];
for (const c of cards) {
  const a = (await (await fetch(`${NEWS}/v1/articles/${c.id}?cb=${Date.now()}`)).json()).data?.article;
  if (!a) continue;
  const words = (a.body || []).join(' ').split(/\s+/).filter(Boolean).length;
  const cls = a.depth?.class || c.depth_class || c.depth?.class || null;
  const dims = evidenceDimensions(a);
  const contract = (a.visuals || []).filter(Boolean);
  const legacy = String(articleAnalytics(a) || '').length > 0;
  const types = [...contract.map((v) => v.type), ...(legacy ? [`legacy:${a.kind}`] : [])];
  const eligible = ['full', 'deep'].includes(cls) || ['commissioned_feature', 'winba_index'].includes(a.kind) || (cls === 'brief' && dims.length >= 3);
  const visualized = contract.length > 0 || legacy;
  const why = visualized ? null : !eligible ? `not eligible (${cls || 'unclassified'}, ${dims.length} dimensions)` : `no visual module for ${a.kind}${a.kind === 'brief' ? ` (${a.facts?.brief?.event_type || '?'})` : ''}`;
  rows.push({ id: a.id, kind: a.kind, desk: DESK[a.kind] || 'OTHER', depth: cls, words, eligible, visuals: contract.length, legacy, types, dimensions: dims, why_omitted: why, headline: a.headline });
}
const agg = {};
for (const r of rows) {
  const d = (agg[r.desk] ||= { stories: 0, eligible: 0, visualized: 0, contract: 0, legacy_only: 0, charts: 0 });
  d.stories += 1;
  if (r.eligible) d.eligible += 1;
  if (r.visuals || r.legacy) d.visualized += 1;
  if (r.visuals) d.contract += 1;
  if (!r.visuals && r.legacy) d.legacy_only += 1;
  d.charts += r.visuals;
}
console.log(`newest ${rows.length} listed articles`);
for (const [k, v] of Object.entries(agg).sort()) console.log(`${k.padEnd(14)} ${String(v.visualized).padStart(3)}/${v.stories} visualized  (contract ${v.contract}, legacy-only ${v.legacy_only}, eligible ${v.eligible}, contract charts ${v.charts})`);
const out = arg('json', null);
if (out) fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), aggregate: agg, rows }, null, 1));
