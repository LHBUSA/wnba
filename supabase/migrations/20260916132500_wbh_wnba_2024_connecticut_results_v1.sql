-- Women's Basketball History — complete Connecticut Sun 2024 regular-season results v1
-- Adds the ten regular-season games not already canonical after cross-team exact-or-fail ingestion.
-- Seven come from official Sun Aug. 18 game notes; the final three from official WNBA game summaries.
-- No box scores, play-by-play, player appearances, roster stints, or model writes.

begin;

do $seed$
declare
  v_run uuid;
  v_notes_doc uuid;
  v_aug23_doc uuid;
  v_sep17_doc uuid;
  v_sep19_doc uuid;
  v_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_dataset constant text := 'wnba_2024_connecticut_sun_results_v1';
  v_notes_url constant text := 'https://cdn.wnba.com/sites/1611661330/2024/08/Game-26-at-ATL.pdf';
  v_rows constant jsonb := '[
    {"game_date":"2024-05-23","away":"Minnesota Lynx","away_code":"min","away_points":82,"home":"Connecticut Sun","home_code":"con","home_points":83,"overtime_periods":1,"source_kind":"notes"},
    {"game_date":"2024-05-25","away":"Connecticut Sun","away_code":"con","away_points":86,"home":"Chicago Sky","home_code":"chi","home_points":82,"overtime_periods":0,"source_kind":"notes"},
    {"game_date":"2024-05-31","away":"Dallas Wings","away_code":"dal","away_points":72,"home":"Connecticut Sun","home_code":"con","home_points":74,"overtime_periods":0,"source_kind":"notes"},
    {"game_date":"2024-06-12","away":"Connecticut Sun","away_code":"con","away_points":83,"home":"Chicago Sky","home_code":"chi","home_points":75,"overtime_periods":0,"source_kind":"notes"},
    {"game_date":"2024-06-15","away":"Connecticut Sun","away_code":"con","away_points":85,"home":"Dallas Wings","home_code":"dal","home_points":67,"overtime_periods":0,"source_kind":"notes"},
    {"game_date":"2024-07-04","away":"Connecticut Sun","away_code":"con","away_points":78,"home":"Minnesota Lynx","home_code":"min","home_points":73,"overtime_periods":0,"source_kind":"notes"},
    {"game_date":"2024-08-16","away":"Connecticut Sun","away_code":"con","away_points":109,"home":"Dallas Wings","home_code":"dal","home_points":91,"overtime_periods":0,"source_kind":"notes"},
    {"game_date":"2024-08-23","away":"Chicago Sky","away_code":"chi","away_points":80,"home":"Connecticut Sun","home_code":"con","home_points":82,"overtime_periods":0,"source_kind":"wnba_aug23"},
    {"game_date":"2024-09-17","away":"Minnesota Lynx","away_code":"min","away_points":78,"home":"Connecticut Sun","home_code":"con","home_points":76,"overtime_periods":0,"source_kind":"wnba_sep17"},
    {"game_date":"2024-09-19","away":"Chicago Sky","away_code":"chi","away_points":54,"home":"Connecticut Sun","home_code":"con","home_points":87,"overtime_periods":0,"source_kind":"wnba_sep19"}
  ]'::jsonb;
  r record;
  v_game_id text;
  v_existing integer;
  v_before integer;
  v_after integer;
  v_inserted integer := 0;
  v_capture text;
