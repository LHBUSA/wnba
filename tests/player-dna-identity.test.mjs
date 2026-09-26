// Player DNA identity: every doc in the DNA set carries a name. A player whose only box rows are
// played-with-`min: null` (not appearances, but in the set via sample.excluded_no_minutes — contract,
// docs/WNBA_PLAYER_DNA_V1.md) takes her identity from her latest such box row. Regression for
// 4790263 (Iliana Rupert), who had name null in /v1/dna/index. Display only: no score moves.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlayerDna } from '../workers/shared/player-dna.js';
import { dnaIndexView } from '../workers/shared/player-dna-views.js';
import { FRANCHISES, makeDoc, playerLine, league } from './fixtures/player-dna-league.mjs';

const DOCS = league();
const LAST_TIP = Math.max(...DOCS.map((d) => Date.parse(d.summary.game.start_utc)));
const AS_OF = new Date(LAST_TIP + 86400000 * 3).toISOString();
const OPTS = { franchiseTeamIds: FRANCHISES };
const day = (n) => new Date(LAST_TIP + 86400000 * n).toISOString();

const inactive = (id, team, name, extra = {}) => ({ athlete_id: id, name, team_id: team, position: 'C', starter: false, dnp: false, active: false, min: null, pts: 0, ...extra });
const withRows = (docs, extra) => [...docs, ...extra];

test('a player with only min:null rows is in the DNA set with her box-score name, team and position', () => {
  const extra = [
    makeDoc({ id: 'x1', tip: day(1), home: '1', away: '2', rows: [playerLine('11026', '1', 900, 0), playerLine('21026', '2', 900, 0), inactive('999001', '1', 'Only Inactive')] }),
    makeDoc({ id: 'x2', tip: day(2), home: '3', away: '1', rows: [playerLine('31026', '3', 901, 0), playerLine('11026', '1', 901, 0), inactive('999001', '1', 'Only Inactive')] })
  ];
  const out = buildPlayerDna(withRows(DOCS, extra), { asOf: AS_OF, ...OPTS });
  const p = out.players['999001'];
  assert.ok(p, 'in the DNA set (excluded_no_minutes > 0)');
  assert.equal(p.name, 'Only Inactive');
  assert.equal(p.team_id, '1');
  assert.equal(p.position, 'C');
  assert.equal(p.scopes.season.calculated, false, 'still no calculated scope');
  const idx = dnaIndexView(out, { teams: {}, capturedAt: 'x', archiveSignature: 'x' });
  assert.equal(idx.players.find((r) => r.id === '999001').name, 'Only Inactive');
  assert.deepEqual(idx.players.filter((r) => !r.name || !String(r.name).trim()), [], 'no blank names in the index');
});

test('an appearance always owns identity; a later min:null row never overrides it; no other field moves', () => {
  const base = buildPlayerDna(DOCS, { asOf: AS_OF, ...OPTS });
  const someone = Object.values(base.players).find((p) => p.scopes.season.calculated);
  const later = makeDoc({ id: 'x3', tip: day(1), home: '4', away: '2', rows: [playerLine('41026', '4', 902, 0), playerLine('21026', '2', 902, 0), inactive(someone.athlete_id, '4', 'Renamed Elsewhere')] });
  const out = buildPlayerDna(withRows(DOCS, [later]), { asOf: AS_OF, ...OPTS });
  assert.equal(out.players[someone.athlete_id].name, someone.name);
  assert.equal(out.players[someone.athlete_id].team_id, someone.team_id);
  // fixture players' names/teams unchanged by the identity fallback
  for (const [id, p] of Object.entries(base.players)) {
    assert.ok(p.name && String(p.name).trim(), `${id} has a name`);
  }
});
