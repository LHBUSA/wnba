-- Women's Basketball History — Los Angeles Sparks 2024 regular-season results v1
-- First 31 results through Aug. 28 come from official Sparks Sept. 1 game notes.
-- Final nine results use official WNBA.com game summaries when not already canonical.
-- Existing deterministic game IDs are exact-or-fail validation only.

begin;

do $seed$
declare
  v_run uuid;
  v_notes_doc uuid;
  v_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_dataset constant text := 'wnba_2024_los_angeles_sparks_results_v1';
  v_notes_url constant text := 'https://cdn.wnba.com/sites/1611661330/2024/09/Sept-1-ATL-at-LAS-Game-Notes-1.pdf';
  v_derivation constant text := 'manual_curation:official_sparks_schedule_results_and_wnba_summary';
  v_rows constant jsonb := '[
{"game_date":"2024-05-15","away":"Atlanta Dream","away_code":"atl","away_points":92,"home":"Los Angeles Sparks","home_code":"las","home_points":81,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-05-18","away":"Los Angeles Sparks","away_code":"las","away_points":82,"home":"Las Vegas Aces","home_code":"lva","home_points":89,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-05-21","away":"Washington Mystics","away_code":"was","away_points":68,"home":"Los Angeles Sparks","home_code":"las","home_points":70,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-05-24","away":"Indiana Fever","away_code":"ind","away_points":78,"home":"Los Angeles Sparks","home_code":"las","home_points":73,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-05-26","away":"Dallas Wings","away_code":"dal","away_points":84,"home":"Los Angeles Sparks","home_code":"las","home_points":83,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-05-28","away":"Los Angeles Sparks","away_code":"las","away_points":88,"home":"Indiana Fever","home_code":"ind","home_points":82,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-05-30","away":"Los Angeles Sparks","away_code":"las","away_points":73,"home":"Chicago Sky","home_code":"chi","home_points":83,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-06-02","away":"Los Angeles Sparks","away_code":"las","away_points":68,"home":"Phoenix Mercury","home_code":"phx","home_points":87,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-06-05","away":"Minnesota Lynx","away_code":"min","away_points":86,"home":"Los Angeles Sparks","home_code":"las","home_points":62,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-06-07","away":"Dallas Wings","away_code":"dal","away_points":72,"home":"Los Angeles Sparks","home_code":"las","home_points":81,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-06-09","away":"Las Vegas Aces","away_code":"lva","away_points":92,"home":"Los Angeles Sparks","home_code":"las","home_points":96,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-06-11","away":"Los Angeles Sparks","away_code":"las","away_points":79,"home":"Seattle Storm","home_code":"sea","home_points":95,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-06-14","away":"Los Angeles Sparks","away_code":"las","away_points":76,"home":"Minnesota Lynx","home_code":"min","home_points":81,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-06-16","away":"Los Angeles Sparks","away_code":"las","away_points":74,"home":"Atlanta Dream","home_code":"atl","home_points":87,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-06-18","away":"Los Angeles Sparks","away_code":"las","away_points":70,"home":"Connecticut Sun","home_code":"con","home_points":79,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-06-20","away":"Los Angeles Sparks","away_code":"las","away_points":80,"home":"New York Liberty","home_code":"nyl","home_points":93,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-06-22","away":"Los Angeles Sparks","away_code":"las","away_points":88,"home":"New York Liberty","home_code":"nyl","home_points":98,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-06-28","away":"Los Angeles Sparks","away_code":"las","away_points":78,"home":"Phoenix Mercury","home_code":"phx","home_points":92,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-07-02","away":"Washington Mystics","away_code":"was","away_points":82,"home":"Los Angeles Sparks","home_code":"las","home_points":80,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-07-05","away":"Las Vegas Aces","away_code":"lva","away_points":93,"home":"Los Angeles Sparks","home_code":"las","home_points":98,"overtime_periods":1,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-07-07","away":"Phoenix Mercury","away_code":"phx","away_points":84,"home":"Los Angeles Sparks","home_code":"las","home_points":78,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-07-09","away":"Minnesota Lynx","away_code":"min","away_points":82,"home":"Los Angeles Sparks","home_code":"las","home_points":67,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-07-13","away":"Los Angeles Sparks","away_code":"las","away_points":87,"home":"Dallas Wings","home_code":"dal","home_points":81,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-07-16","away":"Seattle Storm","away_code":"sea","away_points":89,"home":"Los Angeles Sparks","home_code":"las","home_points":83,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-08-15","away":"New York Liberty","away_code":"nyl","away_points":103,"home":"Los Angeles Sparks","home_code":"las","home_points":68,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-08-17","away":"Chicago Sky","away_code":"chi","away_points":90,"home":"Los Angeles Sparks","home_code":"las","home_points":86,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-08-18","away":"Los Angeles Sparks","away_code":"las","away_points":71,"home":"Las Vegas Aces","home_code":"lva","home_points":87,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-08-20","away":"Los Angeles Sparks","away_code":"las","away_points":61,"home":"Connecticut Sun","home_code":"con","home_points":69,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-08-23","away":"Los Angeles Sparks","away_code":"las","away_points":74,"home":"Washington Mystics","home_code":"was","home_points":80,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-08-25","away":"Los Angeles Sparks","away_code":"las","away_points":110,"home":"Dallas Wings","home_code":"dal","home_points":113,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-08-28","away":"New York Liberty","away_code":"nyl","away_points":88,"home":"Los Angeles Sparks","home_code":"las","home_points":94,"overtime_periods":0,"source_kind":"notes","url":null,"wnba_event_id":null},
{"game_date":"2024-09-01","away":"Atlanta Dream","away_code":"atl","away_points":80,"home":"Los Angeles Sparks","home_code":"las","home_points":62,"overtime_periods":0,"source_kind":"wnba","url":"https://www.wnba.com/game/atl-vs-las-1022400193","wnba_event_id":"1022400193"},
{"game_date":"2024-09-04","away":"Los Angeles Sparks","away_code":"las","away_points":86,"home":"Indiana Fever","home_code":"ind","home_points":93,"overtime_periods":0,"source_kind":"wnba","url":"https://www.wnba.com/game/las-vs-ind-1022400199","wnba_event_id":"1022400199"},
{"game_date":"2024-09-06","away":"Los Angeles Sparks","away_code":"las","away_points":78,"home":"Chicago Sky","home_code":"chi","home_points":92,"overtime_periods":0,"source_kind":"wnba","url":"https://www.wnba.com/game/las-vs-chi-1022400205","wnba_event_id":"1022400205"},
{"game_date":"2024-09-08","away":"Connecticut Sun","away_code":"con","away_points":79,"home":"Los Angeles Sparks","home_code":"las","home_points":67,"overtime_periods":0,"source_kind":"wnba","url":"https://www.wnba.com/game/1022400211/con-vs-las/boxscore","wnba_event_id":"1022400211"},
{"game_date":"2024-09-10","away":"Connecticut Sun","away_code":"con","away_points":86,"home":"Los Angeles Sparks","home_code":"las","home_points":66,"overtime_periods":0,"source_kind":"wnba","url":"https://www.wnba.com/game/con-vs-las-1022400214","wnba_event_id":"1022400214"},
{"game_date":"2024-09-11","away":"Seattle Storm","away_code":"sea","away_points":90,"home":"Los Angeles Sparks","home_code":"las","home_points":82,"overtime_periods":0,"source_kind":"wnba","url":"https://www.wnba.com/game/sea-vs-las-1022400217","wnba_event_id":"1022400217"},
{"game_date":"2024-09-15","away":"Los Angeles Sparks","away_code":"las","away_points":87,"home":"Seattle Storm","home_code":"sea","home_points":90,"overtime_periods":0,"source_kind":"wnba","url":"https://www.wnba.com/game/las-vs-sea-1022400229","wnba_event_id":"1022400229"},
{"game_date":"2024-09-17","away":"Phoenix Mercury","away_code":"phx","away_points":85,"home":"Los Angeles Sparks","home_code":"las","home_points":81,"overtime_periods":0,"source_kind":"wnba","url":"https://www.wnba.com/game/pho-vs-las-1022400233","wnba_event_id":"1022400233"},
{"game_date":"2024-09-19","away":"Los Angeles Sparks","away_code":"las","away_points":68,"home":"Minnesota Lynx","home_code":"min","home_points":51,"overtime_periods":0,"source_kind":"wnba","url":"https://www.wnba.com/game/las-vs-min-1022400238","wnba_event_id":"1022400238"}
]'::jsonb;
  v_existing integer;
  v_inserted integer := 0;
  v_validated integer := 0;
  v_match integer;
  v_las_games integer;
  r record;
  v_game_id text;
  v_capture text;
