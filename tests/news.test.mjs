// Newsroom editorial rules: relevance gate, entity linking, cross-publisher dedupe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDictionary, linkEntities, relevance, clusterItems, storyType } from '../workers/wnba-news/src/editorial.js';
import { parseRss, canonicalUrl } from '../workers/wnba-news/src/parse.js';
import { resultStory } from '../workers/wnba-news/src/pbe-desk.js';

const dict = buildDictionary({
  players: [
    { athlete_id: '4420318', name: 'Ezi Magbegor', team_id: '14' },
    { athlete_id: '4433402', name: 'Angel Reese', team_id: '20' },
    { athlete_id: '1', name: 'Azzi Fudd', team_id: '3' }
  ],
  teams: [
    { team_id: '14', name: 'Seattle Storm', short_name: 'Storm' },
    { team_id: '20', name: 'Atlanta Dream', short_name: 'Dream' },
    { team_id: '3', name: 'Dallas Wings', short_name: 'Wings' }
  ]
});
const mixed = { wnba_scope: 'mixed_filter_required' };
const official = { wnba_scope: 'wnba_only' };

test('off-sport item inside a "WNBA" feed is rejected', () => {
  const it = { headline: 'Seahawks edge Patriots in Super Bowl rematch, but Sam Darnold injured', summary: '' };
  assert.equal(relevance(it, linkEntities(it, dict), mixed).accept, false);
});

test('international item naming WNBA players without consequence is rejected', () => {
  const it = { headline: 'Team USA scores 108 in rout of Hungary to reach FIBA semis', summary: 'Angel Reese had 12.' };
  assert.equal(relevance(it, linkEntities(it, dict), mixed).accept, false);
});

test('injury to a rostered player is accepted and typed', () => {
  const it = { headline: "Storm's Ezi Magbegor suffers torn ACL at World Cup", summary: '' };
  const ents = linkEntities(it, dict);
  const r = relevance(it, ents, mixed);
  assert.equal(r.accept, true);
  assert.equal(r.type, 'injury');
  assert.ok(ents.some((e) => e.type === 'player' && e.id === '4420318'));
});

test('bare nickname links a team only alongside a rostered teammate', () => {
  const withMate = linkEntities({ headline: 'Without Azzi Fudd, what’s next for the Wings?', summary: '' }, dict);
  assert.ok(withMate.some((e) => e.type === 'team' && e.id === '3' && e.method.startsWith('nickname_with_rostered_player')));
  const alone = linkEntities({ headline: 'Chicago Wings of the air show', summary: '' }, dict);
  assert.ok(!alone.some((e) => e.type === 'team'));
});

test('publisher tags link entities', () => {
  const it = { headline: 'Angel Reese says the Defensive Player of the Year resides in Atlanta', summary: '', tags: ['Atlanta Dream', 'WNBA'] };
  const ents = linkEntities(it, dict);
  assert.ok(ents.some((e) => e.type === 'team' && e.id === '20'));
  assert.equal(relevance(it, ents, mixed).accept, true);
});

test('official WNBA source is in scope', () => {
  const it = { headline: 'WNBA Commissioner Cathy Engelbert to Retire at the End of 2026', summary: '' };
  assert.equal(relevance(it, linkEntities(it, dict), official).accept, true);
  assert.equal(storyType(it.headline), 'league');
});

test('dedupe merges across publishers, never within one publisher', () => {
  const mk = (id, src, h, t) => ({ item_id: id, source_id: src, headline: h, published_at: t, entities: [], story_type: 'injury', priority: 3 });
  const clusters = clusterItems([
    mk('a', 'espn_wnba', "Storm's Ezi Magbegor suffers torn ACL at women's FIBA World Cup", '2026-09-10T19:33:00Z'),
    mk('b', 'cbs_wnba', 'Ezi Magbegor tears ACL at World Cup, out for remainder of WNBA season', '2026-09-10T19:58:00Z'),
    mk('c', 'espn_wnba', "2026 FIBA Women's World Cup: Team USA and quarterfinal preview", '2026-09-08T10:00:00Z'),
    mk('d', 'espn_wnba', "2026 FIBA Women's World Cup: Team USA and semifinal preview", '2026-09-10T10:00:00Z')
  ].map((x) => ({ ...x, entities: x.item_id < 'c' ? [{ type: 'player', id: '4420318' }] : [] })));
  const byMember = Object.fromEntries(clusters.flatMap((c) => c.members.map((m) => [m, c.cluster_id])));
  assert.equal(byMember.a, byMember.b);
  assert.notEqual(byMember.c, byMember.d);
});

