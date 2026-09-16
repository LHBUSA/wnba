-- Women's Basketball History — Indiana Fever 2024 late-August / early-September results v1
-- Six official WNBA.com game summaries, manually curated as score-only facts.
-- No page bodies are retained and no stats.wnba.com API is used.

begin;

do $seed$
declare
  v_run uuid;
  v_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_dataset constant text := 'wnba_2024_indiana_results_20240826_through_20240906_v1';
  v_derivation constant text := 'manual_curation:official_wnba_game_summary';
  v_rows constant jsonb := '[{"game_date":"2024-08-26","away":"Indiana Fever","away_code":"ind","away_points":84,"home":"Atlanta Dream","home_code":"atl","home_points":79,"url":"https://www.wnba.com/game/ind-vs-atl-1022400176","wnba_event_id":"1022400176"},{"game_date":"2024-08-28","away":"Connecticut Sun","away_code":"con","away_points":80,"home":"Indiana Fever","home_code":"ind","home_points":84,"url":"https://www.wnba.com/game/con-vs-ind-1022400180","wnba_event_id":"1022400180"},{"game_date":"2024-08-30","away":"Indiana Fever","away_code":"ind","away_points":100,"home":"Chicago Sky","home_code":"chi","home_points":81,"url":"https://www.wnba.com/game/ind-vs-chi-1022400185","wnba_event_id":"1022400185"},{"game_date":"2024-09-01","away":"Indiana Fever","away_code":"ind","away_points":100,"home":"Dallas Wings","home_code":"dal","home_points":93,"url":"https://www.wnba.com/game/ind-vs-dal-1022400192","wnba_event_id":"1022400192"},{"game_date":"2024-09-04","away":"Los Angeles Sparks","away_code":"las","away_points":86,"home":"Indiana Fever","home_code":"ind","home_points":93,"url":"https://www.wnba.com/game/las-vs-ind-1022400199","wnba_event_id":"1022400199"},{"game_date":"2024-09-06","away":"Minnesota Lynx","away_code":"min","away_points":99,"home":"Indiana Fever","home_code":"ind","home_points":88,"url":"https://www.wnba.com/game/min-vs-ind-1022400204","wnba_event_id":"1022400204"}]'::jsonb;
  v_existing integer;
  v_games integer;
  v_teams integer;
  r record;
  v_capture text;
  v_game_id text;
begin
  perform public.wbh_assert_ingestible('pbe_curation');

  select count(*) into v_existing
    from public.wbh_ingestion_runs
   where scope->>'dataset'=v_dataset and status='ok';

  if v_existing>0 then
    select count(*) into v_games from public.wbh_games g join public.wbh_ingestion_runs ir on ir.run_id=g.ingestion_run_id where ir.scope->>'dataset'=v_dataset;
    select count(*) into v_teams from public.wbh_game_teams gt join public.wbh_ingestion_runs ir on ir.run_id=gt.ingestion_run_id where ir.scope->>'dataset'=v_dataset;
    if v_games=6 and v_teams=12 then return; end if;
    raise exception 'wbh: late Indiana result slice incomplete (% games, % team rows)',v_games,v_teams using errcode='P0001';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(v_rows)
      as x(game_date date,away text,away_code text,away_points integer,home text,home_code text,home_points integer,url text,wnba_event_id text)
    join public.wbh_games g
      on g.game_id='gm_wnba_2024_'||to_char(x.game_date,'YYYYMMDD')||'_'||x.away_code||'_at_'||x.home_code
  ) then
    raise exception 'wbh: one or more late Indiana game ids already exist; refusing implicit merge' using errcode='P0001';
  end if;

  insert into public.wbh_ingestion_runs
    (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)
  values
    ('pbe_curation','manual_public_game_curation','1.0.0','wbh_manual_game_results_v1','ingest',v_now,
     jsonb_build_object('dataset',v_dataset,'edition_id','wnba_2024','expected_games',6,
                        'expected_game_team_rows',12,'completeness','score_only',
                        'through_local_date','2024-09-06','roster_stints_written',0,'player_game_stats_written',0))
  returning run_id into v_run;

  for r in
    select * from jsonb_to_recordset(v_rows)
      as x(game_date date,away text,away_code text,away_points integer,home text,home_code text,home_points integer,url text,wnba_event_id text)
    order by game_date
  loop
    if not exists(select 1 from public.wbh_team_editions where edition_id='wnba_2024' and display_name=r.away)
       or not exists(select 1 from public.wbh_team_editions where edition_id='wnba_2024' and display_name=r.home) then
      raise exception 'wbh: noncanonical team in WNBA summary % vs %',r.away,r.home using errcode='P0001';
    end if;

    v_capture := jsonb_build_object('game_date',r.game_date,'away',r.away,'away_points',r.away_points,
                                    'home',r.home,'home_points',r.home_points,'wnba_event_id',r.wnba_event_id)::text;
    insert into public.wbh_source_documents
      (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,
       content_sha256,content_type,byte_size,storage_state,transformation_version,notes)
    values
      ('pbe_curation','wnba_game_'||r.wnba_event_id,r.url,'GET',v_now,200,
       encode(extensions.digest(convert_to(v_capture,'UTF8'),'sha256'),'hex'),'application/json',
       octet_length(v_capture),'hash_only','wbh_manual_game_results_v1',
       'Manual factual transcription from official WNBA.com game summary; page body not retained.')
    returning document_id into v_doc;

    v_game_id := 'gm_wnba_2024_'||to_char(r.game_date,'YYYYMMDD')||'_'||r.away_code||'_at_'||r.home_code;

    insert into public.wbh_games
      (game_id,edition_id,stage_id,competition_id,local_date,status,game_type,season_phase,
       counts_for_standings,counts_for_stats,completeness,
       source_document_id,ingestion_run_id,transformation_version,derivation)
    values
      (v_game_id,'wnba_2024','wnba_2024_regular_season','wnba',r.game_date,'final','regular','regular_season',
       true,true,'score_only',v_doc,v_run,'wbh_manual_game_results_v1',v_derivation);

    insert into public.wbh_game_teams
      (game_id,team_edition_id,side,points,result,source_document_id,ingestion_run_id,transformation_version,derivation)
    select v_game_id,te.team_edition_id,'away',r.away_points,
           case when r.away_points>r.home_points then 'win' else 'loss' end,
           v_doc,v_run,'wbh_manual_game_results_v1',v_derivation
      from public.wbh_team_editions te where te.edition_id='wnba_2024' and te.display_name=r.away
    union all
    select v_game_id,te.team_edition_id,'home',r.home_points,
           case when r.home_points>r.away_points then 'win' else 'loss' end,
           v_doc,v_run,'wbh_manual_game_results_v1',v_derivation
      from public.wbh_team_editions te where te.edition_id='wnba_2024' and te.display_name=r.home;
  end loop;

  select count(*) into v_games from public.wbh_games where ingestion_run_id=v_run;
  select count(*) into v_teams from public.wbh_game_teams where ingestion_run_id=v_run;
  if v_games<>6 or v_teams<>12 then
    raise exception 'wbh: late Indiana result slice produced % games / % team rows; expected 6 / 12',v_games,v_teams using errcode='P0001';
  end if;

  update public.wbh_ingestion_runs
     set status='ok',counts=jsonb_build_object('games',6,'game_team_rows',12,'final_games',6,
                                              'score_only_games',6,'roster_stints_written',0,'player_game_stats_written',0)
   where run_id=v_run;
end $seed$;

commit;
