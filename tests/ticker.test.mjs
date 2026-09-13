// Top ticker (pbe-ticker/1.0.0): a live game/status rail for WNBA and international play, headlines only as fallback.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTicker, TICKER_CAPS, intlName, startLabel } from '../src/lib/ticker.js';
import { tickerRail } from '../src/views/today.js';

const NOW = Date.parse('2026-09-13T19:20:00Z');
const wnba = (id, state, o = {}) => ({ game_id: id, start_utc: o.start || '2026-09-13T23:30Z', status: { state, period: o.period ?? 0, clock: o.clock ?? null, short_detail: o.detail ?? null }, away: { abbr: o.away || 'SEA', name: 'Seattle Storm', score: o.as ?? null }, home: { abbr: o.home || 'LV', name: 'Las Vegas Aces', score: o.hs ?? null } });
const team = (code, name, short = name) => ({ team_id: `nt-${code.toLowerCase()}`, country_code: code, name, short_name: short, provider_ids: { espn: code } });
const intl = (espn, status, o = {}) => ({ game_id: `g-${espn}`, provider_ids: { espn }, status, scheduled_at: o.start || '2026-09-13T18:00Z', round_name: o.round || 'Final · Gold Medal Game', period_label: o.period || null, clock: o.clock || null, away_team: o.away || team('USA', 'United States'), home_team: o.home || team('FRA', 'France'), away_score: o.as ?? null, home_score: o.hs ?? null });
const stories = [{ kind: 'preview', headline: 'Aces at Storm: the Aces lay 8.5', slug: 'aces-at-storm-03dcc7' }, { kind: 'injury', headline: 'Janelle Salaun listed out', slug: 'salaun-9205ee' }, { kind: 'trend', headline: 'Unders in 8 of the Sky’s last 10', slug: 'sky-6b9bdc' }];

test('1 · live WNBA games lead the rail, with score and clock, linking to WNBACast', () => {
  const t = buildTicker({ wnbaGames: [wnba('1', 'in', { as: 61, hs: 58, period: 3, clock: '4:12', detail: 'Q3 4:12' }), wnba('2', 'pre', { away: 'IND', home: 'NY' })], stories, now: NOW });
  assert.equal(t.mode, 'live');
  assert.deepEqual(t.items.map((x) => `${x.label} • ${x.text}${x.meta ? ` • ${x.meta}` : ''}`), ['LIVE • SEA 61 – 58 LV • Q3 4:12', 'NEXT • IND at NY • 7:30 PM ET']);
  assert.equal(t.items[0].destination_url, '/cast/1');
  assert.equal(t.items[1].destination_url, '/matchups/2');
  assert.ok(!t.items.some((x) => x.item_type === 'story'), 'no headlines while games exist');
});

test('2 · live international games are included, tagged INTL, linking to the international game center', () => {
  const t = buildTicker({ intlLive: [intl('401917260', 'live', { as: 71, hs: 54, period: 'Q3', clock: '0:15' })], stories, now: NOW });
  assert.equal(t.mode, 'live');
  assert.equal(`${t.items[0].label} • ${t.items[0].text} • ${t.items[0].meta}`, 'INTL LIVE • United States 71 – 54 France • Q3 0:15');
  assert.equal(t.items[0].sport_scope, 'international');
  assert.equal(t.items[0].destination_url, '/international/games/401917260');
});

test('3 · live WNBA + live international: WNBA live first, international live second, then next games, then finals', () => {
  const t = buildTicker({
    wnbaGames: [wnba('2', 'pre', { away: 'IND', home: 'NY', start: '2026-09-13T23:00Z' }), wnba('1', 'in', { as: 61, hs: 58, detail: 'Q3 4:12' })],
    wnbaRecent: [wnba('0', 'post', { away: 'NY', home: 'CON', as: 87, hs: 81, start: '2026-09-13T00:00Z' })],
    intlLive: [intl('9', 'live', { as: 54, hs: 49, away: team('ESP', 'Spain'), home: team('FRA', 'France'), period: 'Q4', clock: '7:21' })],
    intlUpcoming: [intl('10', 'scheduled', { start: '2026-09-14T15:00Z' })],
    intlRecent: [intl('8', 'final', { as: 81, hs: 58, away: team('ESP', 'Spain'), home: team('GER', 'Germany'), start: '2026-09-13T14:30Z', round: 'Bronze Medal Game' })],
    stories,
    now: NOW
  });
  assert.deepEqual(t.items.map((x) => `${x.sport_scope}:${x.item_type}`), ['wnba:live_game', 'international:live_game', 'wnba:upcoming_game', 'international:upcoming_game', 'wnba:final_game', 'international:final_game']);
  assert.equal(t.items[3].text, 'United States vs France');
  assert.equal(t.items[3].meta, 'Mon 11:00 AM ET');
  assert.equal(t.items[5].text, 'Spain 81 – 58 Germany');
});

