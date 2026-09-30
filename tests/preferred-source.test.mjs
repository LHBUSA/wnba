import test from 'node:test';
import assert from 'node:assert/strict';
import { preferredSourceTarget, preferredSourceDeeplink, preferredSourceHtml } from '../src/ui/preferred-source.js';
import { shellHtml, SHELL_REV } from '../src/ui/shell.js';

const DEEPLINK = 'https://www.google.com/preferences/source?q=propbetedge.ai';

test('wnba.propbetedge.ai is not a Google-listed source: parent deeplink, no SDK', () => {
  assert.deepEqual(preferredSourceTarget('wnba.propbetedge.ai'), { source: 'propbetedge.ai', sdk: false });
  assert.equal(preferredSourceDeeplink(), DEEPLINK);
  for (const h of ['propbetedge.ai', 'mlb.propbetedge.ai', 'ufc.propbetedge.ai']) assert.equal(preferredSourceTarget(h).sdk, true, h);
});

test('footer carries our own control with the deeplink href and no Google auto-render hook', () => {
  const doc = String(shellHtml());
  assert.equal((doc.match(/data-pbe-preferred-source/g) || []).length, 1);
  assert.match(doc, /data-surface="footer" data-sport="wnba"/);
  assert.ok(doc.includes(`href="${DEEPLINK.replace('?', '?')}"`));
  assert.doesNotMatch(doc, /google-add-preferred-source-btn|publisher\.js/);
  assert.ok(SHELL_REV >= '2026-09-30.1', 'SHELL_REV moved so SSR chrome reconciles the new footer');
});

test('article CTA markup', () => {
  const a = String(preferredSourceHtml({ surface: 'article' }));
  assert.match(a, /Enjoy PropBetEdge reporting\?/);
  assert.match(a, /data-surface="article"/);
  assert.match(a, /Add PropBetEdge/);
});
