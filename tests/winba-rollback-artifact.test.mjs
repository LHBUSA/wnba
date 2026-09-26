// WinBA 1.0.0 rollback artifact: the verifier accepts only the exact recorded bytes; the dry run never writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARTIFACT, verifyArtifact, restoreCommands } from '../scripts/ops/winba-rollback.mjs';

test('fingerprint is recorded and matches the ops doc', () => {
  assert.equal(ARTIFACT.sha256, '09c97653e5c33121f3234f2f132c64dae276b6f4e3a8164558ab499c8ba14b0f');
  assert.equal(ARTIFACT.version, 'winba/1.0.0');
  assert.equal(ARTIFACT.rows, 238);
  assert.ok(ARTIFACT.key.startsWith('ops:rollback:winba:v1:1.0.0:'));
  const doc = readFileSync(new URL('../docs/ops/WINBA_1.0.0_ROLLBACK.md', import.meta.url), 'utf8');
  for (const v of [ARTIFACT.sha256, ARTIFACT.key, ARTIFACT.generated_at, ARTIFACT.archive_signature]) assert.ok(doc.includes(v), v);
});

test('verifier rejects anything but the exact artifact (tampered, re-serialised, wrong version)', () => {
  const board = { version: 'winba/1.0.0', generated_at: ARTIFACT.generated_at, archive_signature: ARTIFACT.archive_signature, rows: Array.from({ length: 238 }, (_, i) => ({ athlete_id: String(i), score: 50 })) };
  const r = verifyArtifact(Buffer.from(JSON.stringify(board)));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.startsWith('sha256')));
  const wrong = verifyArtifact(Buffer.from(JSON.stringify({ ...board, version: 'winba/1.0.1' })));
  assert.ok(wrong.errors.some((e) => e.startsWith('version')));
  assert.equal(verifyArtifact(Buffer.from('not json')).ok, false);
});

test('restore is never automatic: the script only prints the restore commands; it executes only kv get', () => {
  const cmds = restoreCommands().join('\n');
  assert.match(cmds, /wrangler rollback b0713fbb/);
  assert.match(cmds, /--verify-file winba-1\.0\.0\.json/);
  const src = readFileSync(new URL('../scripts/ops/winba-rollback.mjs', import.meta.url), 'utf8');
  const execCalls = src.match(/execFileSync\([^\n]*/g) || [];
  assert.equal(execCalls.length, 1);
  assert.match(execCalls[0], /'kv', 'key', 'get'/);
  assert.doesNotMatch(execCalls[0], /'put'|'delete'/);
});
