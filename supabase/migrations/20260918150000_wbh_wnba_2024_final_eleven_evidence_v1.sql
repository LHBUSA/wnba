-- Women's Basketball History — evidence rows for the 2024 final eleven, and the one derived result
--
-- Part 1: a wbh_game_result_evidence row for each of the ten SCORED games added by
-- 20260918140000, so every canonical scoreline is traceable to the document it was read from.
-- The eleventh game has no score, and wbh_game_result_evidence asserts a scoreline, so it correctly
-- has no evidence row: there is no score evidence to record. Its provenance lives on the game row.
-- All eleven are role 'origin'. None are marked 'corroboration': the supporting lines we found
-- (the Sky notes' "Last Loss - May 15, 2024, 79-87" and the Lynx prose recaps) sit inside the same
-- documents as the tables they agree with, so they are internal consistency, not independent
-- confirmation, and are not claimed as such.
--
-- Part 2: the result — not the score — of Chicago at Minnesota on 2024-09-01.
--
-- Two official aggregates pin it, and they agree:
--   * Minnesota finished 2024 at 30-10 (Lynx game notes: "Named the WNBA's 2024 Coach of the Year
--     after directing Minnesota to a 30-10 record"). Our canonical data holds 39 Minnesota games
--     with a known result, at 29-10. The fortieth must therefore be a Minnesota win.
--   * Chicago stood at 13-25 entering game 39 (Sky game notes header, 9.17.24: "CHICAGO SKY (13-25)").
--     Games 39 and 40 are both canonical here and both losses, giving 13-27. Our canonical data holds
--     39 Chicago games at 13-26, so the fortieth must be a Chicago loss.
-- Same game, same answer, from two independent documents.
--
-- The SCORE remains unknown and stays NULL. An implied win is not a box score, and no points are
-- invented to make the row look complete. The game keeps completeness = 'schedule_only'.
--
-- This migration asserts the arithmetic against the live data before it writes, and refuses if the
-- database does not show exactly 29-10 and 13-26, so it cannot silently derive the wrong result.

begin;

do $seed$
declare
  v_run uuid;
  v_now timestamptz := clock_timestamp();
  v_dataset constant text := 'wnba_2024_final_eleven_evidence_v1';
  v_sky_notes_url constant text := 'https://cdn.wnba.com/sites/1611661330/2024/09/CHI-GAME-NOTES-9-17.pdf';
  v_lynx_url constant text := 'https://cdn.wnba.com/sites/1611661324/2025/05/G1-MIN-Notes-051625.pdf';
  v_game constant text := 'gm_wnba_2024_20240901_chi_at_min';
  v_doc_min uuid;
  v_doc_chi uuid;
  v_existing integer;
  v_evidence integer := 0;
  v_min_w integer; v_min_l integer; v_min_unknown integer;
  v_chi_w integer; v_chi_l integer; v_chi_unknown integer;
  v_capture text;
  r record;
begin
  perform public.wbh_assert_ingestible('pbe_curation');

  select count(*) into v_existing
    from public.wbh_ingestion_runs where scope->>'dataset' = v_dataset and status = 'ok';
  if v_existing > 0 then return; end if;

  -- the eleven games must exist exactly as the previous migration left them
  if (select count(*) from public.wbh_games g
       join public.wbh_ingestion_runs prev on prev.run_id = g.ingestion_run_id
      where prev.scope->>'dataset' = 'wnba_2024_final_eleven_results_v1') <> 11 then
    raise exception 'wbh: the final eleven games are not present; run 20260918140000 first' using errcode = 'P0001';
  end if;

  insert into public.wbh_ingestion_runs
    (source_id, adapter_id, adapter_version, transformation_version, mode, as_of, scope)
  values
    ('pbe_curation', 'manual_public_game_curation', '1.0.0', 'wbh_game_result_evidence_v1', 'ingest', v_now,
     jsonb_build_object('dataset', v_dataset, 'edition_id', 'wnba_2024',
                        'evidence_rows_expected', 10, 'derived_results', 1,
                        'derivation_basis', 'official season aggregates: MIN 30-10, CHI 13-25 through game 38'))
  returning run_id into v_run;

  -- Part 1: one origin evidence row per game, pointing at the document it was transcribed from
  for r in
    select g.game_id, g.local_date, g.game_type, g.stage_id, g.source_document_id,
           a.team_edition_id as away_te, a.points as away_points,
           h.team_edition_id as home_te, h.points as home_points,
           d.source_record_id
      from public.wbh_games g
      join public.wbh_ingestion_runs prev on prev.run_id = g.ingestion_run_id
      join public.wbh_game_teams a on a.game_id = g.game_id and a.side = 'away'
      join public.wbh_game_teams h on h.game_id = g.game_id and h.side = 'home'
      join public.wbh_source_documents d on d.document_id = g.source_document_id
     where prev.scope->>'dataset' = 'wnba_2024_final_eleven_results_v1'
       and a.points is not null and h.points is not null
     order by g.local_date
  loop
    insert into public.wbh_game_result_evidence
      (evidence_id, game_id, source_record_id, evidence_role, local_date,
       away_team_edition_id, home_team_edition_id, away_points, home_points,
       game_type, stage_id, source_document_id, ingestion_run_id, transformation_version, derivation, confidence)
    values
      ('gre_' || substr(md5(r.game_id || '|' || r.source_record_id || '|origin'), 1, 24),
       r.game_id, r.source_record_id, 'origin', r.local_date,
       r.away_te, r.home_te, r.away_points, r.home_points,
       r.game_type, r.stage_id, r.source_document_id, v_run, 'wbh_game_result_evidence_v1',
       'evidence_link:official_team_game_notes', 0.95);
    v_evidence := v_evidence + 1;
  end loop;

  if v_evidence <> 10 then
    raise exception 'wbh: expected 10 scored-game evidence rows, wrote %', v_evidence using errcode = 'P0001';
  end if;

  -- Part 2: verify the arithmetic before deriving anything
  select count(*) filter (where gt.result = 'win'),
         count(*) filter (where gt.result = 'loss'),
         count(*) filter (where gt.result is null)
    into v_min_w, v_min_l, v_min_unknown
    from public.wbh_game_teams gt
    join public.wbh_games g on g.game_id = gt.game_id and g.counts_for_standings
   where gt.team_edition_id = 'te_minnesota_lynx_2024';

  select count(*) filter (where gt.result = 'win'),
         count(*) filter (where gt.result = 'loss'),
         count(*) filter (where gt.result is null)
    into v_chi_w, v_chi_l, v_chi_unknown
    from public.wbh_game_teams gt
    join public.wbh_games g on g.game_id = gt.game_id and g.counts_for_standings
   where gt.team_edition_id = 'te_chicago_sky_2024';

  -- official MIN 30-10 minus our 29-10 leaves exactly one Minnesota win;
  -- official CHI 13-27 minus our 13-26 leaves exactly one Chicago loss
  if v_min_w <> 29 or v_min_l <> 10 or v_min_unknown <> 1
     or v_chi_w <> 13 or v_chi_l <> 26 or v_chi_unknown <> 1 then
    raise exception 'wbh: refusing to derive 2024-09-01; expected MIN 29-10 (1 unknown) and CHI 13-26 (1 unknown), found MIN %-% (%) CHI %-% (%)',
      v_min_w, v_min_l, v_min_unknown, v_chi_w, v_chi_l, v_chi_unknown using errcode = 'P0001';
  end if;

  select 'MIN 30-10 (Lynx game notes) | CHI 13-25 through game 38 (Sky game notes 9.17.24) | canonical 39-game tallies MIN 29-10, CHI 13-26'
    into v_capture;

  insert into public.wbh_source_documents
    (source_id, source_record_id, request_url, request_method, retrieved_at, http_status, content_sha256,
     content_type, byte_size, storage_state, transformation_version, notes)
  values
    ('pbe_curation', 'minnesota_lynx_2024_final_record_30_10', v_lynx_url, 'GET', v_now, 200,
     encode(extensions.digest(convert_to(v_capture || '|min', 'UTF8'), 'sha256'), 'hex'),
     'text/plain', null, 'hash_only', 'wbh_game_result_evidence_v1',
     'Official Minnesota Lynx game notes stating the 2024 final record of 30-10; used only to determine the winner of the one unscored game.')
  returning document_id into v_doc_min;

  insert into public.wbh_source_documents
    (source_id, source_record_id, request_url, request_method, retrieved_at, http_status, content_sha256,
     content_type, byte_size, storage_state, transformation_version, notes)
  values
    ('pbe_curation', 'chicago_sky_2024_record_13_25_through_game_38', v_sky_notes_url, 'GET', v_now, 200,
     encode(extensions.digest(convert_to(v_capture || '|chi', 'UTF8'), 'sha256'), 'hex'),
     'text/plain', null, 'hash_only', 'wbh_game_result_evidence_v1',
     'Official Chicago Sky game notes header of 9.17.24 showing 13-25 entering game 39; the last two games are canonical here and both losses.')
  returning document_id into v_doc_chi;

  -- record the change, then make it
  insert into public.wbh_fact_revisions (table_name, ingestion_run_id, source_document_id, old_row, new_row)
  select 'wbh_game_teams', v_run, v_doc_min, to_jsonb(gt),
         jsonb_set(to_jsonb(gt), '{result}',
                   to_jsonb(case when gt.team_edition_id = 'te_minnesota_lynx_2024' then 'win' else 'loss' end))
    from public.wbh_game_teams gt where gt.game_id = v_game;

  update public.wbh_game_teams gt
     set result = case when gt.team_edition_id = 'te_minnesota_lynx_2024' then 'win' else 'loss' end,
         derivation = 'derived_from_official_season_aggregate:min_30_10_and_chi_13_27',
         source_document_id = case when gt.team_edition_id = 'te_minnesota_lynx_2024' then v_doc_min else v_doc_chi end,
         -- the run asserting the new fact owns the row; the prior row is preserved in wbh_fact_revisions
         ingestion_run_id = v_run,
         confidence = 0.90
   where gt.game_id = v_game;

  -- the score must still be unknown: deriving a winner may never fill in points
  if exists (select 1 from public.wbh_game_teams where game_id = v_game and points is not null) then
    raise exception 'wbh: the 2024-09-01 score must remain unknown' using errcode = 'P0001';
  end if;

  if (select count(*) from public.wbh_game_teams where game_id = v_game and result is not null) <> 2 then
    raise exception 'wbh: derived result did not apply to both sides' using errcode = 'P0001';
  end if;

  update public.wbh_ingestion_runs
     set status = 'ok',
         counts = jsonb_build_object('evidence_rows', v_evidence, 'derived_results', 1,
                                     'scores_invented', 0),
         finished_at = clock_timestamp()
   where run_id = v_run;
end $seed$;

commit;
