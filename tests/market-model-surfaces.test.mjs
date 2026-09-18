// Two different PropBetEdge models, two independent states.
//
// The game prediction model (pbe-wnba-model-v1) is live on PBE Picks. A market fair-value model,
// which would price a sportsbook line, does not exist. Before this contract they shared one field
// called `pbe_model`, so a payload saying NOT_PUBLISHED read as though the published picks model
// were unpublished. These tests hold the two apart in both directions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { modelSurfaces, MARKET_MODEL_COPY, GAME_PREDICTION_MODEL_ID, normalizeOddsEvent, teamIndex } from '../workers/shared/market.js';

const teams = [
  { team_id: '20', name: 'Atlanta Dream' },
  { team_id: '19', name: 'Chicago Sky' }
];

const event = (bookmakers) => ({
  id: 'e'.repeat(32),
  commence_time: '2026-09-19T23:00:00Z',
  home_team: 'Atlanta Dream',
  away_team: 'Chicago Sky',
  bookmakers
});

const twoBooks = [
  { key: 'fanduel', title: 'FanDuel', last_update: 't', markets: [{ key: 'h2h', last_update: 't', outcomes: [
    { name: 'Atlanta Dream', price: -650 }, { name: 'Chicago Sky', price: 450 }] }] },
  { key: 'draftkings', title: 'DraftKings', last_update: 't', markets: [{ key: 'h2h', last_update: 't', outcomes: [
    { name: 'Atlanta Dream', price: -600 }, { name: 'Chicago Sky', price: 425 }] }] }
];

test('publishing game predictions never implies the market fair-value model is published', () => {
  const s = modelSurfaces({ gamePredictionsPublished: true, marketPricing: true });
  assert.equal(s.game_prediction_model.status, 'published');
  assert.equal(s.game_prediction_model.model_id, GAME_PREDICTION_MODEL_ID);
  assert.equal(s.market_fair_value_model.status, 'not_published',
    'the market model is a separate model and is not validated');
  assert.equal(s.market_edge.status, 'unavailable');
  assert.equal(s.market_edge.reason, 'market_fair_value_model_not_validated');
});

test('the market fair-value model stays unpublished whatever the game prediction state is', () => {
  for (const published of [true, false]) {
    const s = modelSurfaces({ gamePredictionsPublished: published, marketPricing: true });
    assert.equal(s.market_fair_value_model.status, 'not_published');
    assert.equal(s.market_edge.status, 'unavailable');
  }
});

test('game prediction state follows the publish flag and nothing else', () => {
  assert.equal(modelSurfaces({ gamePredictionsPublished: true }).game_prediction_model.status, 'published');
  assert.equal(modelSurfaces({ gamePredictionsPublished: false }).game_prediction_model.status, 'not_published');
  // market pricing must not move it in either direction
  assert.equal(modelSurfaces({ gamePredictionsPublished: true, marketPricing: false }).game_prediction_model.status, 'published');
  assert.equal(modelSurfaces({ gamePredictionsPublished: false, marketPricing: true }).game_prediction_model.status, 'not_published');
});

test('missing odds suppress the market comparison only, never the pick', () => {
  const withPricing = modelSurfaces({ gamePredictionsPublished: true, marketPricing: true });
  const withoutPricing = modelSurfaces({ gamePredictionsPublished: true, marketPricing: false });
  assert.equal(withoutPricing.game_prediction_model.status, 'published',
    'a game with no sportsbook line still has a published prediction');
  assert.equal(withoutPricing.market_edge.status, 'unavailable');
  assert.equal(withPricing.game_prediction_model.status, withoutPricing.game_prediction_model.status);
});

test('the edge reason names market pricing only once a market model exists', () => {
  // today the fair-value model is the binding constraint, so it is the reason even without pricing
  const s = modelSurfaces({ gamePredictionsPublished: true, marketPricing: false });
  assert.equal(s.market_edge.reason, 'market_fair_value_model_not_validated');
});

test('no payload carries the old ambiguous pbe_model field', () => {
  const normalized = normalizeOddsEvent(event(twoBooks), teamIndex(teams));
  assert.equal(normalized.pbe_model, undefined, 'the ambiguous field must be gone, not aliased');
  assert.equal(normalized.market_fair_value_model.status, 'not_published');
  assert.equal(normalized.market_edge.status, 'unavailable');
  assert.equal(normalized.game_prediction_model, undefined,
    'the market layer does not know the publish flag; routes attach that from env');
});

test('the market consensus is never labelled a model', () => {
  const normalized = normalizeOddsEvent(event(twoBooks), teamIndex(teams));
  assert.ok(normalized.moneyline.consensus.books >= 2);
  assert.equal(normalized.moneyline.consensus.model, undefined);
  assert.equal(normalized.market_fair_value_model.status, 'not_published',
    'a consensus across books is arithmetic on prices, not a PropBetEdge model');
});

test('the published copy states both halves in one line', () => {
  assert.match(MARKET_MODEL_COPY, /PBE game predictions are live/);
  assert.match(MARKET_MODEL_COPY, /fair-value and model-gap comparisons remain unavailable/);
  assert.match(MARKET_MODEL_COPY, /separate market model is validated/);
});
