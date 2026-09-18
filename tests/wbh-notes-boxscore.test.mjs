// The box-score extraction pipeline is Python (pdfplumber needs a real PDF parser), so its unit
// tests live beside it. This wrapper keeps them inside `npm test`: one node test that runs the
// Python suite and fails loudly if it fails, or skips with a clear reason when Python is absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const suite = path.join(here, '..', 'scripts', 'wbh', 'test_notes_boxscore.py');

function python() {
  for (const candidate of ['python', 'python3', 'py']) {
    const probe = spawnSync(candidate, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.trim() === '3') return candidate;
  }
  return null;
}

test('wbh game-notes box-score pipeline: python suite passes', (t) => {
  const bin = python();
  if (!bin) return t.skip('python 3 is not available on this machine');

  const run = spawnSync(bin, [suite], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  const output = `${run.stdout || ''}${run.stderr || ''}`;
  if (run.status !== 0 && /ModuleNotFoundError: No module named 'pdfplumber'/.test(output)) {
    return t.skip('pdfplumber is not installed; run pip install pdfplumber');
  }
  assert.equal(run.status, 0, `python box-score tests failed:\n${output}`);
  assert.match(output, /Ran \d+ tests/);
  assert.match(output, /\bOK\b/);
});
