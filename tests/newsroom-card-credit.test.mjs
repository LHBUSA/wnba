import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { articleCard, articleRow } from '../src/ui/articles.js';
import { storyMedia } from '../src/ui/story-media.js';

const media = {
  layout: 'matchup',
  subjects: [
    {
      player_id: '1',
      name: 'Away Player',
      team_id: 'A',
      half: [{ src: '/media/a.webp', w: 640, h: 720 }],
      wide: [{ src: '/media/a-wide.webp', w: 1280, h: 720 }],
      square: '/media/a-square.webp',
      credit: {
        author: 'Away Photographer',
        license: 'CC BY-SA 4.0',
        license_url: 'https://creativecommons.org/licenses/by-sa/4.0',
        source_page: 'https://commons.wikimedia.org/wiki/File:away.jpg'
      }
    },
    {
      player_id: '2',
      name: 'Home Player',
      team_id: 'H',
      half: [{ src: '/media/h.webp', w: 640, h: 720 }],
      wide: [{ src: '/media/h-wide.webp', w: 1280, h: 720 }],
      square: '/media/h-square.webp',
      credit: {
        author: 'Home Photographer',
        license: 'CC BY-SA 2.0',
        license_url: 'https://creativecommons.org/licenses/by-sa/2.0',
        source_page: 'https://commons.wikimedia.org/wiki/File:home.jpg'
      }
    }
  ],
  teams: ['A', 'H'],
  caption: 'Pictured: Away Player and Home Player'
};

const card = {
  id: 'preview-1',
  slug: 'storm-at-aces-preview',
  kind: 'preview',
  category: 'Previews',
  headline: 'Storm at Aces preview',
  deck: 'Pregame intelligence.',
  entities: [],
  sources: ['PBE matchup research'],
  media,
  published_at: '2026-09-20T20:00:00Z'
};

test('newsroom cards and river rows do not print photo credits', () => {
  const cardHtml = String(articleCard(card));
  assert.doesNotMatch(cardHtml, /sm-credit|Photo:|Photographer|CC BY/);

  const rowHtml = String(articleRow(card));
  assert.doesNotMatch(rowHtml, /srow-credit|Photo:|Photographer|CC BY/);
});

test('full article media keeps author, license and source attribution', () => {
  const hero = String(storyMedia(media, { slot: 'hero', eager: true, credit: true }));
  assert.match(hero, /sm-credit/);
  assert.match(hero, /Away Photographer/);
  assert.match(hero, /Home Photographer/);
  assert.match(hero, /CC BY-SA 4\.0/);
  assert.match(hero, /commons\.wikimedia\.org/);

  const articleSrc = fs.readFileSync(new URL('../src/views/article.js', import.meta.url), 'utf8');
  assert.match(articleSrc, /storyMedia\(a\.media, \{ slot: 'hero', eager: true, credit: true \}\)/);
});
