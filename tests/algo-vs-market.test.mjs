// ALGO vs MARKET on WNBA (shared module, vendored unchanged; contract algo-vs-market/1).
// Track record and the event layers (matchup page + WNBACast) render NOTHING until the API has a qualifying frozen
// comparison; with one they render the module's score + ledger; a LOCKED row (Pro-gated, ungraded) never shows a
// selection. The fixture is the REAL soccer response (one AGREEMENT, 2026-10-03) reshaped only in sport / algo
// identity / canonical id (NY @ ATL, 401918295).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const FX = JSON.parse(read('tests/fixtures/kalshi/wnba-avm-derived.json'));
const { algoVsMarketCard } = await import('../src/vendor/kalshi/kalshi-market-ui.js');
const { loadAlgoVsMarket, loadAlgoVsMarketEvent, avmEventMarkup, matchupAvmSlot, avmWithEventLabels, avmFinal, trackAvmMarkup } = await import('../src/data/kalshi.js');
const { teamName } = await import('../src/ui/pbe.js');
const avmMarkup = (body, rows) => trackAvmMarkup(body, rows, (id) => teamName({ team_id: id }, { short: true }));

const GAME = { game_id: '401918295', status: { state: 'pre' }, home: { team_id: '20', abbr: 'ATL', short_name: 'Dream' }, away: { team_id: '9', abbr: 'NY', short_name: 'Liberty' } };
const text = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const clone = (v) => structuredClone(v);
const lockedRow = (r) => ({ ...clone(r), status: 'LOCKED', algo_selection: null, algo_selection_label: null, algo_probability: null,
  market: { ...clone(r.market), selection: null, selection_label: null, selection_price_bp: null }, result: null });

test('fixture is the real response shape: one AGREEMENT, scoreboard as returned', () => {
  const a = FX.track.algos[0];
  assert.equal(a.algo_id, 'wnba:pbe-wnba-model-v1');
  assert.equal(a.ledger[0].canonical_event_id, '401918295');
  assert.deepEqual([a.scoreboard.agreements, a.scoreboard.disagreements, a.scoreboard.pending, a.scoreboard.decided], [1, 0, 1, 0]);
});

test('loaders read our markets Worker; a failed read is null (nothing renders)', async () => {
  const urls = [];
  const fx = async (url) => { urls.push(String(url)); return { ok: true, json: async () => clone(String(url).includes('/event/') ? FX.event : FX.track) }; };
  assert.equal((await loadAlgoVsMarket({ fetchImpl: fx })).algos.length, 1);
  assert.equal((await loadAlgoVsMarketEvent('401918295', { fetchImpl: fx })).comparisons.length, 1);
  assert.deepEqual(urls, ['https://propsports-markets.sales-fd3.workers.dev/v1/algo-vs-market/wnba', 'https://propsports-markets.sales-fd3.workers.dev/v1/algo-vs-market/event/wnba/401918295']);
  const down = async () => ({ ok: false, status: 503, json: async () => ({}) });
  assert.equal(await loadAlgoVsMarket({ fetchImpl: down }), null);
  assert.equal(await loadAlgoVsMarketEvent('401918295', { fetchImpl: async () => { throw new Error('offline'); } }), null);
});

test('track record: empty algos / failed read -> nothing new on the page', () => {
  assert.equal(avmMarkup({ contract: 'algo-vs-market/1', sport: 'wnba', algos: [] }), '');
  assert.equal(avmMarkup(null), '');
  assert.equal(algoVsMarketCard(null), '');
  const page = read('src/pages/track-record.js');
  assert.ok(page.includes(`<div class="\${avmFirst ? 'section' : ''}" data-track-avm>\${raw(avmFirst)}</div>`), 'an empty slot is a bare zero-height div');
});

