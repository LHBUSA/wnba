-- Women's Basketball History — resolve a canonical venue conflict: Chicago at Atlanta, 2024-07-02
--
-- Found by the box-score extraction pipeline, not by a person reading rows. When player game logs
-- from both clubs were matched to canonical games, every single row for this fixture disagreed with
-- the canonical venue, and the disagreement was unanimous on both sides.
--
-- Canonical row said:  Atlanta away 77 at Chicago home 85  (game id ..._atl_at_chi)
-- Three official documents say the opposite:
--   1. Atlanta Dream game notes, game 40 (9.19.24) — schedule line, verbatim:
--        "July 2 vs. Chicago L, 77-85"
--      This is the very document the canonical row cites as its source. The row was transcribed
--      with "vs." read as an away fixture.
--      https://cdn.wnba.com/sites/1611661330/2024/09/Dream-Game-Notes-Game-40-at-New-York-9.19.pdf
--   2. Atlanta Dream game notes, game 24 (7.17.24) — every Dream player's game log prints the
--        2024-07-02 fixture as "vs. CHI".
--      https://cdn.wnba.com/sites/1611661330/2024/08/Dream-Gamenote-Game-24-at-Minnesota-7.17.pdf
--   3. Chicago Sky game notes (7.10.24) — every Sky player's game log prints it as "@ ATL", and the
--        Sky's own season schedule table lists 07.02 as "@ ATLANTA".
--      https://cdn.wnba.com/sites/1611661330/2024/07/CHI-GAME-NOTES-7-10-1.pdf
--
-- 39 player rows across the two clubs agree. Nothing supports the canonical orientation.
--
-- What changes: the two sides swap. Atlanta becomes home, Chicago away.
-- What does NOT change: the scores (Atlanta 77, Chicago 85) and the results (Chicago won) were
-- always right; only the venue was inverted. The previous rows are preserved in wbh_fact_revisions.
--
-- The game id still reads "atl_at_chi". Canonical primary keys are immutable here by design, and
-- that rule is worth more than a tidy-looking string: ids are opaque handles, and the row - not the
-- label - carries the venue. The mismatch is recorded on the ingestion run so it stays discoverable.
--
-- The migration asserts the exact pre-state and refuses if the database does not match, so it can
-- only ever flip this one known-bad row.

begin;

do $seed$
declare
  v_run uuid;
  v_run_b uuid;
  v_doc_schedule uuid;
  v_doc_logs uuid;
  v_now timestamptz := clock_timestamp();
  v_dataset constant text := 'wnba_2024_0702_orientation_conflict_v1';
  v_old constant text := 'gm_wnba_2024_20240702_atl_at_chi';
  v_id_note constant text := 'game_id string still reads atl_at_chi; canonical ids are immutable opaque handles';
  v_capture constant text :=
    'ATL game notes g40 schedule: "July 2 vs. Chicago L, 77-85" | ATL g24 player logs: 7/2 vs. CHI | '
    'CHI 7.10 player logs: 07.02 @ ATL | CHI season schedule: 07.02 @ ATLANTA | 39 player rows agree';
  v_existing integer;
  v_atl_side text; v_chi_side text; v_atl_points integer; v_chi_points integer;
