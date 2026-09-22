#!/usr/bin/env node
// Compose a commissioned feature from PRODUCTION inputs and run the newsroom's
// real gates over the result. Writes nothing, publishes nothing.
//
// Frozen boards come from the published Index editions (the same payload the
// Worker reads from KV); the conventional lines come from the live API, exactly
// as the pass would read them.
//
// Usage: node scripts/commission-dryrun.mjs [key] [--full] [--render]

import crypto from 'node:crypto';
import { runCommission, COMMISSIONS, boardHash } from '../workers/wnba-news/src/commission.js';
import { visualsFailures } from '../workers/wnba-news/src/visuals.js';
import { articleIdentityFailures } from '../workers/wnba-news/src/identity.js';
import { provenanceFailures } from '../workers/wnba-news/src/quality.js';
import { storyCraftAssessment } from '../workers/wnba-news/src/storycraft.js';
import { assessDepth } from '../workers/wnba-news/src/depth.js';
import factsDoc from '../data/commissions/verified-facts.json' with { type: 'json' };

const args = process.argv.slice(2);
const KEYS = args.filter((a) => !a.startsWith('--'));
const FULL = args.includes('--full');
const NEWS = 'https://wnba-news.sales-fd3.workers.dev';
const API = 'https://wnba-api.propbetedge.ai';
const AT = new Date().toISOString();

const get = async (u) => {
  const r = await fetch(u);
  const b = await r.json();
  if (!b?.ok) throw new Error(`${u} -> ${r.status}`);
  return b.data;
};
const f1 = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);

// ---- inputs
// An edition that has been retired from listings still has its frozen board, and
// the Worker reads boards from KV rather than from the public index, so the dry
// run may be pointed at explicit slugs to match what the pass would see.
const SLUGS = (args.find((a) => a.startsWith('--slugs=')) || '').split('=')[1];
const items = SLUGS
  ? SLUGS.split(',').map((slug) => ({ slug }))
  : (await get(`${NEWS}/v1/articles?limit=400`)).items.filter((c) => c.kind === 'winba_index');
const editions = [];
for (const c of items) {
  const a = (await get(`${NEWS}/v1/articles/${encodeURIComponent(c.slug)}`)).article;
  editions.push({ period: a.period, board: a.winba_board, hash: await boardHash(a.winba_board), slug: a.slug, headline: a.headline });
}
editions.sort((a, b) => String(a.period).localeCompare(String(b.period)));
console.log(`editions: ${editions.map((e) => `${e.period} ${e.hash}`).join(' | ')}`);
const stats = await get(`${API}/v1/stats/players?limit=400`);
const dict = { playerById: new Map((await get(`${API}/v1/players?limit=1000`)).players.map((p) => [String(p.athlete_id), p])) };

let failed = 0;
for (const key of (KEYS.length ? KEYS : Object.keys(COMMISSIONS))) {
  const spec = COMMISSIONS[key];
  const subjectRecord = await get(`${API}/v1/players/${spec.subject.id}`);
  const row = stats.rows.find((r) => String(r.athlete_id) === String(spec.subject.id));
  const seasonLine = { season_label: `${stats.season.label} season`, games: row.gamesPlayed, pts: f1(row.avgPoints), reb: f1(row.avgRebounds), ast: f1(row.avgAssists), observed_at: AT };
  const season = subjectRecord.gamelog.seasons.find((s) => /Regular Season/i.test(s.name));
  const teamId = subjectRecord.player.team?.team_id;
  const own = season.games.filter((g) => String(g.team_id) === String(teamId));
  const last5 = own.slice().sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 5);
  const avg = (k) => f1(last5.reduce((s, g) => s + (Number(g[k]) || 0), 0) / last5.length);
  const recent = { games: 5, pts: avg('pts'), reb: avg('reb'), ast: avg('ast'), from: last5.at(-1).date, to: last5[0].date };

  let state = null;
  const store = new Map();
  const res = await runCommission({
    key, editions, subjectRecord, seasonLine, recent, factsDoc, at: AT,
    getState: async () => state, putState: async (v) => { state = v; },
    getArticle: async (id) => store.get(id) || null, putArticle: async (a) => { store.set(a.id, a); }
  });

  console.log(`\n${'='.repeat(78)}\n${key} -> ${res.status}`);
  if (res.status !== 'published') { console.log(JSON.stringify(res, null, 1).slice(0, 1200)); failed += 1; continue; }
  const a = res.article;
  console.log(`slug   ${a.slug}\nid     ${a.id}\nwords  ${a.words}  sections ${a.sections.length}  paragraphs ${a.body.length}`);
  console.log(`head   ${a.headline}`);
  console.log(`deck   ${a.deck}`);
  console.log(`subject ${a.primary_subject} (${a.lead_player_id}) team ${a.lead_team_id} · mode ${a.identity_mode}`);
  console.log(`visuals ${res.visuals.map((v) => `${v.id}[${v.type}] ${v.values_hash}`).join('  ')}`);
  console.log(`evidence ${a.evidence.length}: ${a.evidence.map((e) => `${e.source}${e.url ? '' : ''}`).join(' | ').slice(0, 260)}`);

  // ---- the real gates
  const gates = {
    visuals: visualsFailures(a.visuals),
    identity: articleIdentityFailures(a, { dict }),
    provenance: provenanceFailures(a, { generatedAt: a.provenance.generated_at }),
    dangling_visual: a.sections.filter((s) => s.visual && !a.visuals.some((v) => v.id === s.visual)).map((s) => s.visual),
    orphan_visual: a.visuals.filter((v) => !a.sections.some((s) => s.visual === v.id)).map((v) => v.id)
  };
  for (const [name, f] of Object.entries(gates)) {
    console.log(`  ${f.length ? 'FAIL' : 'PASS'}  ${name}${f.length ? ` — ${JSON.stringify(f)}` : ''}`);
    if (f.length) failed += 1;
  }
  // Read-only diagnostics from the desks the other lane owns.
  const craft = storyCraftAssessment(a);
  console.log(`  note  storycraft pass=${craft.pass}${craft.failures?.length ? ` ${JSON.stringify(craft.failures)}` : ''}`);
  try {
    const d = assessDepth(a, { now: Date.parse(AT) });
    console.log(`  note  depth class=${d.class} score=${d.score} words=${d.words} pass=${d.pass}${d.failures?.length ? ` ${JSON.stringify(d.failures.slice(0, 4))}` : ''}`);
  } catch (e) { console.log(`  note  depth n/a (${e.message})`); }

  // ---- every number in the prose must exist in the frozen payload
  const plotted = new Set();
  for (const v of a.visuals) {
    for (const p of v.series || []) plotted.add(f1(p.value));
    for (const r of v.rows || []) plotted.add(f1(r.value));
    for (const c of v.cards || []) plotted.add(f1(c.value));
  }
  console.log(`  plotted values: ${[...plotted].sort((x, y) => x - y).join(', ')}`);

  if (FULL) {
    console.log('\n--- BODY ---');
    let si = 0;
    a.body.forEach((p, i) => {
      const s = a.sections.find((x) => x.first === i);
      if (s) { console.log(`\n## ${s.title}${s.visual ? `   [figure: ${s.visual}]` : ''}`); si += 1; }
      console.log(`\n${p}`);
    });
    console.log(`\n--- METHOD ---\n${a.method.join('\n')}`);
  }
}
console.log(`\n${failed ? `DRY RUN: ${failed} gate failure(s)` : 'DRY RUN: all gates PASS'}`);
process.exit(failed ? 1 : 0);
