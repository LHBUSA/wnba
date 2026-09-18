-- Women's Basketball History — WNBA 2024 regular season: the final eleven games
--
-- Closes the 2024 regular-season result gap. Before this migration the edition holds 229 of 240
-- regular-season games; the 22 postseason games and the Commissioner's Cup final are already
-- complete. Every missing game is a head-to-head between the only three clubs short of 40 games:
-- Dallas (32), Chicago (33) and Minnesota (33). Shortfalls of 8 + 7 + 7 = 22 team slots = 11 games,
-- and none of the three series existed at all.
--
-- Sources (manual factual transcription, existing pbe_curation policy; no PDF body retained):
--   A. Official Chicago Sky game notes, 5.20.26, "ALL-TIME GAME BY GAME RESULTS vs. WINGS" table
--      https://cdn.wnba.com/sites/1611661329/2026/05/5-20-vs.-DAL.pdf
--      -> all four 2024 Chicago/Dallas meetings (scores printed Chicago-first).
--      Internally corroborated on the same page by "Last Loss - May 15, 2024, 79-87".
--   B. Official Minnesota Lynx game notes, 5.16.25, "Tonight's Opponent: Dallas Wings / 2024 vs.
--      Dallas (2-2)" capsule https://cdn.wnba.com/sites/1611661324/2025/05/G1-MIN-Notes-051625.pdf
--      -> all four 2024 Dallas/Minnesota meetings (scores printed Minnesota-first), each with a
--      prose recap naming the leading scorers, which agrees with the tabulated line.
--   C. The same Lynx document's franchise record lines, which cite two Chicago games by date and
--      final score: "at Chicago June 30, 2024 W70-62" and "Sept. 13, 2024 Chicago W83-66".
--
-- The eleventh game, Chicago at Minnesota on 2024-09-01, is inserted WITHOUT a score. The game is
-- confirmed by both clubs' published schedules and is referenced repeatedly in the Lynx statistical
-- leaders (e.g. "Angel Reese vs. Chicago (9/1/24)"), but no approved source we could reach prints
-- its final score. NULL means unknown. It is not invented, not guessed from the season record, and
-- not turned into a zero. completeness = 'schedule_only' marks it for a later pass.
--
-- Not claimed here: overtime periods were not independently verified for these eleven games and are
-- recorded as 0, which is the column default and the ordinary case; the final scores are unaffected.
--
-- Canonical scope: game and game_team result facts only. No box score, play-by-play, player
-- appearance, roster stint, odds, ESPN, Basketball-Reference or wnba_pbe_* writes.

begin;

