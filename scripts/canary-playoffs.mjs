#!/usr/bin/env node
// Postseason source-shape canary. Walks the exact capture path wnba-ingest's playoffs task uses and fails
// loudly if the provider shape the bracket depends on has changed. Read-only; writes nothing but its report.
//   league standings (level=1)  -> playoffSeed + clincher{displayValue,description}, seasons[].types[3] window
//   scoreboard calendar         -> leagues[0].calendar whitelisted game days
//   single-date scoreboards     -> season.type 3 events with notes[].headline "<Round> - Game N" + series{}
//   core types/3/events         -> id list for the completeness cross-check
// Then the real normalizer must build a VALID bracket from what it fetched.
// Usage: node scripts/canary-playoffs.mjs [--season=2026] [--out=docs/evidence/playoffs-canary-latest.json]
// Note: scoreboard DATE RANGES answer 400 from both residential and Cloudflare egress; this uses single dates.

import fs from 'node:fs';
import { buildWnbaPlayoffs, seasonWindow, postseasonDays, parseRoundNote, WNBA_ROUNDS } from '../workers/shared/playoffs-wnba.js';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=')[1];
const S = 'https://site.web.api.espn.com/apis/site/v2/sports/basketball/wnba';
const V2 = 'https://site.web.api.espn.com/apis/v2/sports/basketball/wnba';
const C = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba';
const out = arg('out', 'docs/evidence/playoffs-canary-latest.json');
const get = async (u) => {
  const r = await fetch(u, { headers: { 'user-agent': 'PropBetEdge-WNBA/1.0 canary' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} ${u}`);
  return r.json();
};

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, status: pass ? 'PASS' : 'FAIL', detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(38)} ${detail}`);
};

const seasonArg = arg('season', '');
const standings = await get(`${V2}/standings?level=1${seasonArg ? `&season=${seasonArg}` : ''}`);
const season = Number(seasonArg || standings?.standings?.season);
const entries = standings?.standings?.entries || [];
const stat = (e, n) => (e.stats || []).find((s) => s.name === n);
check('standings level=1: league seeds', entries.length >= 12 && entries.every((e) => Number.isInteger(stat(e, 'playoffSeed')?.value)), `${entries.length} teams · seeds ${entries.map((e) => stat(e, 'playoffSeed')?.value).join(',')}`);
check('standings: clincher descriptions', entries.filter((e) => stat(e, 'clincher')).every((e) => typeof stat(e, 'clincher').description === 'string'), [...new Set(entries.map((e) => stat(e, 'clincher')?.description).filter(Boolean))].join(' | '));
const window = seasonWindow(standings, season);
check('season window: postseason type 3', Boolean(window.postseason), JSON.stringify(window.postseason));

const start = String(window.postseason?.start || '').slice(0, 10).replaceAll('-', '');
const cal = await get(`${S}/scoreboard?dates=${start}&limit=100`);
const days = postseasonDays(cal, window);
check('scoreboard calendar: postseason days', Array.isArray(cal?.leagues?.[0]?.calendar) && days.length > 0, `${days.length} days ${days[0] || ''}..${days.at(-1) || ''}`);

const events = [];
for (const d of days) {
  const b = await get(`${S}/scoreboard?dates=${d}&limit=100`);
  events.push(...(b.events || []).filter((e) => e?.season?.year === season && e?.season?.type === 3));
}
const labels = [...new Set(events.map((e) => parseRoundNote(e.competitions?.[0]?.notes?.[0]?.headline).label))];
check('events: season.type 3 found', events.length > 0 || Date.now() < Date.parse(window.postseason?.start || 0), `${events.length} postseason events`);
check('events: notes "<Round> - Game N"', events.every((e) => Number.isInteger(parseRoundNote(e.competitions?.[0]?.notes?.[0]?.headline).game_number)), `labels: ${labels.join(' | ')}`);
check('events: every round label supported', labels.every((l) => WNBA_ROUNDS.some((r) => r.match(l))), labels.join(' | '));
check('events: series{type:playoff,competitors}', events.every((e) => e.competitions?.[0]?.series?.type === 'playoff' && Array.isArray(e.competitions[0].series.competitors)), `${events.filter((e) => e.competitions?.[0]?.series).length}/${events.length} carry series`);
const tbd = events.filter((e) => e.competitions[0].competitors.some((c) => Number(c.team?.id) < 0)).length;
check('events: team identity or TBD placeholder', events.every((e) => e.competitions[0].competitors.every((c) => /^-?\d+$/.test(String(c.team?.id)) && c.team?.abbreviation)), `${events.length - tbd} with both teams · ${tbd} placeholder`);

const core = await get(`${C}/seasons/${season}/types/3/events?limit=200`);
const coreIds = (core.items || []).map((x) => String(x.$ref).match(/events\/(\d+)/)?.[1]).filter(Boolean);
const scanned = new Set(events.map((e) => String(e.id)));
check('core id list matches the scan', coreIds.every((id) => scanned.has(id)), `core ${coreIds.length} · scanned ${scanned.size} · missing ${coreIds.filter((id) => !scanned.has(id)).join(',') || 'none'}`);

const built = buildWnbaPlayoffs({ season, events, standingsBody: standings, capturedAt: new Date().toISOString() });
check('normalizer builds a VALID bracket', built.ok, built.ok
  ? `${built.snapshot.status} · ${built.snapshot.rounds.map((r) => `${r.name} bo${r.best_of} ${r.series.filter((s) => s.status !== 'TBD').length}/${r.series_expected}`).join(' · ')}${built.snapshot.champion ? ` · champion ${built.snapshot.champion.abbreviation}` : ''}`
  : built.errors.join(', '));
if (built.warnings.length) console.log(`      warnings: ${built.warnings.join(', ')}`);

const summary = checks.reduce((a, c) => ({ ...a, [c.status]: (a[c.status] || 0) + 1 }), {});
fs.mkdirSync(out.split('/').slice(0, -1).join('/'), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), season, summary, checks, warnings: built.warnings }, null, 2));
console.log(`\n${JSON.stringify(summary)} -> ${out}`);
process.exit(summary.FAIL ? 1 : 0);
