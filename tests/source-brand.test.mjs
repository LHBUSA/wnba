// Network source-brand standard (DATA · PropSports): customer surfaces and public JSON carry no upstream
// implementation branding; publisher reports, photo credits and the provenance registry pass through.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../scripts/guard-source-brand.mjs';
import { customerText, customerDoc } from '../workers/shared/customer-brand.js';
import { meta, json, SOURCES } from '../workers/shared/envelope.js';

test('source-brand guard: customer source and public serializers are clean', () => {
  assert.deepEqual(scan(), []);
});

test('newsroom prose and labels map to PropSports; sportsbooks stay', () => {
  assert.equal(customerText('A’ja Wilson out for the season, per ESPN’s injury feed: what the Aces lose'), 'A’ja Wilson out for the season, per the observed injury report: what the Aces lose');
  assert.equal(customerText('ESPN’s WNBA injury feed lists X as Out. This is ESPN’s status, not the league’s official injury report.'), 'The observed injury report lists X as Out. This is the provider status, not the league’s official injury report.');
  assert.equal(customerText('DraftKings’ line, as relayed by ESPN, had the Aces favored by 4.5.'), 'DraftKings’ line had the Aces favored by 4.5.');
  assert.equal(customerText('The Odds API (stored PropBetEdge snapshot)'), 'PropSports market snapshot');
  assert.equal(customerText('espn_injuries_feed via wnba-ingest change ledger'), 'PropSports injury feed');
  assert.equal(customerText('Best price at ESPN BET'), 'Best price at ESPN BET');
  assert.equal(customerText('ESPN lists Stephanie Talbot as Out (leg).'), 'The observed injury report lists Stephanie Talbot as Out (leg).');
  assert.equal(customerText('after an ESPN injury update for Marina Mabrey.'), 'after a provider injury update for Marina Mabrey.');
  const once = customerText('ESPN game log (2026 Regular Season)');
  assert.equal(customerText(once), once);
});

test('public doc: publisher reports, photo credits and identifiers untouched; upstream API links dropped', () => {
  const d = customerDoc({ evidence: [{ kind: 'publisher_report', publisher: 'ESPN', headline: 'ESPN reports X', url: 'https://www.espn.com/wnba/story/1' }, { source: 'ESPN WNBA injury feed', url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/injuries' }], photo: { credit: 'Photo: ESPN' }, pbp_source: 'espn_site' });
  assert.equal(d.evidence[0].publisher, 'ESPN');
  assert.equal(d.evidence[0].url, 'https://www.espn.com/wnba/story/1');
  assert.equal(d.evidence[1].source, 'PropSports injury feed');
  assert.equal(d.evidence[1].url, undefined);
  assert.equal(d.photo.credit, 'Photo: ESPN');
  assert.equal(d.pbp_source, 'espn_site');
});

test('envelope: customer meta.source is PropSports; /v1/sources registry is served unmapped', async () => {
  const m = meta({ service: 's', version: '1', route: '/v1/standings', freshness: 'CURRENT' });
  assert.deepEqual(m.source, { id: 'propsports', name: 'PropSports', authority: 'EXTERNAL_PROVIDER' });
  const body = await json({ ok: true, data: { method: 'Possessions from season team totals (ESPN).' }, meta: m }).json();
  assert.equal(body.data.method, 'Possessions from season team totals.');
  const reg = await json({ ok: true, data: { sources: [SOURCES.espn] }, meta: { route: '/v1/sources' } }).json();
  assert.equal(reg.data.sources[0].name, 'ESPN');
});
