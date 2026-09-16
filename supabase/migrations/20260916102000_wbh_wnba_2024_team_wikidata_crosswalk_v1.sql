-- PropBetEdge — Women's Basketball History
-- 2024 WNBA team -> Wikidata CC0 crosswalk v1.
--
-- Manifest:
--   data/wbh/manifests/wnba-2024-team-wikidata-crosswalk-v1.json
--   commit 5443edb6a812655ba7d9abcc19a5f7f2078501d6
--
-- This migration records only 12 exact team QID aliases. It does not ingest Wikipedia prose,
-- WNBA stats, ESPN data, rosters, box scores or play-by-play. Each source-document hash covers a
-- normalized manual capture tuple whose format is declared in the manifest.

begin;

do $seed$
declare
  v_run uuid;
  v_existing integer;
  v_expected integer;
begin
  perform public.wbh_assert_ingestible('wikidata');

  select count(*) into v_expected
    from public.wbh_teams
   where team_id in (
     'tm_atlanta_dream','tm_chicago_sky','tm_connecticut_sun','tm_dallas_wings',
     'tm_indiana_fever','tm_las_vegas_aces','tm_los_angeles_sparks','tm_minnesota_lynx',
     'tm_new_york_liberty','tm_phoenix_mercury','tm_seattle_storm','tm_washington_mystics'
   );
  if v_expected <> 12 then
    raise exception 'wbh: expected 12 canonical 2024 WNBA teams before Wikidata crosswalk, found %', v_expected
      using errcode = 'P0001';
  end if;

  select count(*) into v_existing
    from public.wbh_entity_source_ids
   where entity_type = 'team'
     and source_id = 'wikidata'
     and status = 'linked'
     and entity_id in (
       'tm_atlanta_dream','tm_chicago_sky','tm_connecticut_sun','tm_dallas_wings',
       'tm_indiana_fever','tm_las_vegas_aces','tm_los_angeles_sparks','tm_minnesota_lynx',
       'tm_new_york_liberty','tm_phoenix_mercury','tm_seattle_storm','tm_washington_mystics'
     );

  if v_existing = 12 then
    return;
  elsif v_existing <> 0 then
    raise exception 'wbh: partial Wikidata team crosswalk already exists (%/12 linked); refusing to guess', v_existing
      using errcode = 'P0001';
  end if;

  create temporary table _wbh_team_wd (
    team_id text primary key,
    label text not null,
    qid text not null unique,
    url text not null,
    content_sha256 text not null,
    byte_size integer not null,
    document_id uuid not null default gen_random_uuid()
  ) on commit drop;

  insert into _wbh_team_wd (team_id, label, qid, url, content_sha256, byte_size) values
    ('tm_atlanta_dream',      'Atlanta Dream',      'Q756160',  'https://www.wikidata.org/wiki/Q756160',  '3b14d6017b2e48fbb77133db77f84e8be3ee62a44caae39d90a38cc7e6f316b6', 87),
    ('tm_chicago_sky',        'Chicago Sky',        'Q796358',  'https://www.wikidata.org/wiki/Q796358',  'f0cfa037f40489ee9159107b7177ffbac5b3479834362e47a6f209d47c8fe570', 85),
    ('tm_connecticut_sun',    'Connecticut Sun',    'Q1126243', 'https://www.wikidata.org/wiki/Q1126243', 'c2f192264f1f524b5d1e1bf791e9d64a81c56dcac3dbe3f7bd1dd16240d42c8c', 91),
    ('tm_dallas_wings',       'Dallas Wings',       'Q21334944','https://www.wikidata.org/wiki/Q21334944','b45b98bde7386374361c81d5b1705197dbe91aff24604c55a27adc4ecf72dd1a', 90),
    ('tm_indiana_fever',      'Indiana Fever',      'Q1631017', 'https://www.wikidata.org/wiki/Q1631017', 'b30d2749a85c1c687157288e51fcfdbe38701ddf2e194eeea52e05968c62ade0', 89),
    ('tm_las_vegas_aces',     'Las Vegas Aces',     'Q42333021','https://www.wikidata.org/wiki/Q42333021','bbe64bc80577debcab8785f358254bacbea8abbd8a40c6a384a200ec6c77cdd9', 92),
    ('tm_los_angeles_sparks', 'Los Angeles Sparks', 'Q1329633', 'https://www.wikidata.org/wiki/Q1329633', 'd773bb641a104c973cf2d0fc360c02a7f3f1e13697c4c4feeab21843fa5a5082', 94),
    ('tm_minnesota_lynx',     'Minnesota Lynx',     'Q1474850', 'https://www.wikidata.org/wiki/Q1474850', '878400729b73d6d91695b4d09e1162898c30ccfb56e4f1961b7b34621e97a73e', 90),
    ('tm_new_york_liberty',   'New York Liberty',   'Q974705',  'https://www.wikidata.org/wiki/Q974705',  'de22e8e1ca26c03f570c34c2907e8580c466861ea0320e8b9fae90f613ace30e', 90),
    ('tm_phoenix_mercury',    'Phoenix Mercury',    'Q1274643', 'https://www.wikidata.org/wiki/Q1274643', '4f7d01021c22119014c367d4040ce653b1912e49eb9bdcbf9fc9da9ffaf4f808', 91),
    ('tm_seattle_storm',      'Seattle Storm',      'Q1544869', 'https://www.wikidata.org/wiki/Q1544869', 'b53225d7adeea7842baffaeea5839591972857463d6c4b8d66bb24cb5a2ae897', 89),
    ('tm_washington_mystics', 'Washington Mystics', 'Q1465192', 'https://www.wikidata.org/wiki/Q1465192', '62816a05ea074c1c9c44d933799193855fae413402f2770ce7ec601a3197574e', 94);

  insert into public.wbh_source_documents
    (document_id, source_id, source_record_id, request_url, request_method, retrieved_at, http_status,
     content_sha256, content_type, byte_size, storage_state, rights_state_at_capture,
     transformation_version, notes)
  select document_id, 'wikidata', qid, url, 'GET', clock_timestamp(), 200,
         content_sha256, 'text/plain; charset=utf-8', byte_size, 'hash_only', 'approved_commercial',
         'manual_web_capture_v1',
         'Hash covers normalized capture tuple from manifest, not raw Wikidata page bytes.'
    from _wbh_team_wd;

  insert into public.wbh_ingestion_runs
    (source_id, adapter_id, adapter_version, transformation_version, mode, as_of, scope)
  values
    ('wikidata', 'manual_qid_crosswalk', '1.0.0', 'wbh_wikidata_crosswalk_v1', 'ingest',
     clock_timestamp(),
     jsonb_build_object(
       'dataset', 'wnba_2024_team_wikidata_crosswalk_v1',
       'edition_id', 'wnba_2024',
       'manifest_commit', '5443edb6a812655ba7d9abcc19a5f7f2078501d6'
     ))
  returning run_id into v_run;

  insert into public.wbh_entity_source_ids
    (entity_type, entity_id, source_id, external_id, external_url, id_space, status, tier,
     confidence, method, evidence, reviewed_by, reviewed_at, source_document_id, ingestion_run_id,
     transformation_version)
  select
    'team', team_id, 'wikidata', qid, url, 'wikidata:QID', 'linked', 'T1',
    1.0, 'manual_exact_entity_page_review',
    jsonb_build_object(
      'label', label,
      'capture_sha256', content_sha256,
      'capture_format', 'wikidata-team-crosswalk-v1|<qid>|<label>|<url>\\n',
      'manifest', 'data/wbh/manifests/wnba-2024-team-wikidata-crosswalk-v1.json',
      'manifest_commit', '5443edb6a812655ba7d9abcc19a5f7f2078501d6'
    ),
    'propbetedge-history-review-2026-09-16', clock_timestamp(), document_id, v_run,
    'wbh_wikidata_crosswalk_v1'
  from _wbh_team_wd;

  update public.wbh_ingestion_runs
     set status = 'ok', counts = jsonb_build_object('team_qid_links', 12, 'source_documents', 12)
   where run_id = v_run;
end $seed$;

commit;
