-- PropBetEdge — Women's Basketball History
-- 2024 WNBA rights-clean reference skeleton v1.
--
-- Source manifest:
--   data/wbh/manifests/wnba-2024-reference-v1.json
--   commit c7db12066577821aee39f9e4640cb9b0f4f2f629
--
-- This is manual factual curation through the approved pbe_curation source. It does NOT ingest
-- WNBA.com payloads, ESPN data, box scores, play-by-play, provider rosters, or provider IDs.
-- It seeds only the canonical competition/edition/stage/team reference layer needed before player
-- identity and game facts can be added.

begin;

do $seed$
declare
  v_run uuid;
  v_derivation constant text := 'manual_curation:wnba_2024_reference_v1:data/wbh/manifests/wnba-2024-reference-v1.json@c7db12066577821aee39f9e4640cb9b0f4f2f629';
  v_team_count integer;
  v_stage_count integer;
begin
  perform public.wbh_assert_ingestible('pbe_curation');

  -- Idempotent rerun guard. A pre-existing complete reference slice is accepted only when the
  -- expected edition, 12 team editions and three stages are all present.
  if exists (select 1 from public.wbh_competition_editions where edition_id = 'wnba_2024') then
    select count(*) into v_team_count from public.wbh_team_editions where edition_id = 'wnba_2024';
    select count(*) into v_stage_count from public.wbh_stages where edition_id = 'wnba_2024';
    if v_team_count <> 12 or v_stage_count <> 3 then
      raise exception 'wbh: existing wnba_2024 reference slice is incomplete (% teams, % stages); refusing to guess',
        v_team_count, v_stage_count using errcode = 'P0001';
    end if;
    return;
  end if;

  insert into public.wbh_ingestion_runs
    (source_id, adapter_id, adapter_version, transformation_version, mode, as_of, scope)
  values
    ('pbe_curation', 'manual_manifest', '1.0.0', 'wbh_reference_v1', 'ingest',
     '2026-09-16T00:00:00Z',
     jsonb_build_object('dataset', 'wnba_2024_reference_v1', 'edition_id', 'wnba_2024'))
  returning run_id into v_run;

  insert into public.wbh_organizations
    (org_id, display_name, org_type, country_code, ingestion_run_id, derivation)
  values
    ('wnba', 'Women''s National Basketball Association', 'league', 'USA', v_run, v_derivation)
  on conflict (org_id) do nothing;

  insert into public.wbh_competitions
    (competition_id, org_id, display_name, competition_type, gender, country_code, tier, first_year,
     ingestion_run_id, derivation)
  values
    ('wnba', 'wnba', 'WNBA', 'league', 'women', 'USA', 1, 1997, v_run, v_derivation)
  on conflict (competition_id) do nothing;

  insert into public.wbh_competition_editions
    (edition_id, competition_id, season_label, season_year, start_date, end_date, team_count, status,
     completeness, ingestion_run_id, derivation, effective_at)
  values
    ('wnba_2024', 'wnba', '2024', 2024, '2024-05-14', '2024-10-20', 12, 'complete',
     'partial', v_run, v_derivation, '2024-05-14T00:00:00Z');

  insert into public.wbh_stages
    (stage_id, edition_id, display_name, season_phase, ordinal, ingestion_run_id, derivation, effective_at)
  values
    ('wnba_2024_regular_season', 'wnba_2024', 'Regular Season', 'regular_season', 10, v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('wnba_2024_playoffs',       'wnba_2024', 'Playoffs',       'playoffs',       20, v_run, v_derivation, '2024-09-22T00:00:00Z'),
    ('wnba_2024_finals',         'wnba_2024', 'WNBA Finals',    'final',          30, v_run, v_derivation, '2024-10-10T00:00:00Z');

  insert into public.wbh_franchises
    (franchise_id, canonical_name, country_code, ingestion_run_id, derivation, effective_at)
  values
    ('fr_atlanta_dream',       'Atlanta Dream',       'USA', v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('fr_chicago_sky',         'Chicago Sky',         'USA', v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('fr_connecticut_sun',     'Connecticut Sun',     'USA', v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('fr_dallas_wings',        'Dallas Wings',        'USA', v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('fr_indiana_fever',       'Indiana Fever',       'USA', v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('fr_las_vegas_aces',      'Las Vegas Aces',      'USA', v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('fr_los_angeles_sparks',  'Los Angeles Sparks',  'USA', v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('fr_minnesota_lynx',      'Minnesota Lynx',      'USA', v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('fr_new_york_liberty',    'New York Liberty',    'USA', v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('fr_phoenix_mercury',     'Phoenix Mercury',     'USA', v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('fr_seattle_storm',       'Seattle Storm',       'USA', v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('fr_washington_mystics',  'Washington Mystics',  'USA', v_run, v_derivation, '2024-05-14T00:00:00Z')
  on conflict (franchise_id) do nothing;

  insert into public.wbh_teams
    (team_id, team_kind, franchise_id, country_code, canonical_name, ingestion_run_id, derivation, effective_at)
  values
    ('tm_atlanta_dream',       'club', 'fr_atlanta_dream',      'USA', 'Atlanta Dream',      v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('tm_chicago_sky',         'club', 'fr_chicago_sky',        'USA', 'Chicago Sky',        v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('tm_connecticut_sun',     'club', 'fr_connecticut_sun',    'USA', 'Connecticut Sun',    v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('tm_dallas_wings',        'club', 'fr_dallas_wings',       'USA', 'Dallas Wings',       v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('tm_indiana_fever',       'club', 'fr_indiana_fever',      'USA', 'Indiana Fever',      v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('tm_las_vegas_aces',      'club', 'fr_las_vegas_aces',     'USA', 'Las Vegas Aces',     v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('tm_los_angeles_sparks',  'club', 'fr_los_angeles_sparks', 'USA', 'Los Angeles Sparks', v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('tm_minnesota_lynx',      'club', 'fr_minnesota_lynx',     'USA', 'Minnesota Lynx',     v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('tm_new_york_liberty',    'club', 'fr_new_york_liberty',   'USA', 'New York Liberty',   v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('tm_phoenix_mercury',     'club', 'fr_phoenix_mercury',    'USA', 'Phoenix Mercury',    v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('tm_seattle_storm',       'club', 'fr_seattle_storm',      'USA', 'Seattle Storm',      v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('tm_washington_mystics',  'club', 'fr_washington_mystics', 'USA', 'Washington Mystics', v_run, v_derivation, '2024-05-14T00:00:00Z')
  on conflict (team_id) do nothing;

  insert into public.wbh_team_editions
    (team_edition_id, team_id, edition_id, display_name, ingestion_run_id, derivation, effective_at)
  values
    ('te_atlanta_dream_2024',      'tm_atlanta_dream',      'wnba_2024', 'Atlanta Dream',      v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('te_chicago_sky_2024',        'tm_chicago_sky',        'wnba_2024', 'Chicago Sky',        v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('te_connecticut_sun_2024',    'tm_connecticut_sun',    'wnba_2024', 'Connecticut Sun',    v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('te_dallas_wings_2024',       'tm_dallas_wings',       'wnba_2024', 'Dallas Wings',       v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('te_indiana_fever_2024',      'tm_indiana_fever',      'wnba_2024', 'Indiana Fever',      v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('te_las_vegas_aces_2024',     'tm_las_vegas_aces',     'wnba_2024', 'Las Vegas Aces',     v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('te_los_angeles_sparks_2024', 'tm_los_angeles_sparks', 'wnba_2024', 'Los Angeles Sparks', v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('te_minnesota_lynx_2024',     'tm_minnesota_lynx',     'wnba_2024', 'Minnesota Lynx',     v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('te_new_york_liberty_2024',   'tm_new_york_liberty',   'wnba_2024', 'New York Liberty',   v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('te_phoenix_mercury_2024',    'tm_phoenix_mercury',    'wnba_2024', 'Phoenix Mercury',    v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('te_seattle_storm_2024',      'tm_seattle_storm',      'wnba_2024', 'Seattle Storm',      v_run, v_derivation, '2024-05-14T00:00:00Z'),
    ('te_washington_mystics_2024', 'tm_washington_mystics', 'wnba_2024', 'Washington Mystics', v_run, v_derivation, '2024-05-14T00:00:00Z');

  update public.wbh_ingestion_runs
     set status = 'ok',
         counts = jsonb_build_object(
           'organizations', 1,
           'competitions', 1,
           'editions', 1,
           'stages', 3,
           'franchises', 12,
           'teams', 12,
           'team_editions', 12
         )
   where run_id = v_run;
end $seed$;

commit;
