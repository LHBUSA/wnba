// The box-score extraction pipeline is Python (pdfplumber needs a real PDF parser), so its unit
// tests live beside it. This wrapper keeps them inside `npm test`.
//
// It must skip cleanly wherever the toolchain is absent — notably the Vercel build image, which runs
// `npm run check` and has Python but no pdfplumber. An earlier version only recognised a bare
// ModuleNotFoundError, missed the friendlier "pdfplumber is required" exit the scripts actually
// print, and failed the build. Availability is now checked up front rather than inferred from the
// shape of a failure message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const wbh = path.join(here, '..', 'scripts', 'wbh');
const suites = ['test_notes_boxscore.py', 'test_notes_coverage.py'];

/** A python3 that can also import pdfplumber, or null. */
function runner() {
  for (const candidate of ['python', 'python3', 'py']) {
    const version = spawnSync(candidate, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
    if (version.status !== 0 || version.stdout.trim() !== '3') continue;
    const dep = spawnSync(candidate, ['-c', 'import pdfplumber'], { encoding: 'utf8' });
    if (dep.status === 0) return { bin: candidate, ready: true };
    return { bin: candidate, ready: false };
  }
  return { bin: null, ready: false };
}

const env = runner();

for (const suite of suites) {
  test(`wbh game-notes pipeline: ${suite} passes`, (t) => {
    if (!env.bin) return t.skip('python 3 is not available here');
    if (!env.ready) return t.skip('pdfplumber is not installed here; run pip install pdfplumber');

    const run = spawnSync(env.bin, [path.join(wbh, suite)], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    const output = `${run.stdout || ''}${run.stderr || ''}`;
    assert.equal(run.status, 0, `python tests failed (${suite}):\n${output}`);
    assert.match(output, /Ran \d+ tests/);
    assert.match(output, /\bOK\b/);
  });
}
