import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const cards = read('../src/ui/articles.js');
const article = read('../src/pages/article.js');
const news = read('../src/pages/news.js');
const matchups = read('../src/pages/matchups.js');
const props = read('../src/pages/props.js');
const today = read('../src/pages/today.js');

test('editorial story cards do not render sportsbook market chips', () => {
  assert.doesNotMatch(cards, /marketChip\s*\(/);
  assert.doesNotMatch(cards, /badge market/);
});

test('article bettor module does not advertise an absent PropBetEdge model', () => {
  assert.doesNotMatch(article, /PropBetEdge model:\s*not published/i);
  assert.match(article, /marketStrip\(/); // grounded market context still belongs inside the article itself
});

test('public WNBA surfaces describe available market data instead of missing-model placeholders', () => {
  for (const [name, src] of Object.entries({ news, matchups, props, today })) {
    assert.doesNotMatch(src, /PBE fair value[\s\S]{0,80}not published/i, name);
    assert.doesNotMatch(src, /No PropBetEdge model price is published/i, name);
    assert.doesNotMatch(src, /No WNBA model is published/i, name);
  }
});
