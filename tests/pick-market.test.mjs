// PBE Picks x Kalshi on WNBA: a PICK call carries the Kalshi line for the SAME game (ESPN id) and the SAME side.
// No-calls get nothing; a graded / tipped-off call shows stored close evidence only, never a live quote; the frozen
// Algo vs Market line only from a frozen comparison of the same side; every price links to Kalshi (rel sponsored).
// Board fixture = REAL GET /v1/market-intelligence/sport/wnba entries captured 2026-10-03 (NY @ ATL 401918295 with
// mids; 401918297 with no Mid-market yet).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BOARD = JSON.parse(readFileSync(new URL('./fixtures/kalshi/board-wnba-picks.json', import.meta.url), 'utf8'));
const { pbeCallMarket } = await import('../src/data/pick-market.js');
const { flagshipPbeCard } = await import('../src/ui/pbe-flagship.js');
const byId = new Map(BOARD.events.map((e) => [String(e.event.canonical_event_id), e]));
const marketFor = (id) => byId.get(String(id)) || null;
const text = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const NOW = Date.parse('2026-10-03T22:00:00Z');
const entry = byId.get('401918295');
const home = entry.kalshi.outcomes.find((o) => o.role === 'home');
const away = entry.kalshi.outcomes.find((o) => o.role === 'away');
const call = (extra = {}) => ({
  call: 'PICK', pick_team_id: 'H', phase: 'PRE_LOCK', pick_probability: 0.6, p_home: 0.6, p_away: 0.4,
  game: { game_id: '401918295', scheduled_tip_utc: '2026-10-04T18:00:00Z', home_team_id: 'H', away_team_id: 'A', home: { name: 'Dream' }, away: { name: 'Liberty' } },
  ...extra,
});
const cents = (bp) => `${(bp / 100).toFixed(1)}¢`;

test('the pick side only, linked to Kalshi', () => {
  const h = pbeCallMarket(call(), { marketFor, now: NOW });
  assert.equal(text(h), `KALSHI ${home.abbr} ${cents(home.mid_bp)} PBE pick side`);
  assert.ok(h.includes('rel="noopener noreferrer sponsored"') && h.includes(`href="${entry.kalshi.market_url}"`));
  assert.equal(text(pbeCallMarket(call({ pick_team_id: 'A' }), { marketFor, now: NOW })), `KALSHI ${away.abbr} ${cents(away.mid_bp)} PBE pick side`);
});

test('nothing for no-calls, missing mids, other games, tipped-off or graded calls without a recorded close', () => {
  assert.equal(pbeCallMarket(call({ call: 'NO_CALL' }), { marketFor, now: NOW }), '');
  assert.equal(pbeCallMarket(call({ game: { ...call().game, game_id: '401918297' } }), { marketFor, now: NOW }), '');
  assert.equal(pbeCallMarket(call({ game: { ...call().game, game_id: '1' } }), { marketFor, now: NOW }), '');
  assert.equal(pbeCallMarket(call(), { marketFor, now: Date.parse('2026-10-04T18:30:00Z') }), '');
  assert.equal(pbeCallMarket(call({ grade: { result: 'WIN' } }), { marketFor, now: NOW }), '');
});

test('frozen Algo vs Market for the same side; LOCKED reveals nothing', () => {
  const avm = { algos: [{ ledger: [
    { canonical_event_id: '401918295', status: 'DISAGREEMENT', algo_selection: 'home', algo_probability: 0.55, market: { market_url: entry.kalshi.market_url, prices: { home: { mid_bp: 6000 } } } },
  ] }] };
  assert.match(text(pbeCallMarket(call(), { marketFor, avm, now: NOW })), /AT PBE LOCK PBE 55\.0% · Market 60\.0¢ · −5\.0 pts/);
  assert.doesNotMatch(pbeCallMarket(call({ pick_team_id: 'A' }), { marketFor, avm, now: NOW }), /AT PBE LOCK/);
  const locked = { algos: [{ ledger: [{ canonical_event_id: '401918295', status: 'LOCKED', algo_selection: null }] }] };
  assert.doesNotMatch(pbeCallMarket(call(), { marketFor, avm: locked, now: NOW }), /AT PBE LOCK/);
});

test('flagship card renders the line inside the PBE PICK block, and nothing without it', () => {
  const m = pbeCallMarket(call(), { marketFor, now: NOW });
  const card = String(flagshipPbeCard(call(), { market: m }));
  assert.match(text(card), new RegExp(`PBE PICK .*KALSHI ${home.abbr} ${cents(home.mid_bp).replace('.', '\\.')} PBE pick side`));
  assert.doesNotMatch(String(flagshipPbeCard(call())), /kx-pick|KALSHI/);
});

test('every identifier the PBE Picks page uses for Kalshi is imported (regression: wireKalshi ReferenceError b863071)', () => {
  const src = readFileSync(new URL('../src/pages/pbe-picks.js', import.meta.url), 'utf8');
  const imported = new Set([...src.matchAll(/^import {([^}]*)} from/gm)].flatMap((m) => m[1].split(',').map((x) => x.trim())));
  for (const name of ['wireKalshi', 'pbeCallMarket', 'kalshi', 'loadAlgoVsMarket', 'within']) {
    assert.ok(src.includes(name + '(') || src.includes(name + '.'), name + ' is used');
    assert.ok(imported.has(name), name + ' is imported');
  }
});
