import test from 'node:test';
import assert from 'node:assert/strict';

import { pageGraph, siteEntities } from '../src/seo/jsonld.js';
import { routeMeta } from '../src/seo/meta.js';

const images = (node, out = []) => {
  if (Array.isArray(node)) node.forEach((n) => images(n, out));
  else if (node && typeof node === 'object') {
    if (node['@type'] === 'ImageObject') out.push(node);
    Object.values(node).forEach((v) => images(v, out));
  }
  return out;
};

const credit = (author, license, ver) => ({
  author, license, license_url: `https://creativecommons.org/licenses/by-sa/${ver}`,
  source_page: `https://commons.wikimedia.org/wiki/File:${author.replace(/\W+/g, '_')}.jpg`,
});
const stewart = { player_id: '2998928', name: 'Breanna Stewart', og: '/media/news/players/2998928/og.jpg', wide: [{ src: '/media/news/players/2998928/wide-640.webp', w: 640, h: 360 }], credit: credit('BDZ Sports', 'CC BY-SA 4.0', '4.0') };
const howard = { player_id: '4398674', name: 'Rhyne Howard', og: '/media/news/players/4398674/og.jpg', wide: [{ src: '/media/news/players/4398674/wide-640.webp', w: 640, h: 360 }], credit: credit('Gamecock Central', 'CC BY-SA 2.0', '2.0') };
const article = {
  slug: 'dream-liberty-8d2a65', kind: 'preview', headline: 'Liberty at Dream', deck: 'd', body: ['b'],
  first_published_at: '2026-10-01T12:00:00Z', entities: [],
  media: { layout: 'matchup', caption: 'Pictured: Breanna Stewart (NY) and Rhyne Howard (ATL)', og: howard.og, subjects: [stewart, howard] },
};

test('logos are PropBetEdge art', () => {
  for (const node of images(siteEntities())) {
    assert.deepEqual(node.creator, { '@type': 'Organization', name: 'PropBetEdge' });
    assert.equal(node.copyrightNotice, '© 2026 PropBetEdge');
  }
});

test('article: the card credits the photo it is built on; the crop credits its photographer', () => {
  const meta = routeMeta('article', { path: `/news/${article.slug}`, data: article });
  const nodes = images(pageGraph('article', meta, { article }));
  const cards = nodes.filter((n) => n.url.includes('/og/news/'));
  assert.ok(cards.length >= 2);
  for (const card of cards) {
    assert.equal(card.creator.name, 'PropBetEdge');
    assert.equal(card.copyrightNotice, '© 2026 PropBetEdge. Photo: Gamecock Central / CC BY-SA 2.0');
    assert.equal(card.license, 'https://creativecommons.org/licenses/by-sa/2.0');
  }
  // No conflicting duplicates: every node for the same URL carries identical rights.
  const byUrl = new Map();
  for (const n of nodes) {
    const key = JSON.stringify([n.creator, n.copyrightNotice, n.license]);
    if (byUrl.has(n.url)) assert.equal(byUrl.get(n.url), key, n.url);
    byUrl.set(n.url, key);
  }
  const crop = nodes.find((n) => n.url.endsWith('/2998928/wide-640.webp'));
  assert.deepEqual(crop.creator, { '@type': 'Organization', name: 'BDZ Sports' });
  assert.equal(crop.copyrightNotice, 'BDZ Sports / CC BY-SA 4.0');
  assert.equal(crop.caption, 'Pictured: Breanna Stewart');
  assert.equal(crop.acquireLicensePage, stewart.credit.source_page);
});

test('text-only article card is PropBetEdge art; uncredited photo is held', () => {
  const plain = { ...article, media: null };
  const meta = routeMeta('article', { path: `/news/${plain.slug}`, data: plain });
  for (const n of images(pageGraph('article', meta, { article: plain })).filter((x) => x.url.includes('/og/news/'))) {
    assert.equal(n.copyrightNotice, '© 2026 PropBetEdge');
  }
  const uncredited = { ...article, media: { ...article.media, subjects: [{ ...howard, credit: null }] } };
  for (const n of images(pageGraph('article', meta, { article: uncredited })).filter((x) => x.url.includes('/og/news/'))) {
    assert.equal(n.creator, undefined);
    assert.equal(n.copyrightNotice, undefined);
  }
});

test('player: Commons portrait credited from its attribution; team-mark card held', () => {
  const lp = { provider: 'commons', rights: 'licensed', portrait: '/media/players/2998928/portrait.webp', width: 308, height: 385, attribution: 'Photo: Lorie Shaull from St Paul, United States / CC BY-SA 2.0 via Wikimedia Commons (cropped)', license: 'CC BY-SA 2.0', license_url: 'https://creativecommons.org/licenses/by-sa/2.0', source_page: 'https://commons.wikimedia.org/wiki/File:X.jpg' };
  const data = { player: { athlete_id: '2998928', name: 'Breanna Stewart', team: { team_id: '9', name: 'New York Liberty' } }, photo: { sources: [{ provider: 'espn', rights: 'external_editorial' }, lp], licensed: lp } };
  const meta = routeMeta('player', { path: '/players/2998928', data });
  const nodes = images(pageGraph('player', meta, data));
  const portrait = nodes.find((n) => n.url.endsWith('/portrait.webp'));
  assert.deepEqual(portrait.creator, { '@type': 'Person', name: 'Lorie Shaull from St Paul, United States' });
  assert.equal(portrait.copyrightNotice, 'Lorie Shaull from St Paul, United States / CC BY-SA 2.0');
  for (const card of nodes.filter((n) => n.url.includes('/og/players/'))) assert.match(card.copyrightNotice, /^© 2026 PropBetEdge\. Photo: Lorie Shaull/);

  const noPhoto = { ...data, photo: { sources: [{ provider: 'espn', rights: 'external_editorial', portrait: 'https://a.espncdn.com/x.png' }] } };
  for (const card of images(pageGraph('player', meta, noPhoto)).filter((n) => n.url.includes('/og/players/'))) {
    assert.equal(card.creator, undefined);
    assert.equal(card.copyrightNotice, undefined);
  }
});

test('team: card and team logo carry no PropBetEdge claim', () => {
  const data = { team: { team_id: '9', name: 'New York Liberty' }, roster: [] };
  const meta = routeMeta('team', { path: '/teams/9', data });
  for (const n of images(pageGraph('team', meta, data)).filter((x) => !x.url.includes('propbetedge-logo'))) {
    assert.equal(n.copyrightNotice, undefined);
    assert.equal(n.creator, undefined);
  }
});

test('page cards and the default card are PropBetEdge art', () => {
  const meta = routeMeta('standings', { path: '/standings' });
  const nodes = images(pageGraph('standings', meta, {}));
  assert.ok(nodes.length >= 3);
  for (const n of nodes) assert.equal(n.copyrightNotice, '© 2026 PropBetEdge');
});
