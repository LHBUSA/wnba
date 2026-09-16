-- Women's Basketball History — Atlanta Dream dated roster evidence, 2024-09-13
-- Official Atlanta Dream game notes roster table. Manual facts only; PDF body not stored.

begin;

do $seed$
declare
  v_run uuid;
  v_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_url text := 'https://cdn.wnba.com/sites/1611661330/2024/09/Dream-Game-Notes-Game-37-vs.-Washington-9.13.pdf';
  v_capture text := '2024-09-13|Atlanta Dream|dated roster|Laeticia Amihere|2001-07-10;Maya Caldwell|1998-12-15;Jordin Canada|1995-08-11;Tina Charles|1988-12-05;Nia Coffey|1995-06-11;Lorela Cubaj|1999-01-08;Allisha Gray|1995-01-12;Naz Hillmon|2000-04-05;Rhyne Howard|2000-04-29;Haley Jones|2001-05-23;Cheyenne Parker-Tyus|1992-08-22;Aerial Powers|1994-01-17';
  v_existing integer;
begin
  perform public.wbh_assert_ingestible('pbe_curation');
  select count(*) into v_existing from public.wbh_ingestion_runs where scope->>'dataset'='wnba_2024_atlanta_roster_20240913_v1' and status='ok';
  if v_existing > 0 then
    if (select count(*) from public.wbh_season_roster_evidence where citation_url=v_url and effective_on=date '2024-09-13')=12 then return; end if;
    raise exception 'wbh: Atlanta roster run exists but expected 12 observations are missing' using errcode='P0001';
  end if;

  insert into public.wbh_source_documents
    (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,content_type,byte_size,storage_state,transformation_version,notes)
  values
    ('pbe_curation','atlanta_dream_2024_09_13_roster',v_url,'GET',v_now,200,
     encode(extensions.digest(convert_to(v_capture,'UTF8'),'sha256'),'hex'),'text/plain',octet_length(v_capture),'hash_only','wbh_manual_roster_evidence_v1',
     'Manual factual transcription from official Atlanta Dream game notes roster table; PDF body not retained.')
  returning document_id into v_doc;

  insert into public.wbh_ingestion_runs
    (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)
  values
    ('pbe_curation','manual_public_roster_curation','1.0.0','wbh_manual_roster_evidence_v1','ingest',v_now,
     jsonb_build_object('dataset','wnba_2024_atlanta_roster_20240913_v1','edition_id','wnba_2024','expected_rows',12,'linked_rows',12,'roster_stints_written',0))
  returning run_id into v_run;

  insert into public.wbh_season_roster_evidence
    (evidence_id,edition_id,team_edition_id,person_id,source_player_name,source_birth_date,source_birth_precision,evidence_kind,effective_on,citation_url,citation_title,citation_publisher,identity_status,identity_tier,identity_confidence,identity_method,identity_note,source_document_id,ingestion_run_id,transformation_version,effective_at)
  values
    ('rse_'||substr(md5(v_url||'|Laeticia Amihere'),1,24),'wnba_2024','te_atlanta_dream_2024','gp_WJJ821K132PB','Laeticia Amihere','2001-07-10','day','dated_roster','2024-09-13',v_url,'Dream Game Notes — September 13, 2024','Atlanta Dream','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Maya Caldwell'),1,24),'wnba_2024','te_atlanta_dream_2024','gp_00QAEX307XMS','Maya Caldwell','1998-12-15','day','dated_roster','2024-09-13',v_url,'Dream Game Notes — September 13, 2024','Atlanta Dream','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Jordin Canada'),1,24),'wnba_2024','te_atlanta_dream_2024','gp_FDFRQ0T3BVBE','Jordin Canada','1995-08-11','day','dated_roster','2024-09-13',v_url,'Dream Game Notes — September 13, 2024','Atlanta Dream','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Tina Charles'),1,24),'wnba_2024','te_atlanta_dream_2024','gp_0VCETH42ZJ5N','Tina Charles','1988-12-05','day','dated_roster','2024-09-13',v_url,'Dream Game Notes — September 13, 2024','Atlanta Dream','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Nia Coffey'),1,24),'wnba_2024','te_atlanta_dream_2024','gp_JT3DR5GM3D51','Nia Coffey','1995-06-11','day','dated_roster','2024-09-13',v_url,'Dream Game Notes — September 13, 2024','Atlanta Dream','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Lorela Cubaj'),1,24),'wnba_2024','te_atlanta_dream_2024','gp_RAYFNHCW10Z7','Lorela Cubaj','1999-01-08','day','dated_roster','2024-09-13',v_url,'Dream Game Notes — September 13, 2024','Atlanta Dream','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB; using the alphabetical roster DOB printed in these notes.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Allisha Gray'),1,24),'wnba_2024','te_atlanta_dream_2024','gp_51FMYE71XSE7','Allisha Gray','1995-01-12','day','dated_roster','2024-09-13',v_url,'Dream Game Notes — September 13, 2024','Atlanta Dream','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Naz Hillmon'),1,24),'wnba_2024','te_atlanta_dream_2024','gp_YYV84ZYFN5PT','Naz Hillmon','2000-04-05','day','dated_roster','2024-09-13',v_url,'Dream Game Notes — September 13, 2024','Atlanta Dream','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Rhyne Howard'),1,24),'wnba_2024','te_atlanta_dream_2024','gp_D47R92459TNK','Rhyne Howard','2000-04-29','day','dated_roster','2024-09-13',v_url,'Dream Game Notes — September 13, 2024','Atlanta Dream','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Haley Jones'),1,24),'wnba_2024','te_atlanta_dream_2024','gp_EJE6QAWS9WNS','Haley Jones','2001-05-23','day','dated_roster','2024-09-13',v_url,'Dream Game Notes — September 13, 2024','Atlanta Dream','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Cheyenne Parker-Tyus'),1,24),'wnba_2024','te_atlanta_dream_2024','gp_0X0V8YD19HE6','Cheyenne Parker-Tyus','1992-08-22','day','dated_roster','2024-09-13',v_url,'Dream Game Notes — September 13, 2024','Atlanta Dream','linked','T3',0.99,'manual_name_dob_match','Official 2024 hyphenated surname; canonical label at capture was Cheyenne Parker; DOB exact.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-13T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Aerial Powers'),1,24),'wnba_2024','te_atlanta_dream_2024','gp_JJME03VDFBVB','Aerial Powers','1994-01-17','day','dated_roster','2024-09-13',v_url,'Dream Game Notes — September 13, 2024','Atlanta Dream','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-09-13T00:00:00Z');

  if (select count(*) from public.wbh_season_roster_evidence where citation_url=v_url and effective_on=date '2024-09-13')<>12 then
    raise exception 'wbh: Atlanta roster evidence insert did not produce 12 rows' using errcode='P0001';
  end if;
  update public.wbh_ingestion_runs set status='ok',counts=jsonb_build_object('rows',12,'linked',12,'conflict',0,'unresolved',0,'teams',1,'roster_stints_written',0) where run_id=v_run;
end $seed$;

commit;
