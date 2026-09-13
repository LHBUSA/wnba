import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const MEDIA_SOURCE = new URL('../workers/wnba-news/src/media-resolve.js', import.meta.url);

test('material news briefs stay on the approved single-subject media path', async () => {
  const src = await readFile(MEDIA_SOURCE, 'utf8');
  const single = src.match(/const SINGLE = new Set\(\[([^\]]+)\]\)/)?.[1] || '';
  assert.match(single, /['"]brief['"]/, 'brief stories must not fall through to the team-composition placeholder');
});