test('4 · no live games: next WNBA games, then next international games', () => {
  const t = buildTicker({ wnbaGames: [wnba('5', 'pre', { away: 'CON', home: 'ATL', start: '2026-09-17T23:30Z' })], intlUpcoming: [intl('11', 'scheduled', { start: '2026-09-14T15:00Z' })], stories, now: NOW });
  assert.equal(t.mode, 'next');
  assert.deepEqual(t.items.map((x) => `${x.label} • ${x.text} • ${x.meta}`), ['NEXT • CON at ATL • Thu 7:30 PM ET', 'INTL NEXT • United States vs France • Mon 11:00 AM ET']);
});

test('5 · only recent finals: WNBA then international; stale finals are not "recent"', () => {
  const t = buildTicker({ wnbaRecent: [wnba('0', 'post', { away: 'NY', home: 'CON', as: 87, hs: 81, start: '2026-09-13T00:00Z' }), wnba('old', 'post', { as: 90, hs: 80, start: '2026-08-30T19:00Z' })], intlRecent: [intl('401917260', 'final', { as: 97, hs: 79 })], stories, now: Date.parse('2026-09-13T21:00:00Z') });
  assert.equal(t.mode, 'final');
  assert.deepEqual(t.items.map((x) => `${x.label} • ${x.text}`), ['FINAL • NY 87 – 81 CON', 'INTL FINAL • United States 97 – 79 France']);
  assert.ok(!t.items.some((x) => x.destination_url === '/cast/old'), 'a two-week-old final is not on the live rail');
});

test('6 · no games at all → fallback content only: lead story, key injury, key market/trend item', () => {
  const t = buildTicker({ stories, now: NOW });
  assert.equal(t.mode, 'headlines');
  assert.deepEqual(t.items.map((x) => `${x.label} • ${x.destination_url}`), ['NEWS • /news/aces-at-storm-03dcc7', 'INJURY • /news/salaun-9205ee', 'MARKET • /news/sky-6b9bdc']);
  assert.equal(buildTicker({ now: NOW }).mode, 'empty');
});

test('7 · long names and caps: no crowding out, no giant items', () => {
  assert.equal(intlName(team('BIH', 'Bosnia and Herzegovina')), 'BIH');
  assert.equal(intlName(team('USA', 'United States')), 'United States');
  const many = Array.from({ length: 20 }, (_, i) => wnba(String(100 + i), 'pre', { start: `2026-09-1${4 + (i % 5)}T23:00Z` }));
  const t = buildTicker({ wnbaGames: many, intlUpcoming: Array.from({ length: 10 }, (_, i) => intl(String(900 + i), 'scheduled', { start: '2026-09-14T15:00Z' })), now: NOW });
  assert.equal(t.items.filter((x) => x.sport_scope === 'wnba').length, TICKER_CAPS.next_wnba);
  assert.equal(t.items.filter((x) => x.sport_scope === 'international').length, TICKER_CAPS.next_intl, 'international still appears');
  assert.ok(t.items.every((x) => `${x.label} ${x.text} ${x.meta || ''}`.length <= 60));
  assert.equal(startLabel('2026-09-13T23:30Z', NOW), '7:30 PM ET');
});

test('8 · rail markup: each item links to its own destination, duplicate loop copy is hidden from assistive tech', () => {
  const t = buildTicker({ wnbaGames: [wnba('1', 'in', { as: 61, hs: 58, detail: 'Q3 4:12' }), wnba('2', 'pre')], intlRecent: [intl('401917260', 'final', { as: 97, hs: 79 })], now: NOW });
  const html = String(tickerRail(t, { freshness: 'Updated 12 seconds ago' }));
  assert.match(html, /data-ticker-mode="live"/);
  assert.match(html, /<a class="tk-item tk-live_game " href="\/cast\/1" tabindex="0" aria-hidden="false"><b class="tk-tag">LIVE<\/b><span class="tk-text">SEA 61 – 58 LV<\/span><span class="tk-meta">Q3 4:12<\/span><\/a>/);
  assert.doesNotMatch(html, /&quot;/, 'attributes are real attributes, not escaped text');
  assert.match(html, /href="\/international\/games\/401917260"[^>]*><b class="tk-tag">INTL FINAL<\/b>/);
  assert.match(html, /tabindex="-1" aria-hidden="true"/);
  assert.match(html, /Updated 12 seconds ago/);
  const single = String(tickerRail(buildTicker({ wnbaGames: [wnba('2', 'pre')], now: NOW })));
  assert.match(single, /tk-scroll-in tk-static/, 'one or two items do not scroll');
  assert.doesNotMatch(single, /aria-hidden="true"/);
});
