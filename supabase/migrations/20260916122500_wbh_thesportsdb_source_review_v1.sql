-- Women's Basketball History — TheSportsDB source-rights review v1
--
-- TheSportsDB is the cleanest candidate found for 2024 WNBA schedule/results coverage, but this
-- migration deliberately keeps it fail-closed. Canonical ingestion remains impossible until a
-- production-tier subscription/key is present and the remaining gambling/database-use questions
-- are explicitly reviewed. Only official API endpoints may be used; the website must not be scraped.

begin;

insert into public.wbh_sources (
  source_id, display_name, publisher, homepage_url, rights_state, rights_basis, license_id, license_url,
  terms_url, terms_quote, terms_reviewed_at, terms_reviewed_by,
  commercial_use, redistribution, database_build, gambling_use, raw_storage_allowed,
  attribution_required, attribution_text, capabilities, historical_depth, review_due, notes
) values (
  'thesportsdb',
  'TheSportsDB API',
  'TheDataDB Ltd',
  'https://www.thesportsdb.com',
  'unresolved',
  'terms_of_use',
  null,
  null,
  'https://www.thesportsdb.com/docs_terms_of_use.php',
  'You can scrape, copy and modify any content returned from the API, as long as you use the official end points.',
  now(),
  'chatgpt-rights-review-2026-09-16',
  'separate_license',
  'permitted',
  'unknown',
  'unknown',
  false,
  true,
  'TheSportsDB',
  array['schedule', 'results', 'event_identity'],
  '{"wnba":{"league_id":4516,"season_2024_expected_events":263},"api_only":true}'::jsonb,
  date '2026-10-16',
  'Terms reviewed 2026-09-16. Official API content may be copied/modified; website scraping is forbidden. Free tier is framed for development. Paid API may be used to develop apps/services within rate limits. Production WBH remains blocked pending a paid production key plus explicit review of database-building and gambling-product use. No TheSportsDB bytes have been ingested into canonical WBH by this migration.'
)
on conflict (source_id) do update set
  display_name = excluded.display_name,
  publisher = excluded.publisher,
  homepage_url = excluded.homepage_url,
  rights_state = excluded.rights_state,
  rights_basis = excluded.rights_basis,
  license_id = excluded.license_id,
  license_url = excluded.license_url,
  terms_url = excluded.terms_url,
  terms_quote = excluded.terms_quote,
  terms_reviewed_at = excluded.terms_reviewed_at,
  terms_reviewed_by = excluded.terms_reviewed_by,
  commercial_use = excluded.commercial_use,
  redistribution = excluded.redistribution,
  database_build = excluded.database_build,
  gambling_use = excluded.gambling_use,
  raw_storage_allowed = excluded.raw_storage_allowed,
  attribution_required = excluded.attribution_required,
  attribution_text = excluded.attribution_text,
  capabilities = excluded.capabilities,
  historical_depth = excluded.historical_depth,
  review_due = excluded.review_due,
  notes = excluded.notes;

-- This is the acceptance condition for this migration: the source is registered but cannot write
-- canonical history. Any future approval must be a separate audited rights-state revision.
do $guard$
begin
  if (select rights_state from public.wbh_sources where source_id='thesportsdb') <> 'unresolved' then
    raise exception 'wbh: TheSportsDB must remain unresolved after source-review v1';
  end if;
end $guard$;

commit;