begin
  perform public.wbh_assert_ingestible('pbe_curation');

  select count(*) into v_existing from public.wbh_ingestion_runs where scope->>'dataset'=v_dataset and status='ok';
  if v_existing>0 then
    select count(distinct gt.game_id) into v_las_games
      from public.wbh_game_teams gt join public.wbh_games g using(game_id)
     where g.edition_id='wnba_2024' and gt.team_edition_id='te_los_angeles_sparks_2024';
    if v_las_games=40 then return; end if;
    raise exception 'wbh: Sparks result run exists but canonical team-game count is % not 40',v_las_games using errcode='P0001';
  end if;

  select jsonb_agg(e.value order by e.ord)::text into v_capture
    from jsonb_array_elements(v_rows) with ordinality as e(value,ord)
   where e.value->>'source_kind'='notes';
  insert into public.wbh_source_documents
    (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,
     content_type,byte_size,storage_state,transformation_version,notes)
  values
    ('pbe_curation','los_angeles_sparks_2024_results_through_20240828',v_notes_url,'GET',v_now,200,
     encode(extensions.digest(convert_to(v_capture,'UTF8'),'sha256'),'hex'),'application/json',octet_length(v_capture),
     'hash_only','wbh_manual_game_results_v1','Manual factual transcription from official Los Angeles Sparks Sept. 1 game notes schedule/results table through Aug. 28; source PDF body not retained.')
  returning document_id into v_notes_doc;

  insert into public.wbh_ingestion_runs
    (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)
  values
    ('pbe_curation','manual_public_game_curation','1.0.0','wbh_manual_game_results_v1','ingest',v_now,
     jsonb_build_object('dataset',v_dataset,'edition_id','wnba_2024','input_rows',40,'regular_games',40,
                        'notes_rows',31,'wnba_summary_rows',9,'dedupe_policy','exact_or_fail',
                        'roster_stints_written',0,'player_game_stats_written',0))
  returning run_id into v_run;

  for r in
    select * from jsonb_to_recordset(v_rows)
      as x(game_date date,away text,away_code text,away_points integer,home text,home_code text,home_points integer,
           overtime_periods integer,source_kind text,url text,wnba_event_id text)
    order by game_date
  loop
    v_game_id := 'gm_wnba_2024_'||to_char(r.game_date,'YYYYMMDD')||'_'||r.away_code||'_at_'||r.home_code;

    if exists(select 1 from public.wbh_games where game_id=v_game_id) then
      select count(*) into v_match
        from public.wbh_games g
       where g.game_id=v_game_id and g.edition_id='wnba_2024' and g.local_date=r.game_date
         and g.stage_id='wnba_2024_regular_season' and g.game_type='regular' and g.season_phase='regular_season'
         and g.counts_for_standings=true and g.counts_for_stats=true and g.status='final'
         and g.completeness='score_only' and g.overtime_periods=r.overtime_periods
         and exists(select 1 from public.wbh_game_teams gt join public.wbh_team_editions te on te.team_edition_id=gt.team_edition_id
                     where gt.game_id=g.game_id and gt.side='away' and te.display_name=r.away and gt.points=r.away_points)
         and exists(select 1 from public.wbh_game_teams gt join public.wbh_team_editions te on te.team_edition_id=gt.team_edition_id
                     where gt.game_id=g.game_id and gt.side='home' and te.display_name=r.home and gt.points=r.home_points)
         and (select count(*) from public.wbh_game_teams gt where gt.game_id=g.game_id)=2;
      if v_match<>1 then raise exception 'wbh: Sparks cross-source validation failed for %',v_game_id using errcode='P0001'; end if;
      v_validated := v_validated+1;
      continue;
    end if;

    if not exists(select 1 from public.wbh_team_editions where edition_id='wnba_2024' and display_name=r.away)
       or not exists(select 1 from public.wbh_team_editions where edition_id='wnba_2024' and display_name=r.home) then
      raise exception 'wbh: noncanonical Sparks game reference %',v_game_id using errcode='P0001';
    end if;

    if r.source_kind='notes' then
      v_doc := v_notes_doc;
    else
      v_capture := jsonb_build_object('game_date',r.game_date,'away',r.away,'away_points',r.away_points,
                                      'home',r.home,'home_points',r.home_points,'wnba_event_id',r.wnba_event_id)::text;
      insert into public.wbh_source_documents
        (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,
         content_type,byte_size,storage_state,transformation_version,notes)
      values
        ('pbe_curation','wnba_game_'||r.wnba_event_id,r.url,'GET',v_now,200,
         encode(extensions.digest(convert_to(v_capture,'UTF8'),'sha256'),'hex'),'application/json',octet_length(v_capture),
         'hash_only','wbh_manual_game_results_v1','Manual factual transcription from official WNBA.com Sparks game summary; page body not retained.')
      returning document_id into v_doc;
    end if;

    insert into public.wbh_games
      (game_id,edition_id,stage_id,competition_id,local_date,status,game_type,season_phase,
       counts_for_standings,counts_for_stats,overtime_periods,completeness,
       source_document_id,ingestion_run_id,transformation_version,derivation)
    values
      (v_game_id,'wnba_2024','wnba_2024_regular_season','wnba',r.game_date,'final','regular','regular_season',
       true,true,r.overtime_periods,'score_only',v_doc,v_run,'wbh_manual_game_results_v1',v_derivation);

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

  if v_inserted+v_validated<>40 then
    raise exception 'wbh: Sparks migration accounted for % inserted + % validated, expected 40',v_inserted,v_validated using errcode='P0001';
  end if;
  select count(distinct gt.game_id) into v_las_games
    from public.wbh_game_teams gt join public.wbh_games g using(game_id)
   where g.edition_id='wnba_2024' and gt.team_edition_id='te_los_angeles_sparks_2024';
  if v_las_games<>40 then raise exception 'wbh: canonical Sparks team-game count % != 40',v_las_games using errcode='P0001'; end if;

  update public.wbh_ingestion_runs set status='ok',counts=jsonb_build_object(
    'input_rows',40,'regular_games',40,'inserted_games',v_inserted,'validated_existing_games',v_validated,
    'canonical_sparks_team_games',40,'roster_stints_written',0,'player_game_stats_written',0) where run_id=v_run;
end $seed$;

commit;
