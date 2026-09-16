-- Women's Basketball History — Atlanta Dream 2024 regular-season results v1
-- 39 results from official Atlanta Dream Game 40 notes dated Sept. 19, plus the regular-season
-- finale from the official WNBA.com game summary. Existing deterministic game IDs are
-- exact-or-fail validation only. Atlanta's two playoff games are already canonical.

begin;

do $seed$
declare
  v_run uuid;
  v_notes_doc uuid;
  v_final_doc uuid;
  v_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_dataset constant text := 'wnba_2024_atlanta_dream_results_v1';
  v_notes_url constant text := 'https://cdn.wnba.com/sites/1611661330/2024/09/Dream-Game-Notes-Game-40-at-New-York-9.19.pdf';
  v_final_url constant text := 'https://www.wnba.com/game/atl-vs-nyl-1022400236';
  v_derivation constant text := 'manual_curation:official_atlanta_dream_schedule_results_and_wnba_summary';
  v_rows constant jsonb := '[
{"game_date":"2024-05-15","away":"Atlanta Dream","away_code":"atl","away_points":92,"home":"Los Angeles Sparks","home_code":"las","home_points":81,"overtime_periods":0},
{"game_date":"2024-05-18","away":"Atlanta Dream","away_code":"atl","away_points":85,"home":"Phoenix Mercury","home_code":"phx","home_points":88,"overtime_periods":0},
{"game_date":"2024-05-21","away":"Dallas Wings","away_code":"dal","away_points":78,"home":"Atlanta Dream","home_code":"atl","home_points":83,"overtime_periods":0},
{"game_date":"2024-05-26","away":"Minnesota Lynx","away_code":"min","away_points":92,"home":"Atlanta Dream","home_code":"atl","home_points":79,"overtime_periods":0},
{"game_date":"2024-05-29","away":"Atlanta Dream","away_code":"atl","away_points":73,"home":"Washington Mystics","home_code":"was","home_points":67,"overtime_periods":0},
{"game_date":"2024-05-31","away":"Las Vegas Aces","away_code":"lva","away_points":74,"home":"Atlanta Dream","home_code":"atl","home_points":78,"overtime_periods":0},
{"game_date":"2024-06-02","away":"Connecticut Sun","away_code":"con","away_points":69,"home":"Atlanta Dream","home_code":"atl","home_points":50,"overtime_periods":0},
{"game_date":"2024-06-06","away":"New York Liberty","away_code":"nyl","away_points":78,"home":"Atlanta Dream","home_code":"atl","home_points":61,"overtime_periods":0},
{"game_date":"2024-06-08","away":"Atlanta Dream","away_code":"atl","away_points":89,"home":"Chicago Sky","home_code":"chi","home_points":80,"overtime_periods":0},
{"game_date":"2024-06-11","away":"Washington Mystics","away_code":"was","away_points":87,"home":"Atlanta Dream","home_code":"atl","home_points":68,"overtime_periods":0},
{"game_date":"2024-06-13","away":"Atlanta Dream","away_code":"atl","away_points":84,"home":"Indiana Fever","home_code":"ind","home_points":91,"overtime_periods":0},
{"game_date":"2024-06-16","away":"Los Angeles Sparks","away_code":"las","away_points":74,"home":"Atlanta Dream","home_code":"atl","home_points":87,"overtime_periods":0},
{"game_date":"2024-06-19","away":"Atlanta Dream","away_code":"atl","away_points":55,"home":"Minnesota Lynx","home_code":"min","home_points":68,"overtime_periods":0},
{"game_date":"2024-06-21","away":"Indiana Fever","away_code":"ind","away_points":91,"home":"Atlanta Dream","home_code":"atl","home_points":79,"overtime_periods":0},
{"game_date":"2024-06-23","away":"New York Liberty","away_code":"nyl","away_points":96,"home":"Atlanta Dream","home_code":"atl","home_points":75,"overtime_periods":0},
{"game_date":"2024-06-28","away":"Atlanta Dream","away_code":"atl","away_points":78,"home":"Connecticut Sun","home_code":"con","home_points":74,"overtime_periods":0},
{"game_date":"2024-06-30","away":"Atlanta Dream","away_code":"atl","away_points":75,"home":"New York Liberty","home_code":"nyl","home_points":81,"overtime_periods":0},
{"game_date":"2024-07-02","away":"Atlanta Dream","away_code":"atl","away_points":77,"home":"Chicago Sky","home_code":"chi","home_points":85,"overtime_periods":0},
{"game_date":"2024-07-05","away":"Atlanta Dream","away_code":"atl","away_points":82,"home":"Dallas Wings","home_code":"dal","home_points":85,"overtime_periods":0},
{"game_date":"2024-07-07","away":"Atlanta Dream","away_code":"atl","away_points":67,"home":"Connecticut Sun","home_code":"con","home_points":80,"overtime_periods":0},
{"game_date":"2024-07-10","away":"Atlanta Dream","away_code":"atl","away_points":69,"home":"Chicago Sky","home_code":"chi","home_points":78,"overtime_periods":0},
{"game_date":"2024-07-12","away":"Las Vegas Aces","away_code":"lva","away_points":84,"home":"Atlanta Dream","home_code":"atl","home_points":70,"overtime_periods":0},
{"game_date":"2024-07-14","away":"Atlanta Dream","away_code":"atl","away_points":70,"home":"Seattle Storm","home_code":"sea","home_points":81,"overtime_periods":0},
{"game_date":"2024-07-17","away":"Atlanta Dream","away_code":"atl","away_points":79,"home":"Minnesota Lynx","home_code":"min","home_points":86,"overtime_periods":0},
{"game_date":"2024-08-16","away":"Seattle Storm","away_code":"sea","away_points":81,"home":"Atlanta Dream","home_code":"atl","home_points":83,"overtime_periods":0},
{"game_date":"2024-08-18","away":"Connecticut Sun","away_code":"con","away_points":70,"home":"Atlanta Dream","home_code":"atl","home_points":82,"overtime_periods":0},
{"game_date":"2024-08-21","away":"Phoenix Mercury","away_code":"phx","away_points":63,"home":"Atlanta Dream","home_code":"atl","home_points":72,"overtime_periods":0},
{"game_date":"2024-08-23","away":"Phoenix Mercury","away_code":"phx","away_points":82,"home":"Atlanta Dream","home_code":"atl","home_points":80,"overtime_periods":0},
{"game_date":"2024-08-26","away":"Indiana Fever","away_code":"ind","away_points":84,"home":"Atlanta Dream","home_code":"atl","home_points":79,"overtime_periods":0},
{"game_date":"2024-08-28","away":"Atlanta Dream","away_code":"atl","away_points":81,"home":"Seattle Storm","home_code":"sea","home_points":85,"overtime_periods":0},
{"game_date":"2024-08-30","away":"Atlanta Dream","away_code":"atl","away_points":72,"home":"Las Vegas Aces","home_code":"lva","home_points":83,"overtime_periods":0},
{"game_date":"2024-09-01","away":"Atlanta Dream","away_code":"atl","away_points":80,"home":"Los Angeles Sparks","home_code":"las","home_points":62,"overtime_periods":0},
{"game_date":"2024-09-03","away":"Atlanta Dream","away_code":"atl","away_points":66,"home":"Phoenix Mercury","home_code":"phx","home_points":74,"overtime_periods":0},
{"game_date":"2024-09-06","away":"Dallas Wings","away_code":"dal","away_points":96,"home":"Atlanta Dream","home_code":"atl","home_points":107,"overtime_periods":1},
{"game_date":"2024-09-08","away":"Atlanta Dream","away_code":"atl","away_points":100,"home":"Indiana Fever","home_code":"ind","home_points":104,"overtime_periods":1},
{"game_date":"2024-09-10","away":"Minnesota Lynx","away_code":"min","away_points":76,"home":"Atlanta Dream","home_code":"atl","home_points":64,"overtime_periods":0},
{"game_date":"2024-09-13","away":"Washington Mystics","away_code":"was","away_points":72,"home":"Atlanta Dream","home_code":"atl","home_points":69,"overtime_periods":0},
{"game_date":"2024-09-15","away":"Atlanta Dream","away_code":"atl","away_points":76,"home":"Washington Mystics","home_code":"was","home_points":73,"overtime_periods":1},
{"game_date":"2024-09-17","away":"Chicago Sky","away_code":"chi","away_points":70,"home":"Atlanta Dream","home_code":"atl","home_points":86,"overtime_periods":0},
{"game_date":"2024-09-19","away":"Atlanta Dream","away_code":"atl","away_points":78,"home":"New York Liberty","home_code":"nyl","home_points":67,"overtime_periods":0}
]'::jsonb;
  v_existing integer;
  v_inserted integer := 0;
  v_validated integer := 0;
  v_match integer;
  v_atl_games integer;
  r record;
  v_game_id text;
  v_capture text;
