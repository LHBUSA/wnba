-- Women's Basketball History — New York Liberty 2024 non-postseason results v1
-- 40 regular-season games plus the June 25 Commissioner's Cup Championship.
-- Primary source: official New York Liberty Sept. 29 semifinal game notes, which preserve the
-- complete 2024 schedule/results ledger through the regular-season finale and Cup championship.
-- Existing deterministic game IDs are exact-or-fail validation only.

begin;

do $seed$
declare
  v_run uuid;
  v_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_dataset constant text := 'wnba_2024_new_york_liberty_results_v1';
  v_url constant text := 'https://cdn.wnba.com/sites/1611661313/2024/09/NYL-Game-Notes-Semifinals-Game-1-vs.-LVA-9-29-24.pdf';
  v_derivation constant text := 'manual_curation:official_new_york_liberty_schedule_results';
  v_rows constant jsonb := '[
{"game_date":"2024-05-14","away":"New York Liberty","away_code":"nyl","away_points":85,"home":"Washington Mystics","home_code":"was","home_points":80,"kind":"regular"},
{"game_date":"2024-05-16","away":"New York Liberty","away_code":"nyl","away_points":102,"home":"Indiana Fever","home_code":"ind","home_points":66,"kind":"regular"},
{"game_date":"2024-05-18","away":"Indiana Fever","away_code":"ind","away_points":80,"home":"New York Liberty","home_code":"nyl","home_points":91,"kind":"regular"},
{"game_date":"2024-05-20","away":"Seattle Storm","away_code":"sea","away_points":63,"home":"New York Liberty","home_code":"nyl","home_points":74,"kind":"regular"},
{"game_date":"2024-05-23","away":"Chicago Sky","away_code":"chi","away_points":90,"home":"New York Liberty","home_code":"nyl","home_points":81,"kind":"regular"},
{"game_date":"2024-05-25","away":"New York Liberty","away_code":"nyl","away_points":67,"home":"Minnesota Lynx","home_code":"min","home_points":84,"kind":"regular"},
{"game_date":"2024-05-29","away":"Phoenix Mercury","away_code":"phx","away_points":78,"home":"New York Liberty","home_code":"nyl","home_points":81,"kind":"regular"},
{"game_date":"2024-05-31","away":"Washington Mystics","away_code":"was","away_points":79,"home":"New York Liberty","home_code":"nyl","home_points":90,"kind":"regular"},
{"game_date":"2024-06-02","away":"Indiana Fever","away_code":"ind","away_points":68,"home":"New York Liberty","home_code":"nyl","home_points":104,"kind":"regular"},
{"game_date":"2024-06-04","away":"New York Liberty","away_code":"nyl","away_points":88,"home":"Chicago Sky","home_code":"chi","home_points":75,"kind":"regular"},
{"game_date":"2024-06-06","away":"New York Liberty","away_code":"nyl","away_points":78,"home":"Atlanta Dream","home_code":"atl","home_points":61,"kind":"regular"},
{"game_date":"2024-06-08","away":"New York Liberty","away_code":"nyl","away_points":82,"home":"Connecticut Sun","home_code":"con","home_points":75,"kind":"regular"},
{"game_date":"2024-06-09","away":"Washington Mystics","away_code":"was","away_points":88,"home":"New York Liberty","home_code":"nyl","home_points":93,"kind":"regular"},
{"game_date":"2024-06-15","away":"New York Liberty","away_code":"nyl","away_points":90,"home":"Las Vegas Aces","home_code":"lva","home_points":82,"kind":"regular"},
{"game_date":"2024-06-18","away":"New York Liberty","away_code":"nyl","away_points":93,"home":"Phoenix Mercury","home_code":"phx","home_points":99,"kind":"regular"},
{"game_date":"2024-06-20","away":"Los Angeles Sparks","away_code":"las","away_points":80,"home":"New York Liberty","home_code":"nyl","home_points":93,"kind":"regular"},
{"game_date":"2024-06-22","away":"Los Angeles Sparks","away_code":"las","away_points":88,"home":"New York Liberty","home_code":"nyl","home_points":98,"kind":"regular"},
{"game_date":"2024-06-23","away":"New York Liberty","away_code":"nyl","away_points":96,"home":"Atlanta Dream","home_code":"atl","home_points":75,"kind":"regular"},
{"game_date":"2024-06-25","away":"Minnesota Lynx","away_code":"min","away_points":94,"home":"New York Liberty","home_code":"nyl","home_points":89,"kind":"cup"},
{"game_date":"2024-06-30","away":"Atlanta Dream","away_code":"atl","away_points":75,"home":"New York Liberty","home_code":"nyl","home_points":81,"kind":"regular"},
{"game_date":"2024-07-02","away":"Minnesota Lynx","away_code":"min","away_points":67,"home":"New York Liberty","home_code":"nyl","home_points":76,"kind":"regular"},
{"game_date":"2024-07-06","away":"New York Liberty","away_code":"nyl","away_points":78,"home":"Indiana Fever","home_code":"ind","home_points":83,"kind":"regular"},
{"game_date":"2024-07-10","away":"New York Liberty","away_code":"nyl","away_points":71,"home":"Connecticut Sun","home_code":"con","home_points":68,"kind":"regular"},
{"game_date":"2024-07-11","away":"Chicago Sky","away_code":"chi","away_points":76,"home":"New York Liberty","home_code":"nyl","home_points":91,"kind":"regular"},
{"game_date":"2024-07-13","away":"New York Liberty","away_code":"nyl","away_points":81,"home":"Chicago Sky","home_code":"chi","home_points":67,"kind":"regular"},
{"game_date":"2024-07-16","away":"Connecticut Sun","away_code":"con","away_points":74,"home":"New York Liberty","home_code":"nyl","home_points":82,"kind":"regular"},
{"game_date":"2024-08-15","away":"New York Liberty","away_code":"nyl","away_points":103,"home":"Los Angeles Sparks","home_code":"las","home_points":68,"kind":"regular"},
{"game_date":"2024-08-17","away":"New York Liberty","away_code":"nyl","away_points":79,"home":"Las Vegas Aces","home_code":"lva","home_points":67,"kind":"regular"},
{"game_date":"2024-08-20","away":"Dallas Wings","away_code":"dal","away_points":74,"home":"New York Liberty","home_code":"nyl","home_points":94,"kind":"regular"},
{"game_date":"2024-08-22","away":"Dallas Wings","away_code":"dal","away_points":71,"home":"New York Liberty","home_code":"nyl","home_points":79,"kind":"regular"},
{"game_date":"2024-08-24","away":"Connecticut Sun","away_code":"con","away_points":72,"home":"New York Liberty","home_code":"nyl","home_points":64,"kind":"regular"},
{"game_date":"2024-08-26","away":"New York Liberty","away_code":"nyl","away_points":84,"home":"Phoenix Mercury","home_code":"phx","home_points":70,"kind":"regular"},
{"game_date":"2024-08-28","away":"New York Liberty","away_code":"nyl","away_points":88,"home":"Los Angeles Sparks","home_code":"las","home_points":94,"kind":"regular"},
{"game_date":"2024-08-30","away":"New York Liberty","away_code":"nyl","away_points":98,"home":"Seattle Storm","home_code":"sea","home_points":85,"kind":"regular"},
{"game_date":"2024-09-05","away":"Seattle Storm","away_code":"sea","away_points":70,"home":"New York Liberty","home_code":"nyl","home_points":77,"kind":"regular"},
{"game_date":"2024-09-08","away":"Las Vegas Aces","away_code":"lva","away_points":71,"home":"New York Liberty","home_code":"nyl","home_points":75,"kind":"regular"},
{"game_date":"2024-09-10","away":"New York Liberty","away_code":"nyl","away_points":105,"home":"Dallas Wings","home_code":"dal","home_points":91,"kind":"regular"},
{"game_date":"2024-09-12","away":"New York Liberty","away_code":"nyl","away_points":99,"home":"Dallas Wings","home_code":"dal","home_points":67,"kind":"regular"},
{"game_date":"2024-09-15","away":"Minnesota Lynx","away_code":"min","away_points":88,"home":"New York Liberty","home_code":"nyl","home_points":79,"kind":"regular"},
{"game_date":"2024-09-17","away":"New York Liberty","away_code":"nyl","away_points":87,"home":"Washington Mystics","home_code":"was","home_points":71,"kind":"regular"},
{"game_date":"2024-09-19","away":"Atlanta Dream","away_code":"atl","away_points":78,"home":"New York Liberty","home_code":"nyl","home_points":67,"kind":"regular"}
]'::jsonb;
  v_existing integer;
  v_inserted integer := 0;
  v_validated integer := 0;
  v_match integer;
  v_nyl_games integer;
  r record;
  v_game_id text;
  v_stage_id text;
  v_game_type text;
  v_phase text;
  v_counts_standings boolean;
  v_capture text;
