-- Women's Basketball History — 2024 WNBA game results slice v1
-- Official Indiana Fever game notes dated 2024-08-26 contain the club's completed
-- regular-season results through 2024-08-24. Manual factual transcription only.
-- PDF body is not retained; a hash of the normalized fact capture is retained.
--
-- Canonical scope: score-only game/result facts. No box score, PBP, player appearance,
-- roster-stint, odds, ESPN/Basketball-Reference, or wnba_pbe_* writes.

begin;

do $seed$
declare
  v_run uuid;
  v_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_url constant text := 'https://cdn.wnba.com/sites/1611661330/2024/08/vs.-ATL-8_26_24.pdf';
  v_dataset constant text := 'wnba_2024_indiana_results_through_20240824_v1';
  v_derivation constant text := 'manual_curation:official_indiana_fever_game_notes:2024-08-26';
  v_rows constant jsonb := '[{"game_date":"2024-05-14","away":"Indiana Fever","away_code":"ind","away_points":71,"home":"Connecticut Sun","home_code":"con","home_points":92},{"game_date":"2024-05-16","away":"New York Liberty","away_code":"nyl","away_points":102,"home":"Indiana Fever","home_code":"ind","home_points":66},{"game_date":"2024-05-18","away":"Indiana Fever","away_code":"ind","away_points":80,"home":"New York Liberty","home_code":"nyl","home_points":91},{"game_date":"2024-05-20","away":"Connecticut Sun","away_code":"con","away_points":88,"home":"Indiana Fever","home_code":"ind","home_points":84},{"game_date":"2024-05-22","away":"Indiana Fever","away_code":"ind","away_points":83,"home":"Seattle Storm","home_code":"sea","home_points":85},{"game_date":"2024-05-24","away":"Indiana Fever","away_code":"ind","away_points":78,"home":"Los Angeles Sparks","home_code":"las","home_points":73},{"game_date":"2024-05-25","away":"Indiana Fever","away_code":"ind","away_points":80,"home":"Las Vegas Aces","home_code":"lva","home_points":99},{"game_date":"2024-05-28","away":"Los Angeles Sparks","away_code":"las","away_points":88,"home":"Indiana Fever","home_code":"ind","home_points":82},{"game_date":"2024-05-30","away":"Seattle Storm","away_code":"sea","away_points":103,"home":"Indiana Fever","home_code":"ind","home_points":88},{"game_date":"2024-06-01","away":"Chicago Sky","away_code":"chi","away_points":70,"home":"Indiana Fever","home_code":"ind","home_points":71},{"game_date":"2024-06-02","away":"Indiana Fever","away_code":"ind","away_points":68,"home":"New York Liberty","home_code":"nyl","home_points":104},{"game_date":"2024-06-07","away":"Indiana Fever","away_code":"ind","away_points":85,"home":"Washington Mystics","home_code":"was","home_points":83},{"game_date":"2024-06-10","away":"Indiana Fever","away_code":"ind","away_points":72,"home":"Connecticut Sun","home_code":"con","home_points":89},{"game_date":"2024-06-13","away":"Atlanta Dream","away_code":"atl","away_points":84,"home":"Indiana Fever","home_code":"ind","home_points":91},{"game_date":"2024-06-16","away":"Chicago Sky","away_code":"chi","away_points":83,"home":"Indiana Fever","home_code":"ind","home_points":91},{"game_date":"2024-06-19","away":"Washington Mystics","away_code":"was","away_points":81,"home":"Indiana Fever","home_code":"ind","home_points":88},{"game_date":"2024-06-21","away":"Indiana Fever","away_code":"ind","away_points":91,"home":"Atlanta Dream","home_code":"atl","home_points":79},{"game_date":"2024-06-23","away":"Indiana Fever","away_code":"ind","away_points":87,"home":"Chicago Sky","home_code":"chi","home_points":88},{"game_date":"2024-06-27","away":"Indiana Fever","away_code":"ind","away_points":77,"home":"Seattle Storm","home_code":"sea","home_points":89},{"game_date":"2024-06-30","away":"Indiana Fever","away_code":"ind","away_points":88,"home":"Phoenix Mercury","home_code":"phx","home_points":82},{"game_date":"2024-07-02","away":"Indiana Fever","away_code":"ind","away_points":69,"home":"Las Vegas Aces","home_code":"lva","home_points":88},{"game_date":"2024-07-06","away":"New York Liberty","away_code":"nyl","away_points":78,"home":"Indiana Fever","home_code":"ind","home_points":83},{"game_date":"2024-07-10","away":"Washington Mystics","away_code":"was","away_points":89,"home":"Indiana Fever","home_code":"ind","home_points":84},{"game_date":"2024-07-12","away":"Phoenix Mercury","away_code":"phx","away_points":86,"home":"Indiana Fever","home_code":"ind","home_points":95},{"game_date":"2024-07-14","away":"Indiana Fever","away_code":"ind","away_points":81,"home":"Minnesota Lynx","home_code":"min","home_points":74},{"game_date":"2024-07-17","away":"Indiana Fever","away_code":"ind","away_points":93,"home":"Dallas Wings","home_code":"dal","home_points":101},{"game_date":"2024-08-16","away":"Phoenix Mercury","away_code":"phx","away_points":89,"home":"Indiana Fever","home_code":"ind","home_points":98},{"game_date":"2024-08-18","away":"Seattle Storm","away_code":"sea","away_points":75,"home":"Indiana Fever","home_code":"ind","home_points":92},{"game_date":"2024-08-24","away":"Indiana Fever","away_code":"ind","away_points":80,"home":"Minnesota Lynx","home_code":"min","home_points":90}]'::jsonb;
  v_capture text;
  v_existing integer;
  v_games integer;
  v_teams integer;
