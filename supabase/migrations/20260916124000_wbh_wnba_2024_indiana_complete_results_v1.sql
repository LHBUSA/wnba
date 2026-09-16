-- Women's Basketball History — complete Indiana Fever 2024 results v1
-- Five remaining regular-season games plus both first-round playoff games.
-- Manual factual curation from official WNBA.com game summaries; page bodies are not retained.
-- This migration completes Indiana's 40-game regular season and 2-game postseason in WBH.

begin;

do $seed$
declare
  v_run uuid;
  v_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_dataset constant text := 'wnba_2024_indiana_results_20240908_through_playoffs_v1';
  v_derivation constant text := 'manual_curation:official_wnba_game_summary';
  v_rows constant jsonb := '[
    {"game_date":"2024-09-08","away":"Atlanta Dream","away_code":"atl","away_points":100,"home":"Indiana Fever","home_code":"ind","home_points":104,"url":"https://www.wnba.com/game/atl-vs-ind-1022400208","wnba_event_id":"1022400208","stage_id":"wnba_2024_regular_season","game_type":"regular","season_phase":"regular_season","counts_for_standings":true,"overtime_periods":1},
    {"game_date":"2024-09-11","away":"Las Vegas Aces","away_code":"lva","away_points":86,"home":"Indiana Fever","home_code":"ind","home_points":75,"url":"https://www.wnba.com/game/lva-vs-ind-1022400215","wnba_event_id":"1022400215","stage_id":"wnba_2024_regular_season","game_type":"regular","season_phase":"regular_season","counts_for_standings":true,"overtime_periods":0},
    {"game_date":"2024-09-13","away":"Las Vegas Aces","away_code":"lva","away_points":78,"home":"Indiana Fever","home_code":"ind","home_points":74,"url":"https://www.wnba.com/game/lva-vs-ind-1022400220","wnba_event_id":"1022400220","stage_id":"wnba_2024_regular_season","game_type":"regular","season_phase":"regular_season","counts_for_standings":true,"overtime_periods":0},
    {"game_date":"2024-09-15","away":"Dallas Wings","away_code":"dal","away_points":109,"home":"Indiana Fever","home_code":"ind","home_points":110,"url":"https://www.wnba.com/game/dal-vs-ind-1022400224","wnba_event_id":"1022400224","stage_id":"wnba_2024_regular_season","game_type":"regular","season_phase":"regular_season","counts_for_standings":true,"overtime_periods":0},
    {"game_date":"2024-09-19","away":"Indiana Fever","away_code":"ind","away_points":91,"home":"Washington Mystics","home_code":"was","home_points":92,"url":"https://www.wnba.com/game/ind-vs-was-1022400237","wnba_event_id":"1022400237","stage_id":"wnba_2024_regular_season","game_type":"regular","season_phase":"regular_season","counts_for_standings":true,"overtime_periods":0},
    {"game_date":"2024-09-22","away":"Indiana Fever","away_code":"ind","away_points":69,"home":"Connecticut Sun","home_code":"con","home_points":93,"url":"https://www.wnba.com/game/ind-vs-con-1042400121","wnba_event_id":"1042400121","stage_id":"wnba_2024_playoffs","game_type":"playoff","season_phase":"playoffs","counts_for_standings":false,"overtime_periods":0},
    {"game_date":"2024-09-25","away":"Indiana Fever","away_code":"ind","away_points":81,"home":"Connecticut Sun","home_code":"con","home_points":87,"url":"https://www.wnba.com/game/ind-vs-con-1042400122","wnba_event_id":"1042400122","stage_id":"wnba_2024_playoffs","game_type":"playoff","season_phase":"playoffs","counts_for_standings":false,"overtime_periods":0}
  ]'::jsonb;
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
    select count(*) into v_games
      from public.wbh_games g join public.wbh_ingestion_runs ir on ir.run_id=g.ingestion_run_id
     where ir.scope->>'dataset'=v_dataset;
    select count(*) into v_teams
      from public.wbh_game_teams gt join public.wbh_ingestion_runs ir on ir.run_id=gt.ingestion_run_id
     where ir.scope->>'dataset'=v_dataset;
    if v_games=7 and v_teams=14 then return; end if;
    raise exception 'wbh: Indiana completion slice incomplete (% games, % team rows)',v_games,v_teams using errcode='P0001';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(v_rows)
      as x(game_date date,away text,away_code text,away_points integer,home text,home_code text,home_points integer,
           url text,wnba_event_id text,stage_id text,game_type text,season_phase text,counts_for_standings boolean,overtime_periods integer)
    join public.wbh_games g
      on g.game_id='gm_wnba_2024_'||to_char(x.game_date,'YYYYMMDD')||'_'||x.away_code||'_at_'||x.home_code
  ) then
    raise exception 'wbh: one or more Indiana completion game ids already exist; refusing implicit merge' using errcode='P0001';
  end if;

  insert into public.wbh_ingestion_runs
    (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)
  values
    ('pbe_curation','manual_public_game_curation','1.0.0','wbh_manual_game_results_v1','ingest',v_now,
     jsonb_build_object('dataset',v_dataset,'edition_id','wnba_2024','expected_games',7,'expected_game_team_rows',14,
                        'regular_games',5,'playoff_games',2,'completeness','score_only','through_local_date','2024-09-25',
                        'roster_stints_written',0,'player_game_stats_written',0))
  returning run_id into v_run;

  for r in
    select * from jsonb_to_recordset(v_rows)
      as x(game_date date,away text,away_code text,away_points integer,home text,home_code text,home_points integer,
           url text,wnba_event_id text,stage_id text,game_type text,season_phase text,counts_for_standings boolean,overtime_periods integer)
    order by game_date
  loop
    if not exists(select 1 from public.wbh_team_editions where edition_id='wnba_2024' and display_name=r.away)
       or not exists(select 1 from public.wbh_team_editions where edition_id='wnba_2024' and display_name=r.home) then
      raise exception 'wbh: noncanonical team in WNBA summary % vs %',r.away,r.home using errcode='P0001';
    end if;
    if not exists(select 1 from public.wbh_stages where edition_id='wnba_2024' and stage_id=r.stage_id) then
      raise exception 'wbh: noncanonical stage %',r.stage_id using errcode='P0001';
    end if;

    v_capture := jsonb_build_object('game_date',r.game_date,'away',r.away,'away_points',r.away_points,
                                    'home',r.home,'home_points',r.home_points,'wnba_event_id',r.wnba_event_id,
                                    'stage_id',r.stage_id,'game_type',r.game_type,'season_phase',r.season_phase,
                                    'overtime_periods',r.overtime_periods)::text;
    insert into public.wbh_source_documents
      (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,
       content_type,byte_size,storage_state,transformation_version,notes)
    values
      ('pbe_curation','wnba_game_'||r.wnba_event_id,r.url,'GET',v_now,200,
       encode(extensions.digest(convert_to(v_capture,'UTF8'),'sha256'),'hex'),'application/json',octet_length(v_capture),
       'hash_only','wbh_manual_game_results_v1','Manual factual transcription from official WNBA.com game summary; page body not retained.')
    returning document_id into v_doc;

    v_game_id := 'gm_wnba_2024_'||to_char(r.game_date,'YYYYMMDD')||'_'||r.away_code||'_at_'||r.home_code;

    insert into public.wbh_games
      (game_id,edition_id,stage_id,competition_id,local_date,status,game_type,season_phase,
       counts_for_standings,counts_for_stats,overtime_periods,completeness,
       source_document_id,ingestion_run_id,transformation_version,derivation)
    values
      (v_game_id,'wnba_2024',r.stage_id,'wnba',r.game_date,'final',r.game_type,r.season_phase,
       r.counts_for_standings,true,r.overtime_periods,'score_only',v_doc,v_run,'wbh_manual_game_results_v1',v_derivation);

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
  if v_games<>7 or v_teams<>14 then
    raise exception 'wbh: Indiana completion slice produced % games / % team rows; expected 7 / 14',v_games,v_teams using errcode='P0001';
  end if;
  if (select count(*) from public.wbh_games where ingestion_run_id=v_run and game_type='regular')<>5
     or (select count(*) from public.wbh_games where ingestion_run_id=v_run and game_type='playoff')<>2
     or (select count(*) from public.wbh_games where ingestion_run_id=v_run and overtime_periods=1)<>1 then
    raise exception 'wbh: Indiana completion classification verification failed' using errcode='P0001';
  end if;

  update public.wbh_ingestion_runs
     set status='ok',counts=jsonb_build_object('games',7,'game_team_rows',14,'regular_games',5,'playoff_games',2,
                                              'final_games',7,'score_only_games',7,'overtime_games',1,
                                              'roster_stints_written',0,'player_game_stats_written',0)
   where run_id=v_run;
end $seed$;

commit;