test('track record: the real comparison renders the score and the ledger row', () => {
  const t = text(avmMarkup(FX.track));
  assert.match(t, /^Algo vs Market When the algo and the market disagree, who wins\?/);
  assert.match(t, /PropBetEdge 0 — Market 0/);
  assert.match(t, /0 decided disagreements/);
  assert.match(t, /Agreed 1 Neither \/ void 0 Pending 1/);
  assert.match(t, /2026-10-03 Bayern München @ Augsburg Bayern München Bayern München · 80\.5¢ Agree Pending/);
  assert.doesNotMatch(t, /beats the market/i);
  // A Pro viewer's ledger row for the game supplies the event label (teams by id from the shipped manifest).
  const pro = text(avmMarkup(FX.track, [{ game: { game_id: '401918295', away_team_id: '9', home_team_id: '20' } }]));
  assert.match(pro, /2026-10-03 Liberty @ Dream /);
  assert.equal(avmWithEventLabels(FX.track.algos[0]).ledger[0].event_label, 'Bayern München @ Augsburg');
  assert.equal(FX.track.algos[0].ledger[0].event_label, undefined, 'input not mutated');
});

test('event layer: nothing for no comparison / another game / non-qualifying; the real comparison renders', () => {
  assert.equal(avmEventMarkup(null, GAME), '');
  assert.equal(avmEventMarkup({ comparisons: [] }, GAME), '');
  assert.equal(avmEventMarkup(FX.event, { ...GAME, game_id: '401918296' }), '');
  assert.equal(avmEventMarkup({ comparisons: [{ ...clone(FX.event.comparisons[0]), status: 'STALE_MARKET_SNAPSHOT' }] }, GAME), '');
  assert.equal(String(matchupAvmSlot(null, GAME).s ?? matchupAvmSlot(null, GAME)), '<div class="kx-slot kx-slot--matchup kx-slot--avm" data-avm-slot></div>');
  const t = text(avmEventMarkup(FX.event, GAME));
  assert.match(t, /^Algo vs Market Agreement · frozen 2026-10-03/);
  assert.match(t, /PBE WNBA Model Bayern München 71\.4% vs Market at PBE lock Bayern München 80\.5¢/);
  assert.match(t, /Market price recorded 2 min before the algorithm locked/);
  assert.equal(avmFinal(FX.event), false);
  assert.equal(avmFinal({ comparisons: [{ result: { h2h_outcome: 'NEITHER' } }] }), true);
});

test('LOCKED rows show no selection, on the track record and on the event layer', () => {
  const card = avmMarkup({ algos: [{ ...clone(FX.track.algos[0]), ledger: [lockedRow(FX.track.algos[0].ledger[0])] }] });
  const row = card.slice(card.indexOf('<tbody>'), card.indexOf('</tbody>'));
  assert.match(row, /<td>Locked<\/td><td class="mono">—<\/td><td>—<\/td><td><b>Locked · pending<\/b><\/td>/);
  assert.doesNotMatch(row, /80\.5¢|71\.4%/);
  const ev = avmEventMarkup({ comparisons: [lockedRow(FX.event.comparisons[0])] }, GAME);
  assert.match(text(ev), /Locked — revealed after the result/);
  const vs = ev.slice(ev.indexOf('avm__vs'), ev.indexOf('kx__note'));
  assert.match(vs, /<b>—<\/b>[\s\S]*<b>—<\/b>/);
  assert.doesNotMatch(vs, /Bayern|Augsburg|NY|ATL|%|¢/);
});

test('wiring: matchup page + WNBACast mount the layer in its own slot under Market Pulse; track page under the summary', () => {
  const m = read('src/pages/matchups.js');
  assert.ok(m.includes('${matchupKalshiSlot(kxFirst ?? null, g)}${matchupAvmSlot(avmFirst ?? null, g)}'));
  const cast = read('src/pages/cast.js');
  assert.match(cast, /\$\{kalshiSlot\(g\)\}\r?\n\s+\$\{avmSlot\(g\)\}/);
  assert.ok(cast.includes('kxPending = Promise.all([p, loadAvm()])'));
  const tr = read('src/pages/track-record.js');
  assert.ok(tr.indexOf('data-track-avm') > tr.indexOf('data-track-summary>${trackSummary(d)}'));
  for (const f of ['src/pages/matchups.js', 'src/pages/cast.js', 'src/pages/track-record.js']) assert.doesNotMatch(read(f), /https?:\/\/[^'"`\s]*propsports-markets/, f);
});
