-- Women's Basketball History — complete 2024 WNBA postseason v1
-- Adds the 14 postseason games not already canonical from the Indiana and Las Vegas slices.
-- Every row is manually curated from an official WNBA.com game summary and receives its own
-- source-document hash. Existing deterministic game IDs are exact-or-fail validation only.
-- No box score, PBP, player appearance, roster-stint, or wnba_pbe_* rows are written.

begin;

do $seed$
declare
  v_run uuid;
  v_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_dataset constant text := 'wnba_2024_complete_postseason_v1';
  v_derivation constant text := 'manual_curation:official_wnba_game_summary';
  v_rows constant jsonb := '[
{"game_date":"2024-09-22","away":"Atlanta Dream","away_code":"atl","away_points":69,"home":"New York Liberty","home_code":"nyl","home_points":83,"url":"https://www.wnba.com/game/atl-vs-nyl-1042400101","wnba_event_id":"1042400101","stage_id":"wnba_2024_playoffs","game_type":"playoff","season_phase":"playoffs","overtime_periods":0},
{"game_date":"2024-09-24","away":"Atlanta Dream","away_code":"atl","away_points":82,"home":"New York Liberty","home_code":"nyl","home_points":91,"url":"https://www.wnba.com/game/atl-vs-nyl-1042400102","wnba_event_id":"1042400102","stage_id":"wnba_2024_playoffs","game_type":"playoff","season_phase":"playoffs","overtime_periods":0},
{"game_date":"2024-09-22","away":"Phoenix Mercury","away_code":"phx","away_points":95,"home":"Minnesota Lynx","home_code":"min","home_points":102,"url":"https://www.wnba.com/game/pho-vs-min-1042400111","wnba_event_id":"1042400111","stage_id":"wnba_2024_playoffs","game_type":"playoff","season_phase":"playoffs","overtime_periods":0},
{"game_date":"2024-09-25","away":"Phoenix Mercury","away_code":"phx","away_points":88,"home":"Minnesota Lynx","home_code":"min","home_points":101,"url":"https://www.wnba.com/game/pho-vs-min-1042400112","wnba_event_id":"1042400112","stage_id":"wnba_2024_playoffs","game_type":"playoff","season_phase":"playoffs","overtime_periods":0},
{"game_date":"2024-09-29","away":"Connecticut Sun","away_code":"con","away_points":73,"home":"Minnesota Lynx","home_code":"min","home_points":70,"url":"https://www.wnba.com/game/con-vs-min-1042400211","wnba_event_id":"1042400211","stage_id":"wnba_2024_playoffs","game_type":"playoff","season_phase":"playoffs","overtime_periods":0},
{"game_date":"2024-10-01","away":"Connecticut Sun","away_code":"con","away_points":70,"home":"Minnesota Lynx","home_code":"min","home_points":77,"url":"https://www.wnba.com/game/con-vs-min-1042400212","wnba_event_id":"1042400212","stage_id":"wnba_2024_playoffs","game_type":"playoff","season_phase":"playoffs","overtime_periods":0},
{"game_date":"2024-10-04","away":"Minnesota Lynx","away_code":"min","away_points":90,"home":"Connecticut Sun","home_code":"con","home_points":81,"url":"https://www.wnba.com/game/min-vs-con-1042400213","wnba_event_id":"1042400213","stage_id":"wnba_2024_playoffs","game_type":"playoff","season_phase":"playoffs","overtime_periods":0},
{"game_date":"2024-10-06","away":"Minnesota Lynx","away_code":"min","away_points":82,"home":"Connecticut Sun","home_code":"con","home_points":92,"url":"https://www.wnba.com/game/min-vs-con-1042400214","wnba_event_id":"1042400214","stage_id":"wnba_2024_playoffs","game_type":"playoff","season_phase":"playoffs","overtime_periods":0},
{"game_date":"2024-10-08","away":"Connecticut Sun","away_code":"con","away_points":77,"home":"Minnesota Lynx","home_code":"min","home_points":88,"url":"https://www.wnba.com/game/con-vs-min-1042400215","wnba_event_id":"1042400215","stage_id":"wnba_2024_playoffs","game_type":"playoff","season_phase":"playoffs","overtime_periods":0},
{"game_date":"2024-10-10","away":"Minnesota Lynx","away_code":"min","away_points":95,"home":"New York Liberty","home_code":"nyl","home_points":93,"url":"https://www.wnba.com/game/min-vs-nyl-1042400301","wnba_event_id":"1042400301","stage_id":"wnba_2024_finals","game_type":"final","season_phase":"final","overtime_periods":1},
{"game_date":"2024-10-13","away":"Minnesota Lynx","away_code":"min","away_points":66,"home":"New York Liberty","home_code":"nyl","home_points":80,"url":"https://www.wnba.com/game/min-vs-nyl-1042400302","wnba_event_id":"1042400302","stage_id":"wnba_2024_finals","game_type":"final","season_phase":"final","overtime_periods":0},
{"game_date":"2024-10-16","away":"New York Liberty","away_code":"nyl","away_points":80,"home":"Minnesota Lynx","home_code":"min","home_points":77,"url":"https://www.wnba.com/game/nyl-vs-min-1042400303","wnba_event_id":"1042400303","stage_id":"wnba_2024_finals","game_type":"final","season_phase":"final","overtime_periods":0},
{"game_date":"2024-10-18","away":"New York Liberty","away_code":"nyl","away_points":80,"home":"Minnesota Lynx","home_code":"min","home_points":82,"url":"https://www.wnba.com/game/nyl-vs-min-1042400304","wnba_event_id":"1042400304","stage_id":"wnba_2024_finals","game_type":"final","season_phase":"final","overtime_periods":0},
{"game_date":"2024-10-20","away":"Minnesota Lynx","away_code":"min","away_points":62,"home":"New York Liberty","home_code":"nyl","home_points":67,"url":"https://www.wnba.com/game/min-vs-nyl-1042400305","wnba_event_id":"1042400305","stage_id":"wnba_2024_finals","game_type":"final","season_phase":"final","overtime_periods":1}
]'::jsonb;
  v_existing integer;
  v_inserted integer := 0;
  v_validated integer := 0;
  v_match integer;
  r record;
  v_game_id text;
  v_capture text;
  v_postseason integer;
