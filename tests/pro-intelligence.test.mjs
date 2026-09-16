import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('./', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');

const features = read('../src/data/pro-features.js');
const routes = read('../src/lib/routes.js');
const router = read('../src/lib/router.js');
const proApi = read('../workers/wnba-api/src/pro-intelligence.js');
const premiumEntry = read('../workers/wnba-api/src/index-premium.js');
const propEdgeApi = read('../workers/wnba-api/src/prop-edge.js');
const propEdgeWorker = read('../workers/wnba-prop-edge/src/index.js');
const propEdgeWrangler = read('../workers/wnba-prop-edge/wrangler.toml');
const propsPage = read('../src/pages/props.js');
const brief = read('../src/views/daily-brief.js');
const timeline = read('../src/pages/edge-timeline.js');
const rotation = read('../src/pages/rotation-impact.js');
const scenarios = read('../src/pages/scenario-lab.js');
const watchlist = read('../src/pages/watchlist.js');

test('WNBA intelligence suite exposes exactly one free feature and five Pro features', () => {
  assert.match(features, /id: 'daily-brief'[\s\S]*tier: 'free'/);
  for (const id of ['edge-timeline', 'prop-edge', 'rotation-impact', 'scenario-lab', 'watchlist']) {
    assert.match(features, new RegExp(`id: '${id}'[\\s\\S]*tier: 'pro'`));
  }
  assert.equal((features.match(/tier: 'free'/g) || []).length, 1);
  assert.equal((features.match(/tier: 'pro'/g) || []).length, 5);
});

test('dedicated intelligence pages plus Prop Edge on Props are first-class client surfaces', () => {
  for (const route of ['/brief', '/edge-timeline', '/rotation-impact', '/scenario-lab', '/watchlist', '/props']) {
    assert.ok(routes.includes(route), `missing route ${route}`);
  }
  for (const page of ['daily-brief', 'edge-timeline', 'rotation-impact', 'scenario-lab', 'watchlist', 'props']) {
    assert.ok(router.includes(page), `missing page loader ${page}`);
  }
  assert.match(features, /href: '\/props#pbe-prop-edge'/);
  assert.match(propsPage, /propEdgeSection/);
});

test('free Daily Brief stops before proprietary prediction values', () => {
  assert.match(brief, /FREE · WNBA Intelligence/);
  assert.match(brief, /values remain Pro/);
  assert.match(brief, /without exposing paid model probabilities or Player Load values/);
  assert.doesNotMatch(brief, /pick_probability/);
});

test('Pro pages remain honest about their derived meaning', () => {
  assert.match(timeline, /append-only PBE prediction-observation ledger/i);
  assert.match(timeline, /will not fabricate/i);
  assert.match(rotation, /not projected minute gains/i);
  assert.match(scenarios, /not synthetic sims/i);
  assert.match(scenarios, /not separate independently simulated forecasts/i);
  assert.match(watchlist, /in-app monitoring/i);
  assert.match(watchlist, /does not claim email or push delivery/i);
});

test('premium intelligence APIs are server-entitlement gated', () => {
  assert.match(proApi, /resolveAccount/);
  assert.match(proApi, /account\.entitled/);
  assert.match(proApi, /wnba_pbe_prediction_observations/);
  assert.match(proApi, /pro-watch:v1:/);
  assert.match(propEdgeApi, /resolveAccount/);
  assert.match(propEdgeApi, /account\.entitled/);
  assert.ok(premiumEntry.includes('edge-timeline'));
  assert.ok(premiumEntry.includes('/v1/pro/watchlist'));
  assert.ok(premiumEntry.includes('/v1/pro/prop-edge'));
});

test('PBE Prop Edge is Cloudflare scheduled, market-separated and tracking-only before validation', () => {
  assert.match(propEdgeWrangler, /crons\s*=\s*\["\*\/5 \* \* \* \*"\]/);
  assert.match(propEdgeWorker, /mode: 'TRACKING_BETA'/);
  assert.match(propEdgeWorker, /official_record: false/);
  assert.match(propEdgeWorker, /model_uses_market: false/);
  assert.match(propEdgeWorker, /projection -> probability -> market comparison/);
  assert.match(propEdgeWorker, /props:v1:latest/);
  assert.match(propEdgeWorker, /archive:v1:index/);
  assert.doesNotMatch(propEdgeWorker, /ODDS_API_KEY/);
});
