// Non-user-facing audit: why does the live homepage lead with its Top Story?
// Reads the same public feeds the homepage reads and prints the selector's diagnostics.
//   node scripts/homepage-lead-audit.mjs [--json]
import { frontPageEditorialStories } from '../src/views/today.js';
import { selectHomepageLead, latestNewsRail } from '../src/lib/homepage-lead.js';
import { resolveTodayHero } from '../src/lib/today-hero.js';

const API = process.env.WNBA_API || 'https://wnba-api.sales-fd3.workers.dev';
const NEWS = process.env.WNBA_NEWS || 'https://wnba-news.sales-fd3.workers.dev';
const get = async (u) => { try { const r = await fetch(u); return await r.json(); } catch (e) { return { ok: false, error: String(e) }; } };

const [today, arts, winba] = await Promise.all([
  get(`${API}/v1/today`),
  get(`${NEWS}/v1/articles?limit=12`),
  get(`${NEWS}/v1/articles?limit=24&kind=winba_index`)
]);
if (!today.ok || !arts.ok) { console.error('feed unavailable', { today: today.ok, arts: arts.ok }); process.exit(1); }
const now = Date.now();
const hero = resolveTodayHero(today.data, now);
const front = frontPageEditorialStories(arts.data.items, winba);
const { lead, diagnostics } = selectHomepageLead(front, { hero, data: today.data, now });
const rail = latestNewsRail(front, lead, { limit: 4 });
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ diagnostics, rail: rail.map((c) => c.id) }, null, 2));
} else {
  console.log(`policy            ${diagnostics.policy}  mode=${diagnostics.mode} postseason=${diagnostics.postseason} pool=${diagnostics.pool}`);
  console.log(`lead              ${diagnostics.lead_story_id} [${diagnostics.lead_kind}] ${diagnostics.lead_first_published_at}`);
  console.log(`headline          ${lead?.headline || '—'}`);
  console.log(`score             ${diagnostics.lead_score} ${JSON.stringify(diagnostics.lead_components)}`);
  console.log(`reason            ${diagnostics.selection_reason}`);
  console.log(`runner-up         ${diagnostics.runner_up_ids.join(', ')}`);
  console.log('ranking');
  for (const r of diagnostics.ranking) console.log(`  ${String(r.score).padStart(7)}  ${r.id}  ${r.kind.padEnd(20)} ${r.age_hours}h  ${r.materiality}${r.context ? ` + ${r.context}` : ''}`);
  if (diagnostics.excluded.length) console.log('excluded', diagnostics.excluded);
  console.log('latest news rail (chronological)');
  for (const c of rail) console.log(`  ${c.first_published_at}  ${c.kind.padEnd(12)} ${c.headline}`);
}
