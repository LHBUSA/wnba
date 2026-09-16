-- Women's Basketball History — Minnesota Lynx opening-night roster evidence, 2024-05-13
-- Manual factual transcription from Minnesota Lynx News Release; source body is not stored.

begin;

do $seed$
declare
  v_run uuid;
  v_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_url text := 'https://lynx.wnba.com/news/minnesota-lynx-finalize-2024-roster';
  v_capture text := '2024-05-13|Minnesota Lynx|opening roster|Bridget Carleton|1997-05-22;Napheesa Collier|1996-09-23;Olivia Époupa|1994-04-30;Natisha Hiedeman|1997-02-10;Dorka Juhász|1999-12-18;Sika Koné|2002-07-13;Kayla McBride|1992-06-25;Diamond Miller|2001-02-11;Alissa Pili|2001-06-08;Alanna Smith|1996-09-10;Taylor Soule|2000-01-05;Courtney Williams|1994-05-11;Cecilia Zandalasini|1996-03-16';
  v_existing integer;
begin
  perform public.wbh_assert_ingestible('pbe_curation');
  select count(*) into v_existing from public.wbh_ingestion_runs where scope->>'dataset'='wnba_2024_minnesota_roster_20240513_v1' and status='ok';
  if v_existing > 0 then
    if (select count(*) from public.wbh_season_roster_evidence where citation_url=v_url and effective_on=date '2024-05-13')=13 then return; end if;
    raise exception 'wbh: Minnesota roster run exists but expected 13 observations are missing' using errcode='P0001';
  end if;

  insert into public.wbh_source_documents
    (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,content_type,byte_size,storage_state,transformation_version,notes)
  values
    ('pbe_curation','minnesota_lynx_2024_05_13_opening_roster',v_url,'GET',v_now,200,
     encode(extensions.digest(convert_to(v_capture,'UTF8'),'sha256'),'hex'),'text/plain',octet_length(v_capture),'hash_only','wbh_manual_roster_evidence_v1',
     'Manual factual transcription from Minnesota Lynx 2024 roster news release; source body not retained. Dorka Juhász is listed temporarily suspended for overseas commitments.')
  returning document_id into v_doc;

  insert into public.wbh_ingestion_runs
    (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)
  values
    ('pbe_curation','manual_public_roster_curation','1.0.0','wbh_manual_roster_evidence_v1','ingest',v_now,
     jsonb_build_object('dataset','wnba_2024_minnesota_roster_20240513_v1','edition_id','wnba_2024','expected_rows',13,'linked_rows',13,'conflict_rows',0,'roster_stints_written',0))
  returning run_id into v_run;

  insert into public.wbh_season_roster_evidence
    (evidence_id,edition_id,team_edition_id,person_id,source_player_name,source_birth_date,source_birth_precision,evidence_kind,effective_on,citation_url,citation_title,citation_publisher,identity_status,identity_tier,identity_confidence,identity_method,identity_note,source_document_id,ingestion_run_id,transformation_version,effective_at)
  values
    ('rse_'||substr(md5(v_url||'|Bridget Carleton'),1,24),'wnba_2024','te_minnesota_lynx_2024','gp_MZCKZ2YJBRDH','Bridget Carleton','1997-05-22','day','opening_roster','2024-05-13',v_url,'Minnesota Lynx Finalize 2024 Roster','Minnesota Lynx','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Napheesa Collier'),1,24),'wnba_2024','te_minnesota_lynx_2024','gp_P9YD9H6BXNWY','Napheesa Collier','1996-09-23','day','opening_roster','2024-05-13',v_url,'Minnesota Lynx Finalize 2024 Roster','Minnesota Lynx','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Olivia Époupa'),1,24),'wnba_2024','te_minnesota_lynx_2024','gp_0XWEVHTKBR2F','Olivia Époupa','1994-04-30','day','opening_roster','2024-05-13',v_url,'Minnesota Lynx Finalize 2024 Roster','Minnesota Lynx','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Natisha Hiedeman'),1,24),'wnba_2024','te_minnesota_lynx_2024','gp_57WWZGYPAGJR','Natisha Hiedeman','1997-02-10','day','opening_roster','2024-05-13',v_url,'Minnesota Lynx Finalize 2024 Roster','Minnesota Lynx','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Dorka Juhász'),1,24),'wnba_2024','te_minnesota_lynx_2024','gp_HSWK58ED8TRY','Dorka Juhász','1999-12-18','day','opening_roster','2024-05-13',v_url,'Minnesota Lynx Finalize 2024 Roster','Minnesota Lynx','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB. Source marks temporarily suspended due to overseas commitments.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Sika Koné'),1,24),'wnba_2024','te_minnesota_lynx_2024','gp_N9XQY569P1QH','Sika Koné','2002-07-13','day','opening_roster','2024-05-13',v_url,'Minnesota Lynx Finalize 2024 Roster','Minnesota Lynx','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Kayla McBride'),1,24),'wnba_2024','te_minnesota_lynx_2024','gp_6C76FG5MCKV3','Kayla McBride','1992-06-25','day','opening_roster','2024-05-13',v_url,'Minnesota Lynx Finalize 2024 Roster','Minnesota Lynx','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Diamond Miller'),1,24),'wnba_2024','te_minnesota_lynx_2024','gp_AGHYR4HT3JY0','Diamond Miller','2001-02-11','day','opening_roster','2024-05-13',v_url,'Minnesota Lynx Finalize 2024 Roster','Minnesota Lynx','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Alissa Pili'),1,24),'wnba_2024','te_minnesota_lynx_2024','gp_7JPQVTE11MFD','Alissa Pili','2001-06-08','day','opening_roster','2024-05-13',v_url,'Minnesota Lynx Finalize 2024 Roster','Minnesota Lynx','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Alanna Smith'),1,24),'wnba_2024','te_minnesota_lynx_2024','gp_KZQ6RJQKCMQ5','Alanna Smith','1996-09-10','day','opening_roster','2024-05-13',v_url,'Minnesota Lynx Finalize 2024 Roster','Minnesota Lynx','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Taylor Soule'),1,24),'wnba_2024','te_minnesota_lynx_2024','gp_62CN3J88VNW6','Taylor Soule','2000-01-05','day','opening_roster','2024-05-13',v_url,'Minnesota Lynx Finalize 2024 Roster','Minnesota Lynx','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Courtney Williams'),1,24),'wnba_2024','te_minnesota_lynx_2024','gp_EJ60794J1N3R','Courtney Williams','1994-05-11','day','opening_roster','2024-05-13',v_url,'Minnesota Lynx Finalize 2024 Roster','Minnesota Lynx','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Cecilia Zandalasini'),1,24),'wnba_2024','te_minnesota_lynx_2024','gp_NCXR42QDKEEK','Cecilia Zandalasini','1996-03-16','day','opening_roster','2024-05-13',v_url,'Minnesota Lynx Finalize 2024 Roster','Minnesota Lynx','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z');

  if (select count(*) from public.wbh_season_roster_evidence where citation_url=v_url and effective_on=date '2024-05-13')<>13 then
    raise exception 'wbh: Minnesota roster evidence insert did not produce 13 rows' using errcode='P0001';
  end if;
  update public.wbh_ingestion_runs set status='ok',counts=jsonb_build_object('rows',13,'linked',13,'conflict',0,'unresolved',0,'teams',1,'roster_stints_written',0) where run_id=v_run;
end $seed$;

commit;
