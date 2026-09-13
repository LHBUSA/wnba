import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const cards = fs.readFileSync(new URL('../src/ui/articles.js', import.meta.url), 'utf8');
const article = fs.readFileSync(new URL('../src/pages/article.js', import.meta.url), 'utf8');

test('editorial story cards do not render sportsbook market chips', () => {
  assert.doesNotMatch(cards, /marketChip\s*\(/);
  assert.doesNotMatch(cards, /badge market/);
});

test('article bettor module does not advertise an absent PropBetEdge model', () => {
  assert.doesNotMatch(article, /PropBetEdge model:\s*not published/i);
  assert.match(article, /marketStrip\(/); // market context still belongs inside the article itself
});