begin
  perform public.wbh_assert_ingestible('pbe_curation');
  v_capture := v_rows::text;

  select count(*) into v_existing
    from public.wbh_ingestion_runs
   where scope->>'dataset'=v_dataset and status='ok';

  if v_existing > 0 then
    select count(*) into v_games
      from public.wbh_games g
      join public.wbh_ingestion_runs r on r.run_id=g.ingestion_run_id
     where r.scope->>'dataset'=v_dataset;
    select count(*) into v_teams
      from public.wbh_game_teams gt
      join public.wbh_ingestion_runs r on r.run_id=gt.ingestion_run_id
     where r.scope->>'dataset'=v_dataset;
    if v_games=29 and v_teams=58 then return; end if;
    raise exception 'wbh: Indiana 2024 result slice exists but is incomplete (% games, % team rows)',
      v_games,v_teams using errcode='P0001';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(v_rows)
           as x(game_date date,away text,away_code text,away_points integer,
                home text,home_code text,home_points integer)
      join public.wbh_games g
        on g.game_id='gm_wnba_2024_'||to_char(x.game_date,'YYYYMMDD')||'_'||x.away_code||'_at_'||x.home_code
  ) then
    raise exception 'wbh: one or more deterministic 2024 game ids already exist; refusing implicit merge'
      using errcode='P0001';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(v_rows)
           as x(game_date date,away text,away_code text,away_points integer,
                home text,home_code text,home_points integer)
      left join public.wbh_team_editions a
        on a.edition_id='wnba_2024' and a.display_name=x.away
      left join public.wbh_team_editions h
        on h.edition_id='wnba_2024' and h.display_name=x.home
     where a.team_edition_id is null or h.team_edition_id is null
  ) then
    raise exception 'wbh: source row contains a team that is not canonicalized in wnba_2024'
      using errcode='P0001';
  end if;

  insert into public.wbh_source_documents
    (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,
     content_sha256,content_type,byte_size,storage_state,transformation_version,notes)
  values
    ('pbe_curation','indiana_fever_2024_results_through_20240824',v_url,'GET',v_now,200,
     encode(extensions.digest(convert_to(v_capture,'UTF8'),'sha256'),'hex'),
     'application/json',octet_length(v_capture),'hash_only','wbh_manual_game_results_v1',
     'Manual factual transcription from official Indiana Fever game notes dated 2024-08-26; source PDF body not retained.')
  returning document_id into v_doc;

  insert into public.wbh_ingestion_runs
    (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)
  values
    ('pbe_curation','manual_public_game_curation','1.0.0','wbh_manual_game_results_v1',
     'ingest',v_now,
     jsonb_build_object('dataset',v_dataset,'edition_id','wnba_2024','expected_games',29,
                        'expected_game_team_rows',58,'completeness','score_only',
                        'through_local_date','2024-08-24','roster_stints_written',0,
                        'player_game_stats_written',0))
  returning run_id into v_run;

  insert into public.wbh_games
    (game_id,edition_id,stage_id,competition_id,local_date,status,game_type,season_phase,
     counts_for_standings,counts_for_stats,completeness,
     source_document_id,ingestion_run_id,transformation_version,derivation)
  select
    'gm_wnba_2024_'||to_char(x.game_date,'YYYYMMDD')||'_'||x.away_code||'_at_'||x.home_code,
    'wnba_2024','wnba_2024_regular_season','wnba',x.game_date,'final','regular','regular_season',
    true,true,'score_only',v_doc,v_run,'wbh_manual_game_results_v1',v_derivation
  from jsonb_to_recordset(v_rows)
       as x(game_date date,away text,away_code text,away_points integer,
            home text,home_code text,home_points integer);

  insert into public.wbh_game_teams
    (game_id,team_edition_id,side,points,result,
     source_document_id,ingestion_run_id,transformation_version,derivation)
  select
    'gm_wnba_2024_'||to_char(x.game_date,'YYYYMMDD')||'_'||x.away_code||'_at_'||x.home_code,
    te.team_edition_id,'away',x.away_points,
    case when x.away_points>x.home_points then 'win' else 'loss' end,
    v_doc,v_run,'wbh_manual_game_results_v1',v_derivation
  from jsonb_to_recordset(v_rows)
       as x(game_date date,away text,away_code text,away_points integer,
            home text,home_code text,home_points integer)
  join public.wbh_team_editions te on te.edition_id='wnba_2024' and te.display_name=x.away
  union all
  select
    'gm_wnba_2024_'||to_char(x.game_date,'YYYYMMDD')||'_'||x.away_code||'_at_'||x.home_code,
    te.team_edition_id,'home',x.home_points,
    case when x.home_points>x.away_points then 'win' else 'loss' end,
    v_doc,v_run,'wbh_manual_game_results_v1',v_derivation
  from jsonb_to_recordset(v_rows)
       as x(game_date date,away text,away_code text,away_points integer,
            home text,home_code text,home_points integer)
  join public.wbh_team_editions te on te.edition_id='wnba_2024' and te.display_name=x.home;

  select count(*) into v_games from public.wbh_games where ingestion_run_id=v_run;
  select count(*) into v_teams from public.wbh_game_teams where ingestion_run_id=v_run;

  if v_games<>29 or v_teams<>58 then
    raise exception 'wbh: Indiana result slice produced % games / % team rows; expected 29 / 58',
      v_games,v_teams using errcode='P0001';
  end if;

  if exists (
    select 1
      from public.wbh_games g
      join lateral (
        select count(*) as n,
               count(*) filter (where side='home') as homes,
               count(*) filter (where side='away') as aways,
               count(*) filter (where result='win') as wins,
               count(*) filter (where result='loss') as losses,
               count(*) filter (where points is null) as null_scores
          from public.wbh_game_teams gt where gt.game_id=g.game_id
      ) q on true
     where g.ingestion_run_id=v_run
       and (q.n<>2 or q.homes<>1 or q.aways<>1 or q.wins<>1 or q.losses<>1 or q.null_scores<>0)
  ) then
    raise exception 'wbh: one or more curated games failed the two-team/result completeness check'
      using errcode='P0001';
  end if;

  update public.wbh_ingestion_runs
     set status='ok',
         counts=jsonb_build_object('games',29,'game_team_rows',58,'final_games',29,
                                   'score_only_games',29,'roster_stints_written',0,
                                   'player_game_stats_written',0)
   where run_id=v_run;
end $seed$;

commit;
