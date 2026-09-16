-- Women's Basketball History — Indiana Fever opening-night roster evidence, 2024-05-13
-- Manual factual transcription from an Indiana Fever News Release syndicated verbatim by OurSports Central.
-- Source body is not retained; roster facts are linked by exact canonical name + DOB.

begin;

do $seed$
declare
  v_run uuid;
  v_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_url text := 'https://www.oursportscentral.com/services/releases/indiana-fever-announce-2024-opening-night-roster/n-6093821';
  v_capture text := '2024-05-13|Indiana Fever|opening roster|Grace Berger|1999-06-03;Aliyah Boston|2001-12-11;Caitlin Clark|2002-01-22;Damiris Dantas|1992-11-17;Temi Fagbenle|1992-09-08;Lexie Hull|1999-09-13;Kelsey Mitchell|1995-11-12;Katie Lou Samuelson|1997-06-13;Victaria Saxton|1999-11-10;NaLyssa Smith|2000-08-08;Celeste Taylor|2001-06-20;Kristy Wallace|1996-01-03;Erica Wheeler|1991-05-02';
  v_existing integer;
begin
  perform public.wbh_assert_ingestible('pbe_curation');
  select count(*) into v_existing from public.wbh_ingestion_runs where scope->>'dataset'='wnba_2024_indiana_roster_20240513_v1' and status='ok';
  if v_existing > 0 then
    if (select count(*) from public.wbh_season_roster_evidence where citation_url=v_url and effective_on=date '2024-05-13')=13 then return; end if;
    raise exception 'wbh: Indiana roster run exists but expected 13 observations are missing' using errcode='P0001';
  end if;

  insert into public.wbh_source_documents
    (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,content_type,byte_size,storage_state,transformation_version,notes)
  values
    ('pbe_curation','indiana_fever_2024_05_13_opening_roster',v_url,'GET',v_now,200,
     encode(extensions.digest(convert_to(v_capture,'UTF8'),'sha256'),'hex'),'text/plain',octet_length(v_capture),'hash_only','wbh_manual_roster_evidence_v1',
     'Manual factual transcription from Indiana Fever News Release syndicated by OurSports Central; source body not retained. Damiris Dantas is listed with contract temporarily suspended.')
  returning document_id into v_doc;

  insert into public.wbh_ingestion_runs
    (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)
  values
    ('pbe_curation','manual_public_roster_curation','1.0.0','wbh_manual_roster_evidence_v1','ingest',v_now,
     jsonb_build_object('dataset','wnba_2024_indiana_roster_20240513_v1','edition_id','wnba_2024','expected_rows',13,'linked_rows',13,'conflict_rows',0,'roster_stints_written',0))
  returning run_id into v_run;

  insert into public.wbh_season_roster_evidence
    (evidence_id,edition_id,team_edition_id,person_id,source_player_name,source_birth_date,source_birth_precision,evidence_kind,effective_on,citation_url,citation_title,citation_publisher,identity_status,identity_tier,identity_confidence,identity_method,identity_note,source_document_id,ingestion_run_id,transformation_version,effective_at)
  values
    ('rse_'||substr(md5(v_url||'|Grace Berger'),1,24),'wnba_2024','te_indiana_fever_2024','gp_594B6EF0PM92','Grace Berger','1999-06-03','day','opening_roster','2024-05-13',v_url,'Indiana Fever Announce 2024 Opening Night Roster','Indiana Fever News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Aliyah Boston'),1,24),'wnba_2024','te_indiana_fever_2024','gp_5TMQGFSA1MQ2','Aliyah Boston','2001-12-11','day','opening_roster','2024-05-13',v_url,'Indiana Fever Announce 2024 Opening Night Roster','Indiana Fever News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Caitlin Clark'),1,24),'wnba_2024','te_indiana_fever_2024','gp_GCH5JNMMKCTM','Caitlin Clark','2002-01-22','day','opening_roster','2024-05-13',v_url,'Indiana Fever Announce 2024 Opening Night Roster','Indiana Fever News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Damiris Dantas'),1,24),'wnba_2024','te_indiana_fever_2024','gp_YRDRB6A5GS6Q','Damiris Dantas','1992-11-17','day','opening_roster','2024-05-13',v_url,'Indiana Fever Announce 2024 Opening Night Roster','Indiana Fever News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB. Source marks contract temporarily suspended.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Temi Fagbenle'),1,24),'wnba_2024','te_indiana_fever_2024','gp_8RRWZA5QH73N','Temi Fagbenle','1992-09-08','day','opening_roster','2024-05-13',v_url,'Indiana Fever Announce 2024 Opening Night Roster','Indiana Fever News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Lexie Hull'),1,24),'wnba_2024','te_indiana_fever_2024','gp_ZEX5SPYRPKNF','Lexie Hull','1999-09-13','day','opening_roster','2024-05-13',v_url,'Indiana Fever Announce 2024 Opening Night Roster','Indiana Fever News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Kelsey Mitchell'),1,24),'wnba_2024','te_indiana_fever_2024','gp_XA61W4TVA75R','Kelsey Mitchell','1995-11-12','day','opening_roster','2024-05-13',v_url,'Indiana Fever Announce 2024 Opening Night Roster','Indiana Fever News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Katie Lou Samuelson'),1,24),'wnba_2024','te_indiana_fever_2024','gp_R6MNY1RTB53Y','Katie Lou Samuelson','1997-06-13','day','opening_roster','2024-05-13',v_url,'Indiana Fever Announce 2024 Opening Night Roster','Indiana Fever News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Victaria Saxton'),1,24),'wnba_2024','te_indiana_fever_2024','gp_ZNQNWVX0TMTJ','Victaria Saxton','1999-11-10','day','opening_roster','2024-05-13',v_url,'Indiana Fever Announce 2024 Opening Night Roster','Indiana Fever News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|NaLyssa Smith'),1,24),'wnba_2024','te_indiana_fever_2024','gp_AXJM5DB861ME','NaLyssa Smith','2000-08-08','day','opening_roster','2024-05-13',v_url,'Indiana Fever Announce 2024 Opening Night Roster','Indiana Fever News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Celeste Taylor'),1,24),'wnba_2024','te_indiana_fever_2024','gp_JBZT157PNR4W','Celeste Taylor','2001-06-20','day','opening_roster','2024-05-13',v_url,'Indiana Fever Announce 2024 Opening Night Roster','Indiana Fever News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Kristy Wallace'),1,24),'wnba_2024','te_indiana_fever_2024','gp_RWFHWTDTBG06','Kristy Wallace','1996-01-03','day','opening_roster','2024-05-13',v_url,'Indiana Fever Announce 2024 Opening Night Roster','Indiana Fever News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Erica Wheeler'),1,24),'wnba_2024','te_indiana_fever_2024','gp_48CDTQ7XT3XV','Erica Wheeler','1991-05-02','day','opening_roster','2024-05-13',v_url,'Indiana Fever Announce 2024 Opening Night Roster','Indiana Fever News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB; exact name resolves the same-DOB ambiguity in the global spine.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z');

  if (select count(*) from public.wbh_season_roster_evidence where citation_url=v_url and effective_on=date '2024-05-13')<>13 then
    raise exception 'wbh: Indiana roster evidence insert did not produce 13 rows' using errcode='P0001';
  end if;
  update public.wbh_ingestion_runs set status='ok',counts=jsonb_build_object('rows',13,'linked',13,'conflict',0,'unresolved',0,'teams',1,'roster_stints_written',0) where run_id=v_run;
end $seed$;

commit;
