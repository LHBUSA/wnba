#!/usr/bin/env node
// Re-runnable WNBA source canary. Proves each capability through the OWNED
// runtime (Cloudflare egress), not from a laptop. Spends zero odds credits:
// market capability is read from the last scheduled ingest.
// Usage: node scripts/canary-sources.mjs [--out=docs/evidence/canary-latest.json]

import fs from 'node:fs';

const API = process.env.WNBA_API || 'https://wnba-api.sales-fd3.workers.dev';
const NEWS = process.env.WNBA_NEWS || 'https://wnba-news.sales-fd3.workers.dev';
const out = (process.argv.find((a) => a.startsWith('--out=')) || '--out=docs/evidence/canary-latest.json').split('=')[1];

const get = async (u) => {
  const t0 = Date.now();
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(45000) });
    const body = await r.json();
    return { status: r.status, ms: Date.now() - t0, body };
  } catch (e) {
    return { status: null, ms: Date.now() - t0, error: e.message };
  }
};

const results = [];
const check = (capability, res, test, evidence) => {
  let pass = false;
  let detail = '';
  try { const v = test(res.body); pass = Boolean(v?.pass ?? v); detail = v?.detail ?? ''; } catch (e) { detail = e.message; }
  const status = pass ? 'PASS' : res.body?.ok ? 'DEGRADED' : 'FAIL';
  results.push({ capability, status, http: res.status, ms: res.ms, freshness: res.body?.meta?.freshness ?? null, detail, evidence: evidence?.(res.body) ?? null });
  console.log(`${status.padEnd(8)} ${capability.padEnd(28)} ${detail}`);
};

const final = '401857189';
const today = await get(`${API}/v1/today`);
check('schedule / game ids', today, (b) => ({ pass: b.ok && b.data.slate, detail: `${b.data.slate.kind} ${b.data.slate.date} · ${b.data.slate.games.length} games` }));
const live = await get(`${API}/v1/games/${final}/live`);
check('game detail + box score', live, (b) => ({ pass: b.ok && b.data.box.players.length > 10, detail: `${b.data.game.away.abbr} ${b.data.game.away.score}-${b.data.game.home.score} ${b.data.game.home.abbr} · ${b.data.box.players.length} box rows` }));
check('play-by-play', live, (b) => ({ pass: b.data.events.length > 300, detail: `${b.data.events.length} events · ${b.meta.semantics}` }));
check('shot coordinates', live, (b) => ({ pass: b.data.shots.plotted > 0, detail: `${b.data.shots.plotted}/${b.data.shots.total_fga} FGA located` }));
check('replay archive', live, (b) => ({ pass: b.meta.semantics === 'FINAL_PERSISTED_ARCHIVE', detail: b.meta.semantics }));
check('standings', await get(`${API}/v1/standings`), (b) => ({ pass: b.ok && b.data.groups.length === 2, detail: `${b.data.label} · current=${b.data.is_current}` }));
check('teams', await get(`${API}/v1/teams`), (b) => ({ pass: b.data.teams.length === 15, detail: `${b.data.teams.length} teams` }));
check('rosters / players', await get(`${API}/v1/players`), (b) => ({ pass: b.data.players.length > 150 && !b.data.missing_teams.length, detail: `${b.data.players.length} players · photos ${b.data.photo_coverage.approved}` }));
check('player page + game log', await get(`${API}/v1/players/4433730`), (b) => ({ pass: b.ok && b.data.gamelog?.seasons?.[0]?.games?.length > 0, detail: `${b.data.player.name} · ${b.data.gamelog.seasons[0].games.length} games` }));
check('injuries / availability', await get(`${API}/v1/injuries`), (b) => ({ pass: b.ok && b.data.items.length >= 0, detail: `${b.data.items.length} listed · ${b.data.changes.length} changes logged` }));
check('transactions', await get(`${API}/v1/transactions`), (b) => ({ pass: b.ok && b.data.items.length > 0, detail: `${b.data.items.length} items` }));
check('player season stats', await get(`${API}/v1/stats/players`), (b) => ({ pass: b.data.rows.length > 50, detail: `${b.data.rows.length} qualified players` }));
check('team season stats', await get(`${API}/v1/stats/teams`), (b) => ({ pass: b.data.rows.length === 15, detail: `${b.data.rows.length} teams` }));
check('matchup research', await get(`${API}/v1/matchups/401857190`), (b) => ({ pass: b.ok && b.data.teams.every((t) => t.rotation.sample > 0), detail: b.data.teams.map((t) => `${t.team.abbr} rot n=${t.rotation.sample}`).join(' · ') }));
const odds = await get(`${API}/v1/odds`);
check('game odds', odds, (b) => ({ pass: b.data.events.length > 0, detail: `${b.data.events.length} events · captured ${b.data.captured_at}` }));
const props = await get(`${API}/v1/props`);
check('player props', props, (b) => ({ pass: (b.data.games || []).some((g) => g.props.length), detail: `${(b.data.games || []).reduce((a, g) => a + g.props.length, 0)} prop rows (captured only for games within 36h)` }));
const src = await get(`${API}/v1/sources`);
check('provider egress (Cloudflare)', src, (b) => ({ pass: b.data.probes.filter((p) => p.name !== 'site_api_host').every((p) => p.pass), detail: b.data.probes.map((p) => `${p.name}:${p.status}`).join(' ') }));
const news = await get(`${NEWS}/v1/news?limit=100`);
check('news — official + external', news, (b) => ({ pass: b.data.items.some((i) => i.source?.id === 'wnba_com') && b.data.items.some((i) => i.source?.id && i.source.id !== 'wnba_com'), detail: `${b.data.total} items · last ingest ${b.meta.last_ingest_at}` }));
check('news — PBE Desk (owned)', news, (b) => ({ pass: b.data.items.some((i) => i.lane === 'pbe'), detail: `${b.data.items.filter((i) => i.lane === 'pbe').length} desk stories` }));
check('news — dedupe clusters', news, (b) => ({ pass: b.data.items.some((i) => i.also_covered_by?.length), detail: `${b.data.items.filter((i) => i.also_covered_by?.length).length} cross-publisher clusters` }));

const summary = results.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
fs.mkdirSync(out.split('/').slice(0, -1).join('/'), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), api: API, news: NEWS, summary, results }, null, 2));
console.log(`\n${JSON.stringify(summary)} → ${out}`);
