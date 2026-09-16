-- Women's Basketball History — Seattle Storm dated roster evidence, 2024-08-16
-- Official Seattle Storm game notes, roster table on page 2. Manual facts only; PDF body not stored.

begin;

do $seed$
declare
  v_run uuid;
  v_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_url text := 'https://cdn.wnba.com/sites/1611661330/2024/08/SEA-Game-Notes-1.pdf';
  v_capture text := '2024-08-16|Seattle Storm|dated roster|Nika Muhl|2001-04-09;Kiana Williams|1999-04-09;Nneka Ogwumike|1990-07-02;Skylar Diggins-Smith|1990-08-02;Joyner Holmes|1998-02-22;Ezi Magbegor|1999-08-13;Mercedes Russell|1995-07-27;Jordan Horston|2001-05-21;Jewell Loyd|1993-10-05;Sami Whitcomb|1988-07-20;Victoria Vivians|1994-11-17';
  v_existing integer;
begin
  perform public.wbh_assert_ingestible('pbe_curation');
  select count(*) into v_existing from public.wbh_ingestion_runs where scope->>'dataset'='wnba_2024_seattle_roster_20240816_v1' and status='ok';
  if v_existing > 0 then
    if (select count(*) from public.wbh_season_roster_evidence where citation_url=v_url and effective_on=date '2024-08-16')=11 then return; end if;
    raise exception 'wbh: Seattle roster run exists but expected 11 observations are missing' using errcode='P0001';
  end if;

  insert into public.wbh_source_documents
    (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,content_type,byte_size,storage_state,transformation_version,notes)
  values
    ('pbe_curation','seattle_storm_2024_08_16_roster',v_url,'GET',v_now,200,
     encode(extensions.digest(convert_to(v_capture,'UTF8'),'sha256'),'hex'),'text/plain',octet_length(v_capture),'hash_only','wbh_manual_roster_evidence_v1',
     'Manual factual transcription from official Seattle Storm game notes page 2; PDF body not retained.')
  returning document_id into v_doc;

  insert into public.wbh_ingestion_runs
    (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)
  values
    ('pbe_curation','manual_public_roster_curation','1.0.0','wbh_manual_roster_evidence_v1','ingest',v_now,
     jsonb_build_object('dataset','wnba_2024_seattle_roster_20240816_v1','edition_id','wnba_2024','expected_rows',11,'linked_rows',11,'roster_stints_written',0))
  returning run_id into v_run;

  insert into public.wbh_season_roster_evidence
    (evidence_id,edition_id,team_edition_id,person_id,source_player_name,source_birth_date,source_birth_precision,evidence_kind,effective_on,citation_url,citation_title,citation_publisher,identity_status,identity_tier,identity_confidence,identity_method,identity_note,source_document_id,ingestion_run_id,transformation_version,effective_at)
  values
    ('rse_'||substr(md5(v_url||'|Nika Muhl'),1,24),'wnba_2024','te_seattle_storm_2024','gp_V21PGWDBW4C3','Nika Mühl','2001-04-09','day','dated_roster','2024-08-16',v_url,'Seattle Storm at Atlanta Dream Game Notes — August 16, 2024','Seattle Storm','linked','T3',1.0,'manual_name_dob_match','Exact DOB and accent-normalized name.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-08-16T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Kiana Williams'),1,24),'wnba_2024','te_seattle_storm_2024','gp_TR3CWZBC443M','Kiana Williams','1999-04-09','day','dated_roster','2024-08-16',v_url,'Seattle Storm at Atlanta Dream Game Notes — August 16, 2024','Seattle Storm','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-08-16T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Nneka Ogwumike'),1,24),'wnba_2024','te_seattle_storm_2024','gp_VJEKHGHVXC2K','Nneka Ogwumike','1990-07-02','day','dated_roster','2024-08-16',v_url,'Seattle Storm at Atlanta Dream Game Notes — August 16, 2024','Seattle Storm','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-08-16T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Skylar Diggins-Smith'),1,24),'wnba_2024','te_seattle_storm_2024','gp_Y6VX1T2VMS77','Skylar Diggins-Smith','1990-08-02','day','dated_roster','2024-08-16',v_url,'Seattle Storm at Atlanta Dream Game Notes — August 16, 2024','Seattle Storm','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-08-16T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Joyner Holmes'),1,24),'wnba_2024','te_seattle_storm_2024','gp_MM4H6M65J328','Joyner Holmes','1998-02-22','day','dated_roster','2024-08-16',v_url,'Seattle Storm at Atlanta Dream Game Notes — August 16, 2024','Seattle Storm','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-08-16T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Ezi Magbegor'),1,24),'wnba_2024','te_seattle_storm_2024','gp_QD9ZXJV1GXQS','Ezi Magbegor','1999-08-13','day','dated_roster','2024-08-16',v_url,'Seattle Storm at Atlanta Dream Game Notes — August 16, 2024','Seattle Storm','linked','T3',0.99,'manual_alias_dob_match','Canonical identity label is Eziyoda Magbegor; official short-name form Ezi Magbegor matches stored alias and exact DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-08-16T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Mercedes Russell'),1,24),'wnba_2024','te_seattle_storm_2024','gp_T4WG93AXFW6H','Mercedes Russell','1995-07-27','day','dated_roster','2024-08-16',v_url,'Seattle Storm at Atlanta Dream Game Notes — August 16, 2024','Seattle Storm','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-08-16T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Jordan Horston'),1,24),'wnba_2024','te_seattle_storm_2024','gp_1MBY6JT7THQN','Jordan Horston','2001-05-21','day','dated_roster','2024-08-16',v_url,'Seattle Storm at Atlanta Dream Game Notes — August 16, 2024','Seattle Storm','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-08-16T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Jewell Loyd'),1,24),'wnba_2024','te_seattle_storm_2024','gp_TAZ8DDCYA3R9','Jewell Loyd','1993-10-05','day','dated_roster','2024-08-16',v_url,'Seattle Storm at Atlanta Dream Game Notes — August 16, 2024','Seattle Storm','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-08-16T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Sami Whitcomb'),1,24),'wnba_2024','te_seattle_storm_2024','gp_KVTKPG3853V2','Sami Whitcomb','1988-07-20','day','dated_roster','2024-08-16',v_url,'Seattle Storm at Atlanta Dream Game Notes — August 16, 2024','Seattle Storm','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-08-16T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Victoria Vivians'),1,24),'wnba_2024','te_seattle_storm_2024','gp_CV1446KY04XR','Victoria Vivians','1994-11-17','day','dated_roster','2024-08-16',v_url,'Seattle Storm at Atlanta Dream Game Notes — August 16, 2024','Seattle Storm','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-08-16T00:00:00Z');

  if (select count(*) from public.wbh_season_roster_evidence where citation_url=v_url and effective_on=date '2024-08-16')<>11 then
    raise exception 'wbh: Seattle roster evidence insert did not produce 11 rows' using errcode='P0001';
  end if;
  update public.wbh_ingestion_runs set status='ok',counts=jsonb_build_object('rows',11,'linked',11,'conflict',0,'unresolved',0,'teams',1,'roster_stints_written',0) where run_id=v_run;
end $seed$;

commit;
