// Runs the PowerShell regression test for the remote proof runner's result parser
// (supabase/proofs/ProofResult.ps1). Skipped where pwsh is not installed (e.g. the Vercel Linux build).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;

test('remote proof runner parses escaped Supabase error envelopes', { skip: !hasPwsh && 'pwsh not installed' }, () => {
  const r = spawnSync('pwsh', ['-NoProfile', '-File', 'supabase/proofs/test-proof-result-parser.ps1'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /PASS double-escaped supabase envelope \(29 rows/);
  assert.match(r.stdout, /parser tests: all passed/);
});
