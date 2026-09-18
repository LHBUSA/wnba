-- Women's Basketball History — WNBA 1997 structural spine
--
-- The inaugural season currently has nothing in the database: no edition, no teams, no games. This
-- migration lays the structure that 1997 results will later attach to. It adds NO games and claims
-- no game facts.
--
-- Source: Wikidata (CC0, rights_state approved_commercial). Every fact below is a claim read from a
-- specific item, and the item id is recorded as an alias in wbh_entity_source_ids so the assertion
-- can be re-checked:
--   Q1517815  1997 WNBA season   P580 1997-06-21, P582 1997-08-30, P1132 8 participants,
--                                P1346 winner = Q1479748 (Houston Comets)
--   Q1067358  Charlotte Sting    P571 1997, P576 2007
--   Q536458   Cleveland Rockers  P571 1997, P576 2003
--   Q1479748  Houston Comets     P571 1997, P576 2008
--   Q1541588  Sacramento Monarchs P571 1997, P576 2009
--   Q1812243  Utah Starzz        P571 1997, P1366 replaced by Q1472697 (San Antonio Stars),
--                                which in turn P1366 Q42333021 (Las Vegas Aces)
--   Q974705 New York Liberty, Q1329633 Los Angeles Sparks, Q1274643 Phoenix Mercury
--
-- Franchise identity, per the standing rule, is ours: the Utah Starzz are recorded as a team of the
-- existing Las Vegas Aces franchise with two dated lineage events, not as a separate franchise and
-- not by trusting a provider's reused team id. The four clubs that folded get their own franchises
-- with founding and folding events.
--
-- The 1997 champion (Houston) is recorded here only as a note on the ingestion run. It is a playoff
-- outcome, and outcomes are derived from games; it will be derived once 1997 games exist, not
-- asserted ahead of them.
--
-- Not claimed: venues, rosters, coaches, standings, schedule, any score. The edition is marked
-- completeness = 'absent' because it holds no games yet, which is the honest state.

begin;

do $seed$
declare
  v_run uuid;
  v_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_dataset constant text := 'wnba_1997_structural_spine_v1';
  v_capture constant text :=
    'Q1517815:1997-06-21..1997-08-30,participants=8,winner=Q1479748|' ||
    'Q1067358:1997-2007|Q536458:1997-2003|Q1479748:1997-2008|Q1541588:1997-2009|' ||
    'Q1812243:1997,replaced_by=Q1472697,replaced_by=Q42333021|Q974705|Q1329633|Q1274643';
  v_existing integer;
  v_teams integer;
  r record;
