-- Women's Basketball History — Phoenix Mercury dated roster evidence, 2024-09-03
-- Official Phoenix Mercury game notes roster table. Manual facts only; source body not stored.

begin;

do $seed$
declare
  v_run uuid;
  v_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_url text := 'https://cdn.wnba.com/sites/1611661330/2024/09/9.3.24-Mercury-Game-Notes-vs.-ATL.pdf';
  v_capture text := '2024-09-03|Phoenix Mercury|dated roster|Rebecca Allen|1992-11-06;Monique Billings|1996-05-02;Natasha Cloud|1992-02-22;Kahleah Copper|1994-08-28;Sophie Cunningham|1996-08-16;Brittney Griner|1990-10-18;Mikiah Herbert Harrigan|1998-08-21;Natasha Mack|1997-11-03;Charisma Osborne|2001-07-03;Diana Taurasi|1982-06-11;Celeste Taylor|2001-06-20';
  v_existing integer;
begin
  perform public.wbh_assert_ingestible('pbe_curation');
  select count(*) into v_existing from public.wbh_ingestion_runs where scope->>'dataset'='wnba_2024_phoenix_roster_20240903_v1' and status='ok';
  if v_existing > 0 then
    if (select count(*) from public.wbh_season_roster_evidence where citation_url=v_url and effective_on=date '2024-09-03')=11 then return; end if;
    raise exception 'wbh: Phoenix roster run exists but expected 11 observations are missing' using errcode='P0001';
  end if;

  insert into public.wbh_source_documents
    (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,content_type,byte_size,storage_state,transformation_version,notes)
  values
    ('pbe_curation','phoenix_mercury_2024_09_03_roster',v_url,'GET',v_now,200,
     encode(extensions.digest(convert_to(v_capture,'UTF8'),'sha256'),'hex'),'text/plain',octet_length(v_capture),'hash_only','wbh_manual_roster_evidence_v1',
     'Manual factual transcription from official Phoenix Mercury game notes roster table; source body not retained.')
  returning document_id into v_doc;

  insert into public.wbh_ingestion_runs
    (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)
  values
    ('pbe_curation','manual_public_roster_curation','1.0.0','wbh_manual_roster_evidence_v1','ingest',v_now,
     jsonb_build_object('dataset','wnba_2024_phoenix_roster_20240903_v1','edition_id','wnba_2024','expected_rows',11,'linked_rows',11,'roster_stints_written',0))
  returning run_id into v_run;

  insert into public.wbh_season_roster_evidence
    (evidence_id,edition_id,team_edition_id,person_id,source_player_name,source_birth_date,source_birth_precision,evidence_kind,effective_on,citation_url,citation_title,citation_publisher,identity_status,identity_tier,identity_confidence,identity_method,identity_note,source_document_id,ingestion_run_id,transformation_version,effective_at)
  values
    ('rse_'||substr(md5(v_url||'|Rebecca Allen'),1,24),'wnba_2024','te_phoenix_mercury_2024','gp_MSXRJVSDC3BR','Rebecca Allen','1992-11-06','day','dated_roster','2024-09-03',v_url,'Phoenix Mercury vs. Atlanta Dream Game Notes — September 3, 2024','Phoenix Mercury','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-03T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Monique Billings'),1,24),'wnba_2024','te_phoenix_mercury_2024','gp_R8HXQDKMQVZZ','Monique Billings','1996-05-02','day','dated_roster','2024-09-03',v_url,'Phoenix Mercury vs. Atlanta Dream Game Notes — September 3, 2024','Phoenix Mercury','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-03T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Natasha Cloud'),1,24),'wnba_2024','te_phoenix_mercury_2024','gp_JNEYHH7Y2YNJ','Natasha Cloud','1992-02-22','day','dated_roster','2024-09-03',v_url,'Phoenix Mercury vs. Atlanta Dream Game Notes — September 3, 2024','Phoenix Mercury','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-03T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Kahleah Copper'),1,24),'wnba_2024','te_phoenix_mercury_2024','gp_69THT6RXHZ8B','Kahleah Copper','1994-08-28','day','dated_roster','2024-09-03',v_url,'Phoenix Mercury vs. Atlanta Dream Game Notes — September 3, 2024','Phoenix Mercury','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-03T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Sophie Cunningham'),1,24),'wnba_2024','te_phoenix_mercury_2024','gp_2ASHPQD5MR30','Sophie Cunningham','1996-08-16','day','dated_roster','2024-09-03',v_url,'Phoenix Mercury vs. Atlanta Dream Game Notes — September 3, 2024','Phoenix Mercury','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-03T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Brittney Griner'),1,24),'wnba_2024','te_phoenix_mercury_2024','gp_RKGJSPF2F00Q','Brittney Griner','1990-10-18','day','dated_roster','2024-09-03',v_url,'Phoenix Mercury vs. Atlanta Dream Game Notes — September 3, 2024','Phoenix Mercury','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-03T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Mikiah Herbert Harrigan'),1,24),'wnba_2024','te_phoenix_mercury_2024','gp_RT8M4BCKH001','Mikiah Herbert Harrigan','1998-08-21','day','dated_roster','2024-09-03',v_url,'Phoenix Mercury vs. Atlanta Dream Game Notes — September 3, 2024','Phoenix Mercury','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-03T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Natasha Mack'),1,24),'wnba_2024','te_phoenix_mercury_2024','gp_4Z7JHGVW5ZXG','Natasha Mack','1997-11-03','day','dated_roster','2024-09-03',v_url,'Phoenix Mercury vs. Atlanta Dream Game Notes — September 3, 2024','Phoenix Mercury','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-03T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Charisma Osborne'),1,24),'wnba_2024','te_phoenix_mercury_2024','gp_HT49BZ01AJQB','Charisma Osborne','2001-07-03','day','dated_roster','2024-09-03',v_url,'Phoenix Mercury vs. Atlanta Dream Game Notes — September 3, 2024','Phoenix Mercury','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-03T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Diana Taurasi'),1,24),'wnba_2024','te_phoenix_mercury_2024','gp_QMS96S2JGFFV','Diana Taurasi','1982-06-11','day','dated_roster','2024-09-03',v_url,'Phoenix Mercury vs. Atlanta Dream Game Notes — September 3, 2024','Phoenix Mercury','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-03T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Celeste Taylor'),1,24),'wnba_2024','te_phoenix_mercury_2024','gp_JBZT157PNR4W','Celeste Taylor','2001-06-20','day','dated_roster','2024-09-03',v_url,'Phoenix Mercury vs. Atlanta Dream Game Notes — September 3, 2024','Phoenix Mercury','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-03T00:00:00Z');

  if (select count(*) from public.wbh_season_roster_evidence where citation_url=v_url and effective_on=date '2024-09-03')<>11 then
    raise exception 'wbh: Phoenix roster evidence insert did not produce 11 rows' using errcode='P0001';
  end if;
  update public.wbh_ingestion_runs set status='ok',counts=jsonb_build_object('rows',11,'linked',11,'conflict',0,'unresolved',0,'teams',1,'roster_stints_written',0) where run_id=v_run;
end $seed$;

commit;