begin
  perform public.wbh_assert_ingestible('pbe_curation');

  select count(*) into v_existing from public.wbh_ingestion_runs where scope->>'dataset'=v_dataset and status='ok';
  if v_existing>0 then
    select count(distinct gt.game_id) into v_atl_games
      from public.wbh_game_teams gt join public.wbh_games g using(game_id)
     where g.edition_id='wnba_2024' and gt.team_edition_id='te_atlanta_dream_2024';
    if v_atl_games=42 then return; end if;
    raise exception 'wbh: Atlanta result run exists but canonical team-game count is % not 42',v_atl_games using errcode='P0001';
  end if;

  select jsonb_agg(e.value order by e.ord)::text into v_capture
    from jsonb_array_elements(v_rows) with ordinality as e(value,ord)
   where e.value->>'game_date'<>'2024-09-19';
  insert into public.wbh_source_documents
    (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,
     content_type,byte_size,storage_state,transformation_version,notes)
  values
    ('pbe_curation','atlanta_dream_2024_schedule_results_through_20240917',v_notes_url,'GET',v_now,200,
     encode(extensions.digest(convert_to(v_capture,'UTF8'),'sha256'),'hex'),'application/json',octet_length(v_capture),
     'hash_only','wbh_manual_game_results_v1','Manual factual transcription from official Atlanta Dream Game 40 notes schedule/results table through Sept. 17; source PDF body not retained.')
  returning document_id into v_notes_doc;

  v_capture := '{"game_date":"2024-09-19","away":"Atlanta Dream","away_points":78,"home":"New York Liberty","home_points":67,"wnba_event_id":"1022400236"}';
  insert into public.wbh_source_documents
    (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,
     content_type,byte_size,storage_state,transformation_version,notes)
  values
    ('pbe_curation','wnba_game_1022400236',v_final_url,'GET',v_now,200,
     encode(extensions.digest(convert_to(v_capture,'UTF8'),'sha256'),'hex'),'application/json',octet_length(v_capture),
     'hash_only','wbh_manual_game_results_v1','Manual factual transcription from official WNBA.com Sept. 19 Atlanta-New York game summary; page body not retained.')
  returning document_id into v_final_doc;

  insert into public.wbh_ingestion_runs
    (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)
  values
    ('pbe_curation','manual_public_game_curation','1.0.0','wbh_manual_game_results_v1','ingest',v_now,
     jsonb_build_object('dataset',v_dataset,'edition_id','wnba_2024','input_rows',40,'regular_games',40,
                        'postseason_games_already_canonical',2,'dedupe_policy','exact_or_fail',
                        'roster_stints_written',0,'player_game_stats_written',0))
  returning run_id into v_run;

  for r in
    select * from jsonb_to_recordset(v_rows)
      as x(game_date date,away text,away_code text,away_points integer,home text,home_code text,home_points integer,overtime_periods integer)
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
      if v_match<>1 then raise exception 'wbh: Atlanta cross-source validation failed for %',v_game_id using errcode='P0001'; end if;
      v_validated := v_validated+1;
      continue;
    end if;

    if not exists(select 1 from public.wbh_team_editions where edition_id='wnba_2024' and display_name=r.away)
       or not exists(select 1 from public.wbh_team_editions where edition_id='wnba_2024' and display_name=r.home) then
      raise exception 'wbh: noncanonical Atlanta game reference %',v_game_id using errcode='P0001';
    end if;

    v_doc := case when r.game_date=date '2024-09-19' then v_final_doc else v_notes_doc end;
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
    raise exception 'wbh: Atlanta migration accounted for % inserted + % validated, expected 40',v_inserted,v_validated using errcode='P0001';
  end if;
  select count(distinct gt.game_id) into v_atl_games
    from public.wbh_game_teams gt join public.wbh_games g using(game_id)
   where g.edition_id='wnba_2024' and gt.team_edition_id='te_atlanta_dream_2024';
  if v_atl_games<>42 then raise exception 'wbh: canonical Atlanta team-game count % != 42',v_atl_games using errcode='P0001'; end if;

  update public.wbh_ingestion_runs set status='ok',counts=jsonb_build_object(
    'input_rows',40,'regular_games',40,'inserted_games',v_inserted,'validated_existing_games',v_validated,
    'canonical_atlanta_team_games',42,'roster_stints_written',0,'player_game_stats_written',0) where run_id=v_run;
end $seed$;

commit;