begin
  perform public.wbh_assert_ingestible('pbe_curation');

  select count(*) into v_existing
    from public.wbh_ingestion_runs where scope->>'dataset' = v_dataset and status = 'ok';
  if v_existing > 0 then return; end if;

  select gt.side, gt.points into v_atl_side, v_atl_points
    from public.wbh_game_teams gt
   where gt.game_id = v_old and gt.team_edition_id = 'te_atlanta_dream_2024';
  select gt.side, gt.points into v_chi_side, v_chi_points
    from public.wbh_game_teams gt
   where gt.game_id = v_old and gt.team_edition_id = 'te_chicago_sky_2024';

  if v_atl_side is distinct from 'away' or v_chi_side is distinct from 'home'
     or v_atl_points is distinct from 77 or v_chi_points is distinct from 85 then
    raise exception 'wbh: refusing to correct 2024-07-02; expected ATL away 77 / CHI home 85, found ATL % % / CHI % %',
      v_atl_side, v_atl_points, v_chi_side, v_chi_points using errcode = 'P0001';
  end if;

  insert into public.wbh_ingestion_runs
    (source_id, adapter_id, adapter_version, transformation_version, mode, as_of, scope)
  values
    ('pbe_curation', 'manual_public_game_curation', '1.0.0', 'wbh_orientation_correction_v1', 'ingest', v_now,
     jsonb_build_object('dataset', v_dataset, 'edition_id', 'wnba_2024', 'game_id', v_old,
                        'game_id_note', v_id_note, 'agreeing_player_rows', 39,
                        'found_by', 'player box-score extraction cross-check',
                        'scores_changed', false))
  returning run_id into v_run;

  insert into public.wbh_source_documents
    (source_id, source_record_id, request_url, request_method, retrieved_at, http_status, content_sha256,
     content_type, byte_size, storage_state, transformation_version, notes)
  values
    ('pbe_curation', 'atlanta_dream_game40_schedule_line_2024_07_02',
     'https://cdn.wnba.com/sites/1611661330/2024/09/Dream-Game-Notes-Game-40-at-New-York-9.19.pdf',
     'GET', v_now, 200, encode(extensions.digest(convert_to(v_capture || '|schedule', 'UTF8'), 'sha256'), 'hex'),
     'text/plain', null, 'hash_only', 'wbh_orientation_correction_v1',
     'Schedule line reads "July 2 vs. Chicago L, 77-85": Atlanta at home. This is the document the original canonical row cited.')
  returning document_id into v_doc_schedule;

  insert into public.wbh_source_documents
    (source_id, source_record_id, request_url, request_method, retrieved_at, http_status, content_sha256,
     content_type, byte_size, storage_state, transformation_version, notes)
  values
    ('pbe_curation', 'both_clubs_player_game_logs_2024_07_02',
     'https://cdn.wnba.com/sites/1611661330/2024/07/CHI-GAME-NOTES-7-10-1.pdf',
     'GET', v_now, 200, encode(extensions.digest(convert_to(v_capture || '|logs', 'UTF8'), 'sha256'), 'hex'),
     'text/plain', null, 'hash_only', 'wbh_orientation_correction_v1',
     'Chicago Sky and Atlanta Dream per-player game logs: 39 rows, every one of them placing the fixture at Atlanta.')
  returning document_id into v_doc_logs;

  -- keep what was there before
  insert into public.wbh_fact_revisions (table_name, ingestion_run_id, source_document_id, old_row, new_row)
  select 'wbh_game_teams', v_run, v_doc_logs, to_jsonb(gt),
         jsonb_set(to_jsonb(gt), '{side}',
                   to_jsonb(case when gt.team_edition_id = 'te_atlanta_dream_2024' then 'home' else 'away' end))
    from public.wbh_game_teams gt where gt.game_id = v_old;

  -- The provenance guard requires every correction to carry a run the row has not seen before, so a
  -- row cannot be edited twice inside one run without leaving a trail. The swap therefore needs two
  -- runs: the unique index on (game_id, side) also means one club has to step aside first.
  insert into public.wbh_ingestion_runs
    (source_id, adapter_id, adapter_version, transformation_version, mode, as_of, scope)
  values
    ('pbe_curation', 'manual_public_game_curation', '1.0.0', 'wbh_orientation_correction_v1', 'ingest', v_now,
     jsonb_build_object('dataset', v_dataset || ':step_b', 'edition_id', 'wnba_2024',
                        'purpose', 'second leg of the venue swap; see step a for the evidence'))
  returning run_id into v_run_b;

  update public.wbh_game_teams
     set side = 'neutral_a', ingestion_run_id = v_run
   where game_id = v_old and team_edition_id = 'te_chicago_sky_2024';
  update public.wbh_game_teams
     set side = 'home', ingestion_run_id = v_run, source_document_id = v_doc_logs,
         derivation = 'orientation_corrected:official_team_game_notes_2024_07_02'
   where game_id = v_old and team_edition_id = 'te_atlanta_dream_2024';
  update public.wbh_game_teams
     set side = 'away', ingestion_run_id = v_run_b, source_document_id = v_doc_logs,
         derivation = 'orientation_corrected:official_team_game_notes_2024_07_02'
   where game_id = v_old and team_edition_id = 'te_chicago_sky_2024';

  update public.wbh_games
     set ingestion_run_id = v_run, source_document_id = v_doc_schedule,
         derivation = 'orientation_corrected:official_team_game_notes_2024_07_02; '
                      || 'game_id label predates the correction and is an opaque handle'
   where game_id = v_old;

  -- after state
  if (select side from public.wbh_game_teams where game_id = v_old and team_edition_id = 'te_atlanta_dream_2024') <> 'home'
     or (select side from public.wbh_game_teams where game_id = v_old and team_edition_id = 'te_chicago_sky_2024') <> 'away' then
    raise exception 'wbh: 2024-07-02 sides did not swap' using errcode = 'P0001';
  end if;
  if (select points from public.wbh_game_teams where game_id = v_old and team_edition_id = 'te_atlanta_dream_2024') <> 77
     or (select points from public.wbh_game_teams where game_id = v_old and team_edition_id = 'te_chicago_sky_2024') <> 85 then
    raise exception 'wbh: 2024-07-02 scores must not change' using errcode = 'P0001';
  end if;
  if (select result from public.wbh_game_teams where game_id = v_old and team_edition_id = 'te_chicago_sky_2024') <> 'win' then
    raise exception 'wbh: 2024-07-02 result must not change' using errcode = 'P0001';
  end if;
  update public.wbh_ingestion_runs
     set status = 'ok',
         counts = jsonb_build_object('games_corrected', 1, 'game_id_unchanged', true, 'game_team_rows_corrected', 2,
                                     'scores_changed', 0, 'revisions_recorded', 3),
         finished_at = clock_timestamp()
   where run_id in (v_run, v_run_b);
end $seed$;

commit;
