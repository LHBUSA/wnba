// Dry-run the in-house article engine locally against the live, public wnba-api and the external source
// wire, exactly as articles-run.js assembles its inputs, and report every article's publication-gate result.
// Nothing is written anywhere.
//   node scripts/newsroom-dryrun.mjs            # current structure selection
//   node scripts/newsroom-dryrun.mjs --all      # every editorial structure of every story through the gate
import { injuryArticles, transactionArticles, resultArticles, previewArticles, trendArticles, propArticles, marketMoveArticles, __setVariantOverride, VARIANTS } from '../workers/wnba-news/src/articles.js';
import { buildDictionary } from '../workers/wnba-news/src/editorial.js';

const API = process.env.WNBA_API || 'https://wnba-api.sales-fd3.workers.dev';
const NEWS = process.env.WNBA_NEWS || 'https://wnba-news.sales-fd3.workers.dev';
const UA = { 'user-agent': 'pbe-newsroom-dryrun/1' };
const cache = new Map();
async function apiGet(path) {
  if (cache.has(path)) return cache.get(path);
  const p = fetch(API + path, { headers: UA }).then((r) => r.json()).then((b) => { if (!b?.ok) throw new Error(`api ${path} ${b?.error?.code}`); return b.data; });
  cache.set(path, p);
  return p;
}
const et = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replaceAll('-', '');
const add = (s, n) => { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + n)); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; };

const soft = async (p) => { try { return await apiGet(p); } catch { return null; } };
const today = et();
const now = Date.now();
const [inj, tx, sched, longSched, standings, props, players, wire] = await Promise.all([
  soft('/v1/injuries'), soft('/v1/transactions'), soft(`/v1/schedule?from=${add(today, -14)}&to=${add(today, 7)}`),
  soft(`/v1/schedule?from=${add(today, -50)}&to=${today}`), soft('/v1/standings'), soft('/v1/props'), soft('/v1/players'),
  fetch(`${NEWS}/v1/news?limit=200`, { headers: UA }).then((r) => r.json()).catch(() => null)
]);
const standingsById = new Map((standings?.groups || []).flatMap((g) => g.entries.map((e) => [e.team_id, { ...e, conference_name: g.name }])));
const games = sched?.games || [];
const finals = games.filter((g) => g.status?.state === 'post' && g.status?.completed).sort((a, b) => b.start_utc.localeCompare(a.start_utc)).slice(0, 10);
const upcoming = games.filter((g) => g.status?.state === 'pre').sort((a, b) => a.start_utc.localeCompare(b.start_utc)).slice(0, 8);
const finalsByTeam = new Map();
for (const g of (longSched?.games || []).filter((x) => x.status?.state === 'post' && x.status?.completed).sort((a, b) => b.start_utc.localeCompare(a.start_utc))) {
  for (const t of [g.home?.team_id, g.away?.team_id]) { if (!finalsByTeam.has(t)) finalsByTeam.set(t, []); finalsByTeam.get(t).push(g); }
}
const teamsList = [];
const seenT = new Set();
for (const p of players?.players || []) if (p.team && !seenT.has(p.team.team_id)) { seenT.add(p.team.team_id); teamsList.push(p.team); }
const rawDict = { players: (players?.players || []).map((p) => ({ athlete_id: p.athlete_id, name: p.name, team_id: p.team_id })), teams: teamsList };
const dict = buildDictionary(rawDict);
const externalItems = (wire?.data?.items || []);
const externalByPlayer = new Map();
for (const it of externalItems) for (const e of it.entities || []) if (e.type === 'player') { if (!externalByPlayer.has(e.id)) externalByPlayer.set(e.id, []); externalByPlayer.get(e.id).push(it); }
for (const v of externalByPlayer.values()) v.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));

const ctx = { api: soft, injuries: inj?.items || [], externalByPlayer, schedule: games, standingsById, now, transactions: tx?.items || [], dict, finals, upcoming, finalsByTeam, teams: teamsList, props };
const GENS = [['injury', injuryArticles], ['transaction', transactionArticles], ['result', resultArticles], ['preview', previewArticles], ['trend', trendArticles], ['props', propArticles], ['market', marketMoveArticles]];

const all = process.argv.includes('--all');
const show = process.argv.includes('--show');
let total = 0;
let held = 0;
const passes = all ? [...Array(Math.max(...Object.values(VARIANTS))).keys()] : [null];
for (const v of passes) {
  __setVariantOverride(v);
  for (const [name, fn] of GENS) {
    const xs = await fn(ctx);
    for (const a of xs) {
      if (v !== null && v >= (VARIANTS[a.kind] || 1)) continue;
      total += 1;
      if (!a.gate.ok) held += 1;
      console.log(`${a.gate.ok ? 'PASS' : 'HELD'} ${v === null ? `v${a.structure}` : `v${v}`} ${a.kind.padEnd(11)} ${a.headline.slice(0, 96)}`);
      if (!a.gate.ok) for (const f of a.gate.failures.slice(0, 4)) console.log(`       - ${f}`);
      if (show) { console.log(`       deck: ${a.deck}`); for (const p of a.body) console.log(`       | ${p}`); }
    }
  }
}
__setVariantOverride(null);
console.log(`\n${total} articles, ${held} held`);
process.exit(held ? 1 : 0);
