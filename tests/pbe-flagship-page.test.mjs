import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flagshipPbeCard } from '../src/ui/pbe-flagship.js';
import { pbePicksPublicView } from '../src/views/pbe-picks-public.js';

const pageSource = readFileSync(new URL('../src/pages/pbe-picks.js', import.meta.url), 'utf8');
const publicSource = readFileSync(new URL('../src/views/pbe-picks-public.js', import.meta.url), 'utf8');

const fixture = {
  game: {
    game_id: '401999999',
    scheduled_tip_utc: '2026-09-17T23:30:00Z',
    away_team_id: '1',
    home_team_id: '2',
    away: { name: 'Away Stars', abbr: 'AWS' },
    home: { name: 'Home Force', abbr: 'HMF' }
  },
  phase: 'PRE_LOCK',
  call: 'PICK',
  pick_team_id: '2',
  p_away: 0.39,
  p_home: 0.61,
  pick_probability: 0.61,
  confidence: 'High',
  generated_at: '2026-09-16T14:00:00Z',
  lock_at: '2026-09-17T23:15:00Z',
  lock_policy: 'pbe-lock-v1',
  feature_hash: '0123456789abcdef0123456789abcdef',
  model: { model_id: 'pbe-wnba-model-v1' },
  market: {
    available: true,
    current: true,
    captured_at: '2026-09-16T13:59:00Z',
    book_count: 5,
    pick_side: 'home',
    pbe_edge_pts: 4.2,
    home: { consensus_moneyline: -125, implied_probability: 0.5556, devig_probability: 0.568 },
    away: { consensus_moneyline: 110, implied_probability: 0.4762, devig_probability: 0.432 }
  },
  reasoning: {
    supporting: [{ impact_pts: 3.1, text: '+4.2 schedule-adjusted net rating per 100 possessions' }],
    opposing: [{ impact_pts: -1.2, text: 'Opponent has home-court counterweight' }]
  }
};

test('public PBE landing sells the product without embedding protected prediction fields', () => {
  const html = String(pbePicksPublicView());
  assert.match(html, /Unlock WNBA Pro/);
  assert.match(html, /\$9\.99/);
  assert.match(html, /live track record/i);
  assert.match(html, /Market beside it/);
  assert.doesNotMatch(publicSource, /api\.|p_home|p_away|pick_probability|feature_hash/);
});

test('flagship PBE call opens into internal team, matchup, load and availability research', () => {
  const html = String(flagshipPbeCard(fixture));
  assert.match(html, /href="\/teams\/1"/);
  assert.match(html, /href="\/teams\/2"/);
  assert.match(html, /href="\/matchups\/401999999"/);
  assert.match(html, /href="\/player-load"/);
  assert.match(html, /href="\/injuries"/);
  assert.match(html, /Model-market gap/);
  assert.match(html, /Why PBE likes/);
  assert.match(html, /What pushes back/);
  assert.match(html, /Feature hash/);
});

test('PBE page builds a command center from model status, public track record and live protected calls', () => {
  assert.match(pageSource, /api\.pbeStatus\(\)/);
  assert.match(pageSource, /api\.trackRecord\(\)/);
  assert.match(pageSource, /PBE Command Center/);
  assert.match(pageSource, /Player Load Intelligence/);
  assert.match(pageSource, /flagshipPbeCard/);
  assert.match(pageSource, /Largest current model-market disagreement/);
});
