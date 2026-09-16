-- Women's Basketball History — Las Vegas Aces 2024 result evidence v1
--
-- The canonical Aces result migration already validated its complete 40-game regular season +
-- 6-game postseason against official Aces notes / WNBA summary facts. This additive migration
-- records those source observations in wbh_game_result_evidence without rewriting any game.

begin;

do $seed$
declare
  v_run uuid;
  v_notes_doc uuid;
  v_oct6_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_existing integer;
  v_evidence integer;
  v_origins integer;
  v_corroborations integer;
begin
  perform public.wbh_assert_ingestible('pbe_curation');

  select count(*) into v_existing
    from public.wbh_ingestion_runs
   where scope->>'dataset'='wnba_2024_las_vegas_aces_result_evidence_v1'
     and status='ok';
  if v_existing>0 then
    if (select count(*) from public.wbh_game_result_evidence e
        join public.wbh_ingestion_runs r on r.run_id=e.ingestion_run_id
        where r.scope->>'dataset'='wnba_2024_las_vegas_aces_result_evidence_v1')=46 then
      return;
    end if;
    raise exception 'wbh: Aces result-evidence run exists but does not contain 46 rows' using errcode='P0001';
  end if;

  if (select count(*) from public.wbh_games g
      join public.wbh_game_teams gt on gt.game_id=g.game_id
      where g.edition_id='wnba_2024' and gt.team_edition_id='te_las_vegas_aces_2024')<>46
     or (select count(*) from public.wbh_games g
         join public.wbh_game_teams gt on gt.game_id=g.game_id
         where g.edition_id='wnba_2024' and gt.team_edition_id='te_las_vegas_aces_2024' and g.game_type='regular')<>40
     or (select count(*) from public.wbh_games g
         join public.wbh_game_teams gt on gt.game_id=g.game_id
         where g.edition_id='wnba_2024' and gt.team_edition_id='te_las_vegas_aces_2024' and g.game_type='playoff')<>6 then
    raise exception 'wbh: Aces canonical participation is not exactly 40 regular + 6 playoff games' using errcode='P0001';
  end if;

  if (select count(*) from public.wbh_games g
      join public.wbh_game_teams gt on gt.game_id=g.game_id
      join public.wbh_ingestion_runs r on r.run_id=g.ingestion_run_id
      where g.edition_id='wnba_2024' and gt.team_edition_id='te_las_vegas_aces_2024'
        and r.scope->>'dataset'='wnba_2024_las_vegas_aces_results_v1')<>42 then
    raise exception 'wbh: expected 42 Aces-origin canonical games' using errcode='P0001';
  end if;

  if (select count(*) from public.wbh_games g
      join public.wbh_game_teams gt on gt.game_id=g.game_id
      join public.wbh_ingestion_runs r on r.run_id=g.ingestion_run_id
      where g.edition_id='wnba_2024' and gt.team_edition_id='te_las_vegas_aces_2024'
        and r.scope->>'dataset'<>'wnba_2024_las_vegas_aces_results_v1')<>4 then
    raise exception 'wbh: expected exactly 4 cross-source Aces corroborations' using errcode='P0001';
  end if;

  select document_id into strict v_notes_doc
    from public.wbh_source_documents
   where source_id='pbe_curation'
     and source_record_id='las_vegas_aces_2024_schedule_results_through_20241004';
  select document_id into strict v_oct6_doc
    from public.wbh_source_documents
   where source_id='pbe_curation'
     and source_record_id='wnba_game_1042400204';

  insert into public.wbh_ingestion_runs
    (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)
  values
    ('pbe_curation','canonical_result_evidence_linker','1.0.0','wbh_game_result_evidence_v1','ingest',v_now,
     jsonb_build_object('dataset','wnba_2024_las_vegas_aces_result_evidence_v1','edition_id','wnba_2024',
                        'expected_rows',46,'expected_origin_rows',42,'expected_corroboration_rows',4,
                        'canonical_games_written',0,'game_team_rows_written',0,'roster_stints_written',0,'player_game_stats_written',0))
  returning run_id into v_run;

  insert into public.wbh_game_result_evidence
    (evidence_id,game_id,source_record_id,evidence_role,local_date,
     away_team_edition_id,home_team_edition_id,away_points,home_points,game_type,stage_id,
     source_document_id,ingestion_run_id,transformation_version,derivation,effective_at)
  select
    'gre_'||substr(md5('aces_result_evidence_v1|'||g.game_id),1,24),
    g.game_id,
    case when g.game_id='gm_wnba_2024_20241006_nyl_at_lva'
         then 'wnba_game_1042400204'
         else 'las_vegas_aces_2024_schedule_results_through_20241004' end,
    case when origin.scope->>'dataset'='wnba_2024_las_vegas_aces_results_v1' then 'origin' else 'corroboration' end,
    g.local_date,
    away.team_edition_id,
    home.team_edition_id,
    away.points,
    home.points,
    g.game_type,
    g.stage_id,
    case when g.game_id='gm_wnba_2024_20241006_nyl_at_lva' then v_oct6_doc else v_notes_doc end,
    v_run,
    'wbh_game_result_evidence_v1',
    'evidence_link:official_aces_2024_results',
    g.local_date::timestamptz
  from public.wbh_games g
  join public.wbh_game_teams ace
    on ace.game_id=g.game_id and ace.team_edition_id='te_las_vegas_aces_2024'
  join public.wbh_game_teams away on away.game_id=g.game_id and away.side='away'
  join public.wbh_game_teams home on home.game_id=g.game_id and home.side='home'
  join public.wbh_ingestion_runs origin on origin.run_id=g.ingestion_run_id
  where g.edition_id='wnba_2024';

  select count(*) into v_evidence from public.wbh_game_result_evidence where ingestion_run_id=v_run;
  select count(*) into v_origins from public.wbh_game_result_evidence where ingestion_run_id=v_run and evidence_role='origin';
  select count(*) into v_corroborations from public.wbh_game_result_evidence where ingestion_run_id=v_run and evidence_role='corroboration';

  if v_evidence<>46 or v_origins<>42 or v_corroborations<>4 then
    raise exception 'wbh: Aces evidence counts are % total / % origin / % corroboration; expected 46/42/4',
      v_evidence,v_origins,v_corroborations using errcode='P0001';
  end if;

  if exists (
    select 1
    from public.wbh_game_result_evidence e
    join public.wbh_game_teams a on a.game_id=e.game_id and a.team_edition_id=e.away_team_edition_id and a.side='away'
    join public.wbh_game_teams h on h.game_id=e.game_id and h.team_edition_id=e.home_team_edition_id and h.side='home'
    where e.ingestion_run_id=v_run
      and (a.points<>e.away_points or h.points<>e.home_points)
  ) then
    raise exception 'wbh: Aces evidence disagrees with canonical score' using errcode='P0001';
  end if;

  update public.wbh_ingestion_runs
     set status='ok',counts=jsonb_build_object('evidence_rows',46,'origin_rows',42,'corroboration_rows',4,
                                              'canonical_games_written',0,'game_team_rows_written',0,
                                              'roster_stints_written',0,'player_game_stats_written',0)
   where run_id=v_run;
end $seed$;

commit;