begin
  perform public.wbh_assert_ingestible('pbe_curation');

  select count(*) into v_existing
    from public.wbh_ingestion_runs
   where scope->>'dataset'=v_dataset and status='ok';
  if v_existing>0 then
    if (select count(*) from public.wbh_games g join public.wbh_game_teams gt using(game_id)
        where g.edition_id='wnba_2024' and g.game_type='regular'
          and gt.team_edition_id='te_connecticut_sun_2024')=40 then return; end if;
    raise exception 'wbh: Connecticut result run exists but season is incomplete' using errcode='P0001';
  end if;

  select count(*) into v_before
    from public.wbh_games g join public.wbh_game_teams gt using(game_id)
   where g.edition_id='wnba_2024' and g.game_type='regular'
     and gt.team_edition_id='te_connecticut_sun_2024';
  if v_before<>30 then
    raise exception 'wbh: expected 30 Connecticut regular games before completion load, found %',v_before using errcode='P0001';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(v_rows)
      as x(game_date date,away text,away_code text,away_points integer,home text,home_code text,home_points integer,overtime_periods integer,source_kind text)
    join public.wbh_games g
      on g.game_id='gm_wnba_2024_'||to_char(x.game_date,'YYYYMMDD')||'_'||x.away_code||'_at_'||x.home_code
  ) then
    raise exception 'wbh: a Connecticut completion game already exists; refusing implicit merge' using errcode='P0001';
  end if;

  select jsonb_agg(e.value order by e.ord)::text into v_capture
    from jsonb_array_elements(v_rows) with ordinality e(value,ord)
   where e.value->>'source_kind'='notes';
  insert into public.wbh_source_documents
    (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,
     content_type,byte_size,storage_state,transformation_version,notes)
  values
    ('pbe_curation','connecticut_sun_2024_missing_results_through_20240816',v_notes_url,'GET',v_now,200,
     encode(extensions.digest(convert_to(v_capture,'UTF8'),'sha256'),'hex'),'application/json',octet_length(v_capture),
     'hash_only','wbh_manual_game_results_v1',
     'Manual factual transcription from official Connecticut Sun Aug. 18, 2024 game notes schedule/results table; source PDF body not retained.')
  returning document_id into v_notes_doc;

  insert into public.wbh_source_documents
    (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,
     content_type,byte_size,storage_state,transformation_version,notes)
  values
    ('pbe_curation','wnba_game_1022400169','https://www.wnba.com/game/chi-vs-con-1022400169','GET',v_now,200,
     encode(extensions.digest(convert_to('2024-08-23|CHI|80|CON|82','UTF8'),'sha256'),'hex'),'text/plain',null,
     'hash_only','wbh_manual_game_results_v1','Manual factual transcription from official WNBA.com game summary; page body not retained.')
  returning document_id into v_aug23_doc;

  insert into public.wbh_source_documents
    (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,
     content_type,byte_size,storage_state,transformation_version,notes)
  values
    ('pbe_curation','wnba_game_1022400230','https://www.wnba.com/game/min-vs-con-1022400230','GET',v_now,200,
     encode(extensions.digest(convert_to('2024-09-17|MIN|78|CON|76','UTF8'),'sha256'),'hex'),'text/plain',null,
     'hash_only','wbh_manual_game_results_v1','Manual factual transcription from official WNBA.com game summary; page body not retained.')
  returning document_id into v_sep17_doc;

  insert into public.wbh_source_documents
    (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,
     content_type,byte_size,storage_state,transformation_version,notes)
  values
    ('pbe_curation','wnba_game_1022400235','https://www.wnba.com/game/chi-vs-con-1022400235','GET',v_now,200,
     encode(extensions.digest(convert_to('2024-09-19|CHI|54|CON|87','UTF8'),'sha256'),'hex'),'text/plain',null,
     'hash_only','wbh_manual_game_results_v1','Manual factual transcription from official WNBA.com game summary; page body not retained.')
  returning document_id into v_sep19_doc;

  insert into public.wbh_ingestion_runs
    (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)
  values
    ('pbe_curation','manual_public_game_curation','1.0.0','wbh_manual_game_results_v1','ingest',v_now,
     jsonb_build_object('dataset',v_dataset,'edition_id','wnba_2024','input_rows',10,
                        'expected_before_regular_games',30,'expected_after_regular_games',40,
                        'notes_rows',7,'wnba_summary_rows',3,'dedupe_policy','absent_or_fail',
                        'roster_stints_written',0,'player_game_stats_written',0))
  returning run_id into v_run;

  for r in select * from jsonb_to_recordset(v_rows)
    as x(game_date date,away text,away_code text,away_points integer,home text,home_code text,home_points integer,overtime_periods integer,source_kind text)
    order by game_date
  loop
    if not exists(select 1 from public.wbh_team_editions where edition_id='wnba_2024' and display_name=r.away)
       or not exists(select 1 from public.wbh_team_editions where edition_id='wnba_2024' and display_name=r.home) then
      raise exception 'wbh: noncanonical team in Connecticut result % vs %',r.away,r.home using errcode='P0001';
    end if;

    v_doc := case r.source_kind
      when 'notes' then v_notes_doc
      when 'wnba_aug23' then v_aug23_doc
      when 'wnba_sep17' then v_sep17_doc
      when 'wnba_sep19' then v_sep19_doc
      else null end;
    if v_doc is null then raise exception 'wbh: missing source document for Connecticut row' using errcode='P0001'; end if;

    v_game_id := 'gm_wnba_2024_'||to_char(r.game_date,'YYYYMMDD')||'_'||r.away_code||'_at_'||r.home_code;
    insert into public.wbh_games
      (game_id,edition_id,stage_id,competition_id,local_date,status,game_type,season_phase,
       counts_for_standings,counts_for_stats,overtime_periods,completeness,
       source_document_id,ingestion_run_id,transformation_version,derivation)
    values
      (v_game_id,'wnba_2024','wnba_2024_regular_season','wnba',r.game_date,'final','regular','regular_season',
       true,true,r.overtime_periods,'score_only',v_doc,v_run,'wbh_manual_game_results_v1',
       'manual_curation:official_connecticut_schedule_results');

    insert into public.wbh_game_teams
      (game_id,team_edition_id,side,points,result,source_document_id,ingestion_run_id,transformation_version,derivation)
    select v_game_id,te.team_edition_id,'away',r.away_points,
           case when r.away_points>r.home_points then 'win' else 'loss' end,
           v_doc,v_run,'wbh_manual_game_results_v1','manual_curation:official_connecticut_schedule_results'
      from public.wbh_team_editions te where te.edition_id='wnba_2024' and te.display_name=r.away
    union all
    select v_game_id,te.team_edition_id,'home',r.home_points,
           case when r.home_points>r.away_points then 'win' else 'loss' end,
           v_doc,v_run,'wbh_manual_game_results_v1','manual_curation:official_connecticut_schedule_results'
      from public.wbh_team_editions te where te.edition_id='wnba_2024' and te.display_name=r.home;
    v_inserted := v_inserted+1;
  end loop;

  select count(*) into v_after
    from public.wbh_games g join public.wbh_game_teams gt using(game_id)
   where g.edition_id='wnba_2024' and g.game_type='regular'
     and gt.team_edition_id='te_connecticut_sun_2024';
  if v_inserted<>10 or v_after<>40 then
    raise exception 'wbh: Connecticut completion produced % inserted / % season games; expected 10 / 40',v_inserted,v_after using errcode='P0001';
  end if;

  update public.wbh_ingestion_runs
     set status='ok',counts=jsonb_build_object('input_rows',10,'inserted_games',10,'regular_games',40,
                                              'notes_rows',7,'wnba_summary_rows',3,
                                              'roster_stints_written',0,'player_game_stats_written',0)
   where run_id=v_run;
end $seed$;

commit;