do $seed$
declare
  v_run uuid;
  v_doc_sky uuid;
  v_doc_lynx uuid;
  v_doc_unscored uuid;
  v_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_dataset constant text := 'wnba_2024_final_eleven_results_v1';
  v_sky_url constant text := 'https://cdn.wnba.com/sites/1611661329/2026/05/5-20-vs.-DAL.pdf';
  v_lynx_url constant text := 'https://cdn.wnba.com/sites/1611661324/2025/05/G1-MIN-Notes-051625.pdf';
  v_derivation constant text := 'manual_curation:official_team_game_notes:2024_regular_season_head_to_head';
  v_rows constant jsonb := '[
    {"game_date":"2024-05-15","away":"Chicago Sky","away_code":"chi","away_points":79,"home":"Dallas Wings","home_code":"dal","home_points":87,"source_kind":"sky_notes"},
    {"game_date":"2024-05-18","away":"Chicago Sky","away_code":"chi","away_points":83,"home":"Dallas Wings","home_code":"dal","home_points":74,"source_kind":"sky_notes"},
    {"game_date":"2024-06-02","away":"Dallas Wings","away_code":"dal","away_points":76,"home":"Minnesota Lynx","home_code":"min","home_points":87,"source_kind":"lynx_notes"},
    {"game_date":"2024-06-17","away":"Dallas Wings","away_code":"dal","away_points":78,"home":"Minnesota Lynx","home_code":"min","home_points":90,"source_kind":"lynx_notes"},
    {"game_date":"2024-06-20","away":"Dallas Wings","away_code":"dal","away_points":72,"home":"Chicago Sky","home_code":"chi","home_points":83,"source_kind":"sky_notes"},
    {"game_date":"2024-06-27","away":"Minnesota Lynx","away_code":"min","away_points":88,"home":"Dallas Wings","home_code":"dal","home_points":94,"source_kind":"lynx_notes"},
    {"game_date":"2024-06-30","away":"Minnesota Lynx","away_code":"min","away_points":70,"home":"Chicago Sky","home_code":"chi","home_points":62,"source_kind":"lynx_notes"},
    {"game_date":"2024-08-30","away":"Minnesota Lynx","away_code":"min","away_points":76,"home":"Dallas Wings","home_code":"dal","home_points":94,"source_kind":"lynx_notes"},
    {"game_date":"2024-09-01","away":"Chicago Sky","away_code":"chi","away_points":null,"home":"Minnesota Lynx","home_code":"min","home_points":null,"source_kind":"unscored"},
    {"game_date":"2024-09-08","away":"Dallas Wings","away_code":"dal","away_points":77,"home":"Chicago Sky","home_code":"chi","home_points":92,"source_kind":"sky_notes"},
    {"game_date":"2024-09-13","away":"Chicago Sky","away_code":"chi","away_points":66,"home":"Minnesota Lynx","home_code":"min","home_points":83,"source_kind":"lynx_notes"}
  ]'::jsonb;
  v_capture_sky text;
  v_capture_lynx text;
  v_capture_unscored text;
  v_existing integer;
  v_before integer;
  v_after integer;
  v_inserted integer := 0;
  v_scored integer := 0;
  v_game_id text;
  r record;
