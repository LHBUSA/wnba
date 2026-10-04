// Network P0 (canonical propbetedge-workers 64ca257): a matched, OPEN, traded Kalshi market whose book is one-sided at
// the $0 / $1 boundary keeps the full Market Pulse card — real Bid / Ask / Last, "—" for the missing side, no
// Mid-market — while the compact line / strip still need a valid midpoint. Production 99/1 shape in WNBA's vocabulary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kalshiCard, kalshiLine, kalshiStrip } from '../src/vendor/kalshi/kalshi-market-ui.js';

const URL_ = 'https://kalshi.com/markets/kxwnbagame/wnba-game/kxwnbagame-26oct04nyatl';
const o = (role, abbr, ticker, bid, ask, last, extra = {}) => ({ role, abbr, kalshi_name: abbr, contract: `${abbr} wins`, market_ticker: ticker, state: 'open', result: null, best_yes_bid_bp: bid, best_yes_ask_bp: ask, last_price_bp: last, mid_bp: null, volume: 2602928.95, open_interest: 1267498.06, spread_bp: null, displayable: false, renderable: true, one_sided: true, ...extra });
const entry = (outcomes, k = {}) => ({
  event: { sport: 'wnba', canonical_event_id: 'g1' },
  kalshi: { source: 'kalshi', market_url: URL_, event_ticker: 'KXWNBAGAME-26OCT04NYATL', state: 'open', freshness: 'live', age_seconds: 20, mid_available: false, book: 'one_sided', outcomes, ...k },
});
const oneSided = () => entry([o('away', 'NY', 'KXWNBAGAME-26OCT04NYATL-NY', 9900, null, 9900), o('home', 'ATL', 'KXWNBAGAME-26OCT04NYATL-ATL', null, 100, 100)]);

test('99/1 one-sided book keeps the full card; Bid/Ask/Last truthful; "—" for the missing side; no Mid-market; link kept', () => {
  const html = kalshiCard(oneSided(), { placement: 'test' });
  assert.ok(html.includes('Market Pulse') && html.includes(URL_));
  const panels = html.split('class="kx__panel"').slice(1);
  assert.equal(panels.length, 2);
  assert.match(panels[0], /<dt>Bid<\/dt><dd>99¢<\/dd>[\s\S]*<dt>Ask<\/dt><dd>—<\/dd>[\s\S]*<dt>Last<\/dt><dd>99¢<\/dd>/);
  assert.match(panels[1], /<dt>Bid<\/dt><dd>—<\/dd>[\s\S]*<dt>Ask<\/dt><dd>1¢<\/dd>[\s\S]*<dt>Last<\/dt><dd>1¢<\/dd>/);
  assert.ok(html.includes('Mid-market unavailable at this observation · one-sided book'));
  assert.ok(!/kx__pxl">Mid-market</.test(html) && !/99\.5¢|0\.5¢/.test(html));
});

test('compact line and strip stay absent without a valid mid', () => {
  assert.equal(kalshiLine(oneSided()), '');
  assert.ok(!String(kalshiStrip(oneSided(), {})).includes('kx__sp'));
});

test('an older API block without `renderable` still fails closed', () => {
  const old = oneSided();
  old.kalshi.outcomes = old.kalshi.outcomes.map(({ renderable, ...x }) => x);
  assert.equal(kalshiCard(old, { placement: 't' }), '');
});

test('settled behaviour unchanged', () => {
  const s = entry([o('away', 'NY', 'T1', null, null, 9900, { state: 'settled', result: 'yes', renderable: false, one_sided: false }), o('home', 'ATL', 'T2', null, null, 100, { state: 'settled', result: 'no', renderable: false, one_sided: false })], { state: 'settled', freshness: 'settled', book: 'two_sided' });
  const html = kalshiCard(s, { placement: 't' });
  assert.ok(html.includes('Settled YES') && html.includes('Settled NO') && !html.includes('Mid-market unavailable'));
});