begin
  perform public.wbh_assert_ingestible('pbe_curation');

  select count(*) into v_existing
    from public.wbh_ingestion_runs
   where scope->>'dataset'=v_dataset and status='ok';
  if v_existing>0 then
    select count(*) into v_postseason
      from public.wbh_games where edition_id='wnba_2024' and game_type in ('playoff','final');
    if v_postseason=22 then return; end if;
    raise exception 'wbh: complete-postseason run exists but canonical postseason count is % not 22',v_postseason using errcode='P0001';
  end if;

  insert into public.wbh_ingestion_runs
    (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)
  values
    ('pbe_curation','manual_public_game_curation','1.0.0','wbh_manual_game_results_v1','ingest',v_now,
     jsonb_build_object('dataset',v_dataset,'edition_id','wnba_2024','expected_rows',14,
                        'expected_complete_postseason_games',22,'first_round_and_semis_added',9,
                        'finals_added',5,'dedupe_policy','exact_or_fail','roster_stints_written',0,
                        'player_game_stats_written',0))
  returning run_id into v_run;

  for r in
    select * from jsonb_to_recordset(v_rows)
      as x(game_date date,away text,away_code text,away_points integer,home text,home_code text,home_points integer,
           url text,wnba_event_id text,stage_id text,game_type text,season_phase text,overtime_periods integer)
    order by game_date,wnba_event_id
  loop
    v_game_id := 'gm_wnba_2024_'||to_char(r.game_date,'YYYYMMDD')||'_'||r.away_code||'_at_'||r.home_code;

    if exists(select 1 from public.wbh_games where game_id=v_game_id) then
      select count(*) into v_match
        from public.wbh_games g
       where g.game_id=v_game_id and g.edition_id='wnba_2024' and g.local_date=r.game_date
         and g.stage_id=r.stage_id and g.game_type=r.game_type and g.season_phase=r.season_phase
         and g.counts_for_standings=false and g.counts_for_stats=true and g.status='final'
         and g.completeness='score_only' and g.overtime_periods=r.overtime_periods
         and exists(select 1 from public.wbh_game_teams gt join public.wbh_team_editions te on te.team_edition_id=gt.team_edition_id
                     where gt.game_id=g.game_id and gt.side='away' and te.display_name=r.away and gt.points=r.away_points)
         and exists(select 1 from public.wbh_game_teams gt join public.wbh_team_editions te on te.team_edition_id=gt.team_edition_id
                     where gt.game_id=g.game_id and gt.side='home' and te.display_name=r.home and gt.points=r.home_points)
         and (select count(*) from public.wbh_game_teams gt where gt.game_id=g.game_id)=2;
      if v_match<>1 then raise exception 'wbh: postseason cross-source validation failed for %',v_game_id using errcode='P0001'; end if;
      v_validated := v_validated+1;
      continue;
    end if;

    if not exists(select 1 from public.wbh_team_editions where edition_id='wnba_2024' and display_name=r.away)
       or not exists(select 1 from public.wbh_team_editions where edition_id='wnba_2024' and display_name=r.home)
       or not exists(select 1 from public.wbh_stages where edition_id='wnba_2024' and stage_id=r.stage_id) then
      raise exception 'wbh: noncanonical postseason reference %',v_game_id using errcode='P0001';
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
       'hash_only','wbh_manual_game_results_v1','Manual factual transcription from official WNBA.com postseason game summary; page body not retained.')
    returning document_id into v_doc;

    insert into public.wbh_games
      (game_id,edition_id,stage_id,competition_id,local_date,status,game_type,season_phase,
       counts_for_standings,counts_for_stats,overtime_periods,completeness,
       source_document_id,ingestion_run_id,transformation_version,derivation)
    values
      (v_game_id,'wnba_2024',r.stage_id,'wnba',r.game_date,'final',r.game_type,r.season_phase,
       false,true,r.overtime_periods,'score_only',v_doc,v_run,'wbh_manual_game_results_v1',v_derivation);

    insert into public.wbh_game_teams
      (game_id,team_edition_id,side,points,result,source_document_id,ingestion_run_id,transformation_version,derivation)
    select v_game_id,te.team_edition_id,'away',r.away_points,case when r.away_points>r.home_points then 'win' else 'loss' end,
           v_doc,v_run,'wbh_manual_game_results_v1',v_derivation
      from public.wbh_team_editions te where te.edition_id='wnba_2024' and te.display_name=r.away
    union all
    select v_game_id,te.team_edition_id,'home',r.home_points,case when r.home_points>r.away_points then 'win' else 'loss' end,
           v_doc,v_run,'wbh_manual_game_results_v1',v_derivation
      from public.wbh_team_editions te where te.edition_id='wnba_2024' and te.display_name=r.home;
    v_inserted := v_inserted+1;
  end loop;

  if v_inserted+v_validated<>14 then
    raise exception 'wbh: postseason migration accounted for % inserted + % validated, expected 14',v_inserted,v_validated using errcode='P0001';
  end if;
  select count(*) into v_postseason
    from public.wbh_games where edition_id='wnba_2024' and game_type in ('playoff','final');
  if v_postseason<>22 then raise exception 'wbh: canonical postseason count % != 22',v_postseason using errcode='P0001'; end if;
  if (select count(*) from public.wbh_games where edition_id='wnba_2024' and game_type='final')<>5 then
    raise exception 'wbh: canonical Finals count is not 5' using errcode='P0001';
  end if;

  update public.wbh_ingestion_runs set status='ok',counts=jsonb_build_object(
    'input_rows',14,'inserted_games',v_inserted,'validated_existing_games',v_validated,
    'complete_postseason_games',22,'playoff_games',17,'finals_games',5,
    'roster_stints_written',0,'player_game_stats_written',0) where run_id=v_run;
end $seed$;

commit;