test('RSS parsing keeps headline/link/summary only, canonical URLs drop tracking', () => {
  const items = parseRss('<rss><channel><item><title><![CDATA[Fever&#8217;s win]]></title><link>https://x.com/a?utm_source=rss</link><description>&lt;p&gt;Hi&lt;/p&gt;</description><pubDate>Thu, 10 Sep 2026 21:14:14 +0000</pubDate><category>WNBA</category></item></channel></rss>');
  assert.equal(items[0].headline, 'Fever’s win');
  assert.equal(items[0].summary, 'Hi');
  assert.equal(canonicalUrl(items[0].url), 'https://x.com/a');
  assert.deepEqual(items[0].tags, ['WNBA']);
});

test('quiet final (no notable line, no OT, no comeback) produces no Desk story', async () => {
  const live = {
    game: { game_id: '1', status: { state: 'post', completed: true }, start_utc: '2026-08-30T00:00:00Z', home: { team_id: 'h', name: 'H', short_name: 'H', abbr: 'H', score: 80, winner: true, linescores: [20, 20, 20, 20] }, away: { team_id: 'a', name: 'A', short_name: 'A', abbr: 'A', score: 70, winner: false, linescores: [20, 20, 15, 15] } },
    box: { players: [{ athlete_id: 'p', name: 'P', team_id: 'h', pts: 20, reb: 5, ast: 3, min: 30 }] },
    derived: { lead: { largest_lead: { home: { margin: 12 }, away: { margin: 3 } }, lead_changes: 1, ties: 0 } }
  };
  assert.equal(await resultStory(live), null);
});

// ---------------------------------------------------------------- publication gate (ported from UFC)
import { validateArticle } from '../workers/wnba-news/src/gate.js';

const baseArticle = () => ({
  kind: 'injury',
  headline: 'Ezi Magbegor listed out for the Storm: what changes',
  deck: 'The Seattle Storm are without a starter who averaged 6.9 points this season.',
  body: [Array.from({ length: 30 }, () => 'context').join(' ') + ' She averaged 6.9 points in 20.4 minutes.'],
  primary_subject: 'Ezi Magbegor',
  facts: { season: { pts: 6.9, min: 20.4 } },
  evidence: [{ kind: 'publisher_report', publisher: 'ESPN', headline: "Storm's Ezi Magbegor suffers torn ACL at women's FIBA World Cup" }],
  bettor_angle: { summary: 'Her minutes have to go somewhere in a thin rotation, which is where prop lines move first.', supporting: [], against: ['Feed status can change.'], unknown: ['Official lineup.'] },
  market_watch: { text: [], market: null }
});

test('gate passes a grounded article', () => {
  const g = validateArticle(baseArticle(), { minWords: 20 });
  assert.equal(g.ok, true, g.failures.join('; '));
});

test('gate holds an invented number (class C)', () => {
  const a = baseArticle();
  a.body[0] += ' She was averaging 31.5 points before the injury.';
  const g = validateArticle(a, { minWords: 20 });
  assert.equal(g.ok, false);
  assert.ok(g.failures.some((f) => f.includes('class C number "31.5"')));
});

test('gate allows only a named publisher headline as a quotation', () => {
  const ok = baseArticle();
  ok.body.push('ESPN reported it under the headline “Storm\'s Ezi Magbegor suffers torn ACL at women\'s FIBA World Cup”.'.replace("\'", "'"));
  ok.body[1] = 'ESPN reported it under the headline “Storm' + "'" + 's Ezi Magbegor suffers torn ACL at women' + "'" + 's FIBA World Cup”.';
  assert.equal(validateArticle(ok, { minWords: 20 }).ok, true);
  const bad = baseArticle();
  bad.body.push('Her coach said “we will miss her badly”.');
  assert.ok(validateArticle(bad, { minWords: 20 }).failures.some((f) => f.startsWith('quotation is not a cited publisher headline')));
});

test('gate rejects market language without a stored market, and any model claim', () => {
  const a = baseArticle();
  a.body.push('The Storm are now 6-point underdogs.');
  assert.ok(validateArticle(a, { minWords: 20 }).failures.includes('price or market-position language without a stored market'));
  const b = baseArticle();
  b.body.push('Our model projects a close game.');
  assert.ok(validateArticle(b, { minWords: 20 }).failures.some((f) => f.startsWith('model claim')));
});

test('gate requires a counter-case and an unknown', () => {
  const a = baseArticle();
  a.bettor_angle.against = [];
  assert.ok(validateArticle(a, { minWords: 20 }).failures.includes('bettor_angle needs at least one counter-case'));
});
