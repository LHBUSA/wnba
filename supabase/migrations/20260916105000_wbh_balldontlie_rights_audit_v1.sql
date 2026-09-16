-- Women's Basketball History — BALLDONTLIE rights audit v1
-- Reviewed 2026-09-16 against Terms last updated 2026-08-04.
-- The terms broadly permit storage, databases, redistribution and lawful wagering uses, but the
-- controlling Section 6 also prohibits products/services that compete with BALLDONTLIE. PropBetEdge
-- overlaps sports-data / analytics use cases, so we fail closed until that scope is clarified.

begin;

insert into public.wbh_sources (
  source_id, display_name, publisher, homepage_url,
  rights_state, rights_basis, terms_url, terms_quote, terms_reviewed_at, terms_reviewed_by,
  commercial_use, redistribution, database_build, gambling_use,
  raw_storage_allowed, attribution_required,
  historical_depth, capabilities, notes, review_due
) values (
  'balldontlie',
  'BALLDONTLIE Sports API',
  'BALLDONTLIE LLC',
  'https://www.balldontlie.io/',
  'unresolved',
  'terms_of_use',
  'https://www.balldontlie.io/terms.html',
  'You may not use Data to create or operate products or services that compete with us.',
  '2026-09-16T10:37:00Z',
  'ChatGPT web audit on owner-delegated WBH source review',
  'permitted',
  'permitted',
  'permitted',
  'permitted',
  false,
  false,
  jsonb_build_object('wnba', jsonb_build_object('documented_season_filter', true, 'player_game_stats', true, 'player_season_stats', true)),
  array['teams','players','games','box_score','player_season_totals','standings','play_by_play'],
  'Terms Section 6 expressly permits use/copy/cache/store/archive/modify/combine/analyze/publish/distribute/sublicense/database creation and lawful wagering products, but the same controlling section prohibits competing products/services and resale of original unmodified Data. Because PropBetEdge is a sports-data/analytics product, canonical WBH ingestion remains blocked pending written clarification or owner/legal acceptance of that competition clause.',
  date '2026-10-16'
)
on conflict (source_id) do nothing;

commit;