begin
  perform public.wbh_assert_ingestible('pbe_curation');

  -- idempotent: a completed run of this dataset means the work is already done
  select count(*) into v_existing
    from public.wbh_ingestion_runs
   where scope->>'dataset' = v_dataset and status = 'ok';
  if v_existing > 0 then
    if (select count(*) from public.wbh_games
         where edition_id = 'wnba_2024' and game_type = 'regular') = 240 then return; end if;
    raise exception 'wbh: final-eleven run exists but 2024 regular season is not at 240 games'
      using errcode = 'P0001';
  end if;

  select count(*) into v_before
    from public.wbh_games where edition_id = 'wnba_2024' and game_type = 'regular';
  if v_before <> 229 then
    raise exception 'wbh: expected 229 regular games before the final eleven, found %', v_before
      using errcode = 'P0001';
  end if;

  -- exact-or-fail: refuse to touch a game that already exists rather than merge into it
  if exists (
    select 1 from jsonb_to_recordset(v_rows)
      as x(game_date date, away text, away_code text, away_points integer,
           home text, home_code text, home_points integer, source_kind text)
    join public.wbh_games g
      on g.game_id = 'gm_wnba_2024_' || to_char(x.game_date, 'YYYYMMDD') || '_' || x.away_code || '_at_' || x.home_code
  ) then
    raise exception 'wbh: a final-eleven game already exists; refusing implicit merge' using errcode = 'P0001';
  end if;

  -- one source document per transcription, each hashing exactly the rows it supports
  select jsonb_agg(e.value order by e.ord)::text into v_capture_sky
    from jsonb_array_elements(v_rows) with ordinality e(value, ord)
   where e.value->>'source_kind' = 'sky_notes';
  select jsonb_agg(e.value order by e.ord)::text into v_capture_lynx
    from jsonb_array_elements(v_rows) with ordinality e(value, ord)
   where e.value->>'source_kind' = 'lynx_notes';
  select jsonb_agg(e.value order by e.ord)::text into v_capture_unscored
    from jsonb_array_elements(v_rows) with ordinality e(value, ord)
   where e.value->>'source_kind' = 'unscored';

  insert into public.wbh_source_documents
    (source_id, source_record_id, request_url, request_method, retrieved_at, http_status, content_sha256,
     content_type, byte_size, storage_state, transformation_version, notes)
  values
    ('pbe_curation', 'chicago_sky_game_notes_2026_05_20_all_time_vs_wings', v_sky_url, 'GET', v_now, 200,
     encode(extensions.digest(convert_to(v_capture_sky, 'UTF8'), 'sha256'), 'hex'),
     'application/json', octet_length(v_capture_sky), 'hash_only', 'wbh_manual_game_results_v1',
     'Manual factual transcription of the four 2024 Chicago/Dallas meetings from the official Chicago Sky game notes all-time game-by-game results table; source PDF body not retained.')
  returning document_id into v_doc_sky;

  insert into public.wbh_source_documents
    (source_id, source_record_id, request_url, request_method, retrieved_at, http_status, content_sha256,
     content_type, byte_size, storage_state, transformation_version, notes)
  values
    ('pbe_curation', 'minnesota_lynx_game_notes_2025_05_16_series_capsule', v_lynx_url, 'GET', v_now, 200,
     encode(extensions.digest(convert_to(v_capture_lynx, 'UTF8'), 'sha256'), 'hex'),
     'application/json', octet_length(v_capture_lynx), 'hash_only', 'wbh_manual_game_results_v1',
     'Manual factual transcription from the official Minnesota Lynx game notes: the 2024 vs. Dallas series capsule (four games) and two franchise-record lines citing the June 30 and Sept. 13 Chicago games by date and final score; source PDF body not retained.')
  returning document_id into v_doc_lynx;

  insert into public.wbh_source_documents
    (source_id, source_record_id, request_url, request_method, retrieved_at, http_status, content_sha256,
     content_type, byte_size, storage_state, transformation_version, notes)
  values
    ('pbe_curation', 'wnba_2024_09_01_chi_at_min_schedule_only', v_lynx_url, 'GET', v_now, 200,
     encode(extensions.digest(convert_to(v_capture_unscored, 'UTF8'), 'sha256'), 'hex'),
     'application/json', octet_length(v_capture_unscored), 'hash_only', 'wbh_manual_game_results_v1',
     'Fixture confirmed by both clubs published 2024 schedules and referenced in the Lynx statistical leaders; final score not printed by any approved source reached. Score recorded as unknown, not derived.')
  returning document_id into v_doc_unscored;

  insert into public.wbh_ingestion_runs
    (source_id, adapter_id, adapter_version, transformation_version, mode, as_of, scope)
  values
    ('pbe_curation', 'manual_public_game_curation', '1.0.0', 'wbh_manual_game_results_v1', 'ingest', v_now,
     jsonb_build_object('dataset', v_dataset, 'edition_id', 'wnba_2024', 'input_rows', 11,
                        'expected_before_regular_games', 229, 'expected_after_regular_games', 240,
                        'sky_notes_rows', 4, 'lynx_notes_rows', 6, 'unscored_rows', 1,
                        'dedupe_policy', 'absent_or_fail',
                        'overtime_verified', false,
                        'open_question', 'final score of 2024-09-01 Chicago at Minnesota',
                        'roster_stints_written', 0, 'player_game_stats_written', 0))
  returning run_id into v_run;

  for r in select * from jsonb_to_recordset(v_rows)
    as x(game_date date, away text, away_code text, away_points integer,
         home text, home_code text, home_points integer, source_kind text)
    order by game_date
  loop
    if not exists (select 1 from public.wbh_team_editions where edition_id = 'wnba_2024' and display_name = r.away)
       or not exists (select 1 from public.wbh_team_editions where edition_id = 'wnba_2024' and display_name = r.home) then
      raise exception 'wbh: noncanonical team in final-eleven row % vs %', r.away, r.home using errcode = 'P0001';
    end if;

    v_doc := case r.source_kind
      when 'sky_notes' then v_doc_sky
      when 'lynx_notes' then v_doc_lynx
      when 'unscored' then v_doc_unscored
      else null end;
    if v_doc is null then raise exception 'wbh: missing source document for final-eleven row' using errcode = 'P0001'; end if;

    -- a scored row must carry both scores; a half-scored row is a bug, not a fact
    if (r.away_points is null) <> (r.home_points is null) then
      raise exception 'wbh: final-eleven row % has exactly one score', r.game_date using errcode = 'P0001';
    end if;

    v_game_id := 'gm_wnba_2024_' || to_char(r.game_date, 'YYYYMMDD') || '_' || r.away_code || '_at_' || r.home_code;
    insert into public.wbh_games
      (game_id, edition_id, stage_id, competition_id, local_date, status, game_type, season_phase,
       counts_for_standings, counts_for_stats, overtime_periods, completeness,
       source_document_id, ingestion_run_id, transformation_version, derivation, confidence)
    values
      (v_game_id, 'wnba_2024', 'wnba_2024_regular_season', 'wnba', r.game_date, 'final', 'regular', 'regular_season',
       true, true, 0,
       case when r.away_points is null then 'schedule_only' else 'score_only' end,
       v_doc, v_run, 'wbh_manual_game_results_v1', v_derivation,
       case when r.away_points is null then 0.70 else 0.95 end);

    insert into public.wbh_game_teams
      (game_id, team_edition_id, side, points, result, source_document_id, ingestion_run_id, transformation_version, derivation)
    select v_game_id, te.team_edition_id, 'away', r.away_points,
           case when r.away_points is null then null
                when r.away_points > r.home_points then 'win' else 'loss' end,
           v_doc, v_run, 'wbh_manual_game_results_v1', v_derivation
      from public.wbh_team_editions te where te.edition_id = 'wnba_2024' and te.display_name = r.away
    union all
    select v_game_id, te.team_edition_id, 'home', r.home_points,
           case when r.home_points is null then null
                when r.home_points > r.away_points then 'win' else 'loss' end,
           v_doc, v_run, 'wbh_manual_game_results_v1', v_derivation
      from public.wbh_team_editions te where te.edition_id = 'wnba_2024' and te.display_name = r.home;

    v_inserted := v_inserted + 1;
    if r.away_points is not null then v_scored := v_scored + 1; end if;
  end loop;

  select count(*) into v_after
    from public.wbh_games where edition_id = 'wnba_2024' and game_type = 'regular';
  if v_inserted <> 11 or v_scored <> 10 or v_after <> 240 then
    raise exception 'wbh: final eleven produced % inserted / % scored / % regular games; expected 11 / 10 / 240',
      v_inserted, v_scored, v_after using errcode = 'P0001';
  end if;

  -- every club must now stand at exactly 40 regular-season games
  if exists (
    select 1 from public.wbh_team_editions te
     where te.edition_id = 'wnba_2024'
       and (select count(*) from public.wbh_games g join public.wbh_game_teams gt using (game_id)
             where g.edition_id = 'wnba_2024' and g.game_type = 'regular'
               and gt.team_edition_id = te.team_edition_id) <> 40
  ) then
    raise exception 'wbh: a 2024 club is not at 40 regular-season games after the final eleven' using errcode = 'P0001';
  end if;

  update public.wbh_ingestion_runs
     set status = 'ok',
         counts = jsonb_build_object('input_rows', 11, 'inserted_games', 11, 'scored_games', 10,
                                     'unscored_games', 1, 'regular_games', 240,
                                     'sky_notes_rows', 4, 'lynx_notes_rows', 6,
                                     'roster_stints_written', 0, 'player_game_stats_written', 0),
         finished_at = clock_timestamp()
   where run_id = v_run;
end $seed$;

commit;