begin
  perform public.wbh_assert_ingestible('pbe_curation');

  select count(*) into v_existing from public.wbh_ingestion_runs where scope->>'dataset'=v_dataset and status='ok';
  if v_existing>0 then
    select count(distinct gt.game_id) into v_nyl_games
      from public.wbh_game_teams gt join public.wbh_games g using(game_id)
     where g.edition_id='wnba_2024' and gt.team_edition_id='te_new_york_liberty_2024';
    if v_nyl_games=52 then return; end if;
    raise exception 'wbh: Liberty result run exists but canonical team-game count is % not 52',v_nyl_games using errcode='P0001';
  end if;

  v_capture := v_rows::text;
  insert into public.wbh_source_documents
    (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,
     content_type,byte_size,storage_state,transformation_version,notes)
  values
    ('pbe_curation','new_york_liberty_2024_schedule_results',v_url,'GET',v_now,200,
     encode(extensions.digest(convert_to(v_capture,'UTF8'),'sha256'),'hex'),'application/json',octet_length(v_capture),
     'hash_only','wbh_manual_game_results_v1','Manual factual transcription from official New York Liberty 2024 game notes schedule/results ledger; source PDF body not retained.')
  returning document_id into v_doc;

  insert into public.wbh_ingestion_runs
    (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)
  values
    ('pbe_curation','manual_public_game_curation','1.0.0','wbh_manual_game_results_v1','ingest',v_now,
     jsonb_build_object('dataset',v_dataset,'edition_id','wnba_2024','input_rows',41,'regular_games',40,
                        'commissioners_cup_championship_games',1,'dedupe_policy','exact_or_fail',
                        'roster_stints_written',0,'player_game_stats_written',0))
  returning run_id into v_run;

  if not exists(select 1 from public.wbh_stages where stage_id='wnba_2024_commissioners_cup_final') then
    insert into public.wbh_stages
      (stage_id,edition_id,display_name,season_phase,ordinal,source_document_id,ingestion_run_id,
       transformation_version,derivation,effective_at)
    values
      ('wnba_2024_commissioners_cup_final','wnba_2024','Commissioner''s Cup Championship','in_season_cup',15,
       v_doc,v_run,'wbh_manual_game_results_v1',v_derivation,'2024-06-25T00:00:00Z');
  else
    if not exists(select 1 from public.wbh_stages where stage_id='wnba_2024_commissioners_cup_final'
                  and edition_id='wnba_2024' and season_phase='in_season_cup') then
      raise exception 'wbh: Commissioner''s Cup stage exists with incompatible semantics' using errcode='P0001';
    end if;
  end if;

  for r in
    select * from jsonb_to_recordset(v_rows)
      as x(game_date date,away text,away_code text,away_points integer,home text,home_code text,home_points integer,kind text)
    order by game_date
  loop
    if r.kind='cup' then
      v_stage_id := 'wnba_2024_commissioners_cup_final';
      v_game_type := 'in_season_cup';
      v_phase := 'in_season_cup';
      v_counts_standings := false;
    else
      v_stage_id := 'wnba_2024_regular_season';
      v_game_type := 'regular';
      v_phase := 'regular_season';
      v_counts_standings := true;
    end if;

    v_game_id := 'gm_wnba_2024_'||to_char(r.game_date,'YYYYMMDD')||'_'||r.away_code||'_at_'||r.home_code;

    if exists(select 1 from public.wbh_games where game_id=v_game_id) then
      select count(*) into v_match
        from public.wbh_games g
       where g.game_id=v_game_id and g.edition_id='wnba_2024' and g.local_date=r.game_date
         and g.stage_id=v_stage_id and g.game_type=v_game_type and g.season_phase=v_phase
         and g.counts_for_standings=v_counts_standings and g.counts_for_stats=true
         and g.status='final' and g.completeness='score_only' and g.overtime_periods=0
         and exists(select 1 from public.wbh_game_teams gt join public.wbh_team_editions te on te.team_edition_id=gt.team_edition_id
                     where gt.game_id=g.game_id and gt.side='away' and te.display_name=r.away and gt.points=r.away_points)
         and exists(select 1 from public.wbh_game_teams gt join public.wbh_team_editions te on te.team_edition_id=gt.team_edition_id
                     where gt.game_id=g.game_id and gt.side='home' and te.display_name=r.home and gt.points=r.home_points)
         and (select count(*) from public.wbh_game_teams gt where gt.game_id=g.game_id)=2;
      if v_match<>1 then raise exception 'wbh: Liberty cross-source validation failed for %',v_game_id using errcode='P0001'; end if;
      v_validated := v_validated+1;
      continue;
    end if;

    if not exists(select 1 from public.wbh_team_editions where edition_id='wnba_2024' and display_name=r.away)
       or not exists(select 1 from public.wbh_team_editions where edition_id='wnba_2024' and display_name=r.home) then
      raise exception 'wbh: noncanonical Liberty game reference %',v_game_id using errcode='P0001';
    end if;

    insert into public.wbh_games
      (game_id,edition_id,stage_id,competition_id,local_date,status,game_type,season_phase,
       counts_for_standings,counts_for_stats,overtime_periods,completeness,
       source_document_id,ingestion_run_id,transformation_version,derivation)
    values
      (v_game_id,'wnba_2024',v_stage_id,'wnba',r.game_date,'final',v_game_type,v_phase,
       v_counts_standings,true,0,'score_only',v_doc,v_run,'wbh_manual_game_results_v1',v_derivation);

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

  if v_inserted+v_validated<>41 then
    raise exception 'wbh: Liberty migration accounted for % inserted + % validated, expected 41',v_inserted,v_validated using errcode='P0001';
  end if;
  select count(distinct gt.game_id) into v_nyl_games
    from public.wbh_game_teams gt join public.wbh_games g using(game_id)
   where g.edition_id='wnba_2024' and gt.team_edition_id='te_new_york_liberty_2024';
  if v_nyl_games<>52 then raise exception 'wbh: canonical Liberty team-game count % != 52',v_nyl_games using errcode='P0001'; end if;

  update public.wbh_ingestion_runs set status='ok',counts=jsonb_build_object(
    'input_rows',41,'regular_games',40,'commissioners_cup_championship_games',1,
    'inserted_games',v_inserted,'validated_existing_games',v_validated,'canonical_liberty_team_games',52,
    'roster_stints_written',0,'player_game_stats_written',0) where run_id=v_run;
end $seed$;

commit;
