-- Women's Basketball History — Washington Mystics dated roster evidence, 2024-05-19
-- Manual factual transcription from official Mystics game notes; source body is not stored.

begin;

do $seed$
declare
  v_run uuid;
  v_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_url text := 'https://cdn.wnba.com/sites/1611661322/2024/05/WAS.SEA-05.19.24-1.pdf';
  v_capture text := '2024-05-19|Washington Mystics|dated roster|Ariel Atkins|1996-07-30;Shakira Austin|2000-07-25;Stefanie Dolson|1992-01-08;Aaliyah Edwards|2002-07-09;Emily Engstler|2000-05-01;Myisha Hines-Allen|1996-05-30;Jade Melbourne|2002-08-18;DiDi Richards|1999-02-08;Karlie Samuelson|1995-05-10;Brittney Sykes|1994-02-07;Julie Vanloo|1993-02-10;Shatori Walker-Kimbrough|1995-05-18';
  v_existing integer;
begin
  perform public.wbh_assert_ingestible('pbe_curation');
  select count(*) into v_existing from public.wbh_ingestion_runs where scope->>'dataset'='wnba_2024_washington_roster_20240519_v1' and status='ok';
  if v_existing > 0 then
    if (select count(*) from public.wbh_season_roster_evidence where citation_url=v_url and effective_on=date '2024-05-19')=12 then return; end if;
    raise exception 'wbh: Washington roster run exists but expected 12 observations are missing' using errcode='P0001';
  end if;

  insert into public.wbh_source_documents
    (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,content_type,byte_size,storage_state,transformation_version,notes)
  values
    ('pbe_curation','washington_mystics_2024_05_19_roster',v_url,'GET',v_now,200,
     encode(extensions.digest(convert_to(v_capture,'UTF8'),'sha256'),'hex'),'text/plain',octet_length(v_capture),'hash_only','wbh_manual_roster_evidence_v1',
     'Manual factual transcription from official Washington Mystics May 19, 2024 game notes roster table; source body not retained.')
  returning document_id into v_doc;

  insert into public.wbh_ingestion_runs
    (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)
  values
    ('pbe_curation','manual_public_roster_curation','1.0.0','wbh_manual_roster_evidence_v1','ingest',v_now,
     jsonb_build_object('dataset','wnba_2024_washington_roster_20240519_v1','edition_id','wnba_2024','expected_rows',12,'linked_rows',12,'conflict_rows',0,'roster_stints_written',0))
  returning run_id into v_run;

  insert into public.wbh_season_roster_evidence
    (evidence_id,edition_id,team_edition_id,person_id,source_player_name,source_birth_date,source_birth_precision,evidence_kind,effective_on,citation_url,citation_title,citation_publisher,identity_status,identity_tier,identity_confidence,identity_method,identity_note,source_document_id,ingestion_run_id,transformation_version,effective_at)
  values
    ('rse_'||substr(md5(v_url||'|Ariel Atkins'),1,24),'wnba_2024','te_washington_mystics_2024','gp_V7YGFB1WMS59','Ariel Atkins','1996-07-30','day','dated_roster','2024-05-19',v_url,'Mystics 2024 Game Notes vs. Seattle Storm — May 19, 2024','Washington Mystics','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-19T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Shakira Austin'),1,24),'wnba_2024','te_washington_mystics_2024','gp_H1PATFENBYJD','Shakira Austin','2000-07-25','day','dated_roster','2024-05-19',v_url,'Mystics 2024 Game Notes vs. Seattle Storm — May 19, 2024','Washington Mystics','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-19T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Stefanie Dolson'),1,24),'wnba_2024','te_washington_mystics_2024','gp_BFQABMTDDVD3','Stefanie Dolson','1992-01-08','day','dated_roster','2024-05-19',v_url,'Mystics 2024 Game Notes vs. Seattle Storm — May 19, 2024','Washington Mystics','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-19T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Aaliyah Edwards'),1,24),'wnba_2024','te_washington_mystics_2024','gp_ZETPF1BJGRS7','Aaliyah Edwards','2002-07-09','day','dated_roster','2024-05-19',v_url,'Mystics 2024 Game Notes vs. Seattle Storm — May 19, 2024','Washington Mystics','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-19T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Emily Engstler'),1,24),'wnba_2024','te_washington_mystics_2024','gp_041RKA47TMBK','Emily Engstler','2000-05-01','day','dated_roster','2024-05-19',v_url,'Mystics 2024 Game Notes vs. Seattle Storm — May 19, 2024','Washington Mystics','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB; exact name resolves same-DOB ambiguity.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-19T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Myisha Hines-Allen'),1,24),'wnba_2024','te_washington_mystics_2024','gp_99J6GA4E6CQG','Myisha Hines-Allen','1996-05-30','day','dated_roster','2024-05-19',v_url,'Mystics 2024 Game Notes vs. Seattle Storm — May 19, 2024','Washington Mystics','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-19T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Jade Melbourne'),1,24),'wnba_2024','te_washington_mystics_2024','gp_JGPYVVNGP3DQ','Jade Melbourne','2002-08-18','day','dated_roster','2024-05-19',v_url,'Mystics 2024 Game Notes vs. Seattle Storm — May 19, 2024','Washington Mystics','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-19T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|DiDi Richards'),1,24),'wnba_2024','te_washington_mystics_2024','gp_G1CPR3ZNANKG','DiDi Richards','1999-02-08','day','dated_roster','2024-05-19',v_url,'Mystics 2024 Game Notes vs. Seattle Storm — May 19, 2024','Washington Mystics','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-19T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Karlie Samuelson'),1,24),'wnba_2024','te_washington_mystics_2024','gp_XEZEPQ5B2P6J','Karlie Samuelson','1995-05-10','day','dated_roster','2024-05-19',v_url,'Mystics 2024 Game Notes vs. Seattle Storm — May 19, 2024','Washington Mystics','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-19T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Brittney Sykes'),1,24),'wnba_2024','te_washington_mystics_2024','gp_SACKCTRG08DZ','Brittney Sykes','1994-02-07','day','dated_roster','2024-05-19',v_url,'Mystics 2024 Game Notes vs. Seattle Storm — May 19, 2024','Washington Mystics','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-19T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Julie Vanloo'),1,24),'wnba_2024','te_washington_mystics_2024','gp_XPTM2044EFDW','Julie Vanloo','1993-02-10','day','dated_roster','2024-05-19',v_url,'Mystics 2024 Game Notes vs. Seattle Storm — May 19, 2024','Washington Mystics','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-19T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Shatori Walker-Kimbrough'),1,24),'wnba_2024','te_washington_mystics_2024','gp_XKVJ13NZDVE7','Shatori Walker-Kimbrough','1995-05-18','day','dated_roster','2024-05-19',v_url,'Mystics 2024 Game Notes vs. Seattle Storm — May 19, 2024','Washington Mystics','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-19T00:00:00Z');

  if (select count(*) from public.wbh_season_roster_evidence where citation_url=v_url and effective_on=date '2024-05-19')<>12 then
    raise exception 'wbh: Washington roster evidence insert did not produce 12 rows' using errcode='P0001';
  end if;
  update public.wbh_ingestion_runs set status='ok',counts=jsonb_build_object('rows',12,'linked',12,'conflict',0,'unresolved',0,'teams',1,'roster_stints_written',0) where run_id=v_run;
end $seed$;

commit;