begin
  perform public.wbh_assert_ingestible('wikidata');

  select count(*) into v_existing
    from public.wbh_ingestion_runs where scope->>'dataset' = v_dataset and status = 'ok';
  if v_existing > 0 then return; end if;

  if exists (select 1 from public.wbh_competition_editions where edition_id = 'wnba_1997') then
    raise exception 'wbh: the 1997 edition already exists; refusing implicit merge' using errcode = 'P0001';
  end if;

  insert into public.wbh_source_documents
    (source_id, source_record_id, request_url, request_method, retrieved_at, http_status, content_sha256,
     content_type, byte_size, storage_state, transformation_version, notes)
  values
    ('wikidata', 'wikidata_wnba_1997_structural_facts', 'https://www.wikidata.org/wiki/Special:EntityData/Q1517815.json',
     'GET', v_now, 200, encode(extensions.digest(convert_to(v_capture, 'UTF8'), 'sha256'), 'hex'),
     'application/json', octet_length(v_capture), 'hash_only', 'wbh_structural_spine_v1',
     'Structural claims for the 1997 WNBA season and its eight clubs, read from Wikidata items (CC0). Item ids are recorded as aliases so each claim can be re-checked at source.')
  returning document_id into v_doc;

  insert into public.wbh_ingestion_runs
    (source_id, adapter_id, adapter_version, transformation_version, mode, as_of, scope)
  values
    ('wikidata', 'wikidata_structural_facts', '1.0.0', 'wbh_structural_spine_v1', 'ingest', v_now,
     jsonb_build_object('dataset', v_dataset, 'edition_id', 'wnba_1997',
                        'franchises_created', 4, 'teams_created', 5, 'team_editions', 8,
                        'games', 0,
                        'known_not_yet_ingested', jsonb_build_object(
                          'champion', 'Houston Comets (Wikidata Q1517815 P1346); to be DERIVED from games, not asserted',
                          'regular_season_games', 112,
                          'blocked_on', 'a rights-clean source printing 1997 game results')))
  returning run_id into v_run;

  -- ---------------------------------------------------------------- franchises that no longer exist
  insert into public.wbh_franchises
    (franchise_id, canonical_name, country_code, founded_year, defunct_year, notes,
     source_document_id, ingestion_run_id, transformation_version, derivation, confidence)
  values
    ('fr_charlotte_sting', 'Charlotte Sting', 'USA', 1997, 2007, 'Wikidata Q1067358',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_claim:P571,P576', 0.95),
    ('fr_cleveland_rockers', 'Cleveland Rockers', 'USA', 1997, 2003, 'Wikidata Q536458',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_claim:P571,P576', 0.95),
    ('fr_houston_comets', 'Houston Comets', 'USA', 1997, 2008, 'Wikidata Q1479748',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_claim:P571,P576', 0.95),
    ('fr_sacramento_monarchs', 'Sacramento Monarchs', 'USA', 1997, 2009, 'Wikidata Q1541588',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_claim:P571,P576', 0.95);

  -- ---------------------------------------------------------------- teams
  insert into public.wbh_teams
    (team_id, team_kind, franchise_id, country_code, canonical_name,
     source_document_id, ingestion_run_id, transformation_version, derivation, confidence)
  values
    ('tm_charlotte_sting', 'club', 'fr_charlotte_sting', 'USA', 'Charlotte Sting',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_item:Q1067358', 0.95),
    ('tm_cleveland_rockers', 'club', 'fr_cleveland_rockers', 'USA', 'Cleveland Rockers',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_item:Q536458', 0.95),
    ('tm_houston_comets', 'club', 'fr_houston_comets', 'USA', 'Houston Comets',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_item:Q1479748', 0.95),
    ('tm_sacramento_monarchs', 'club', 'fr_sacramento_monarchs', 'USA', 'Sacramento Monarchs',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_item:Q1541588', 0.95),
    -- the Starzz are the Aces franchise under its first name, not a separate club
    ('tm_utah_starzz', 'club', 'fr_las_vegas_aces', 'USA', 'Utah Starzz',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_item:Q1812243', 0.95);

  -- ---------------------------------------------------------------- lineage, with a citation per row
  insert into public.wbh_franchise_lineage_events
    (franchise_id, event_type, effective_season, from_name, to_name, citation_url, citation_note,
     source_document_id, ingestion_run_id, transformation_version, derivation, confidence)
  values
    ('fr_las_vegas_aces', 'relocated', 2003, 'Utah Starzz', 'San Antonio Silver Stars',
     'https://www.wikidata.org/wiki/Q1812243',
     'Wikidata Q1812243 (Utah Starzz) P1366 replaced by Q1472697 (San Antonio Stars).',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_claim:P1366', 0.95),
    ('fr_las_vegas_aces', 'relocated', 2018, 'San Antonio Stars', 'Las Vegas Aces',
     'https://www.wikidata.org/wiki/Q1472697',
     'Wikidata Q1472697 (San Antonio Stars) P1366 replaced by Q42333021 (Las Vegas Aces).',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_claim:P1366', 0.95),
    ('fr_charlotte_sting', 'founded', 1997, null, 'Charlotte Sting',
     'https://www.wikidata.org/wiki/Q1067358', 'Wikidata Q1067358 P571 inception 1997.',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_claim:P571', 0.95),
    ('fr_charlotte_sting', 'folded', 2007, 'Charlotte Sting', null,
     'https://www.wikidata.org/wiki/Q1067358', 'Wikidata Q1067358 P576 dissolved 2007.',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_claim:P576', 0.95),
    ('fr_cleveland_rockers', 'founded', 1997, null, 'Cleveland Rockers',
     'https://www.wikidata.org/wiki/Q536458', 'Wikidata Q536458 P571 inception 1997.',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_claim:P571', 0.95),
    ('fr_cleveland_rockers', 'folded', 2003, 'Cleveland Rockers', null,
     'https://www.wikidata.org/wiki/Q536458', 'Wikidata Q536458 P576 dissolved 2003.',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_claim:P576', 0.95),
    ('fr_houston_comets', 'founded', 1997, null, 'Houston Comets',
     'https://www.wikidata.org/wiki/Q1479748', 'Wikidata Q1479748 P571 inception 1997.',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_claim:P571', 0.95),
    ('fr_houston_comets', 'folded', 2008, 'Houston Comets', null,
     'https://www.wikidata.org/wiki/Q1479748', 'Wikidata Q1479748 P576 dissolved 2008.',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_claim:P576', 0.95),
    ('fr_sacramento_monarchs', 'founded', 1997, null, 'Sacramento Monarchs',
     'https://www.wikidata.org/wiki/Q1541588', 'Wikidata Q1541588 P571 inception 1997.',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_claim:P571', 0.95),
    ('fr_sacramento_monarchs', 'folded', 2009, 'Sacramento Monarchs', null,
     'https://www.wikidata.org/wiki/Q1541588', 'Wikidata Q1541588 P576 dissolved 2009.',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_claim:P576', 0.95);

  -- ---------------------------------------------------------------- edition and stages
  insert into public.wbh_competition_editions
    (edition_id, competition_id, season_label, season_year, start_date, end_date, team_count,
     status, completeness, source_document_id, ingestion_run_id, transformation_version, derivation, confidence)
  values
    ('wnba_1997', 'wnba', '1997', 1997, date '1997-06-21', date '1997-08-30', 8,
     'complete', 'absent', v_doc, v_run, 'wbh_structural_spine_v1',
     'wikidata_claim:Q1517815 P580,P582,P1132', 0.95);

  insert into public.wbh_stages
    (stage_id, edition_id, display_name, season_phase, ordinal,
     source_document_id, ingestion_run_id, transformation_version, derivation, confidence)
  values
    ('wnba_1997_regular_season', 'wnba_1997', 'Regular Season', 'regular_season', 1,
     v_doc, v_run, 'wbh_structural_spine_v1', 'structural', 1.0),
    ('wnba_1997_playoffs', 'wnba_1997', 'Playoffs', 'playoffs', 2,
     v_doc, v_run, 'wbh_structural_spine_v1', 'structural', 1.0);

  -- ---------------------------------------------------------------- the eight clubs of 1997
  insert into public.wbh_team_editions
    (team_edition_id, team_id, edition_id, display_name,
     source_document_id, ingestion_run_id, transformation_version, derivation, confidence)
  values
    ('te_charlotte_sting_1997', 'tm_charlotte_sting', 'wnba_1997', 'Charlotte Sting',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_item:Q1067358', 0.95),
    ('te_cleveland_rockers_1997', 'tm_cleveland_rockers', 'wnba_1997', 'Cleveland Rockers',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_item:Q536458', 0.95),
    ('te_houston_comets_1997', 'tm_houston_comets', 'wnba_1997', 'Houston Comets',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_item:Q1479748', 0.95),
    ('te_sacramento_monarchs_1997', 'tm_sacramento_monarchs', 'wnba_1997', 'Sacramento Monarchs',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_item:Q1541588', 0.95),
    ('te_utah_starzz_1997', 'tm_utah_starzz', 'wnba_1997', 'Utah Starzz',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_item:Q1812243', 0.95),
    ('te_new_york_liberty_1997', 'tm_new_york_liberty', 'wnba_1997', 'New York Liberty',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_item:Q974705', 0.95),
    ('te_los_angeles_sparks_1997', 'tm_los_angeles_sparks', 'wnba_1997', 'Los Angeles Sparks',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_item:Q1329633', 0.95),
    ('te_phoenix_mercury_1997', 'tm_phoenix_mercury', 'wnba_1997', 'Phoenix Mercury',
     v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_item:Q1274643', 0.95);

  -- ---------------------------------------------------------------- provider ids stay aliases
  insert into public.wbh_entity_source_ids
    (entity_type, entity_id, source_id, external_id, external_url, id_space, status, tier, confidence,
     method, evidence, source_document_id, ingestion_run_id, transformation_version, derivation)
  select x.entity_type, x.entity_id, 'wikidata', x.qid,
         'https://www.wikidata.org/wiki/' || x.qid, 'wikidata:item', 'linked', 'T3', 0.95,
         'wikidata_item_exact_name_league_era',
         jsonb_build_object('league', 'WNBA', 'season', 1997),
         v_doc, v_run, 'wbh_structural_spine_v1', 'wikidata_item_link'
    from (values
      ('team', 'tm_charlotte_sting', 'Q1067358'),
      ('team', 'tm_cleveland_rockers', 'Q536458'),
      ('team', 'tm_houston_comets', 'Q1479748'),
      ('team', 'tm_sacramento_monarchs', 'Q1541588'),
      ('team', 'tm_utah_starzz', 'Q1812243'),
      ('edition', 'wnba_1997', 'Q1517815')
    ) as x(entity_type, entity_id, qid);

  select count(*) into v_teams from public.wbh_team_editions where edition_id = 'wnba_1997';
  if v_teams <> 8 then
    raise exception 'wbh: 1997 spine has % clubs, expected 8', v_teams using errcode = 'P0001';
  end if;

  -- this migration must not have invented a single game
  if exists (select 1 from public.wbh_games where edition_id = 'wnba_1997') then
    raise exception 'wbh: the 1997 spine must not create games' using errcode = 'P0001';
  end if;

  update public.wbh_ingestion_runs
     set status = 'ok',
         counts = jsonb_build_object('franchises', 4, 'teams', 5, 'team_editions', 8,
                                     'lineage_events', 10, 'stages', 2, 'entity_links', 6, 'games', 0),
         finished_at = clock_timestamp()
   where run_id = v_run;
end $seed$;

commit;
