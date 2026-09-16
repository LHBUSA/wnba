-- Women's Basketball History — Chicago Sky dated roster evidence, 2024-05-18
-- Manual factual transcription from official Chicago Sky game notes; source body is not stored.

begin;

do $seed$
declare
  v_run uuid;
  v_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_url text := 'https://cdn.wnba.com/sites/1611661329/2024/05/CHI-GAME-NOTES-518.pdf';
  v_capture text := '2024-05-18|Chicago Sky|dated roster|Diamond DeShields|1996-08-01;Elizabeth Williams|1993-06-23;Kysre Gondrezick|1997-07-27;Marina Mabrey|1996-09-14;Angel Reese|2002-05-06;Chennedy Carter|1998-11-14;Kamilla Cardoso|2001-04-30;Dana Evans|1998-08-01;Michaela Onyenwere|1999-08-10;Lindsay Allen|1995-03-20;Isabelle Harrison|1993-09-27;Brianna Turner|1996-07-05';
  v_existing integer;
begin
  perform public.wbh_assert_ingestible('pbe_curation');
  select count(*) into v_existing from public.wbh_ingestion_runs where scope->>'dataset'='wnba_2024_chicago_roster_20240518_v1' and status='ok';
  if v_existing > 0 then
    if (select count(*) from public.wbh_season_roster_evidence where citation_url=v_url and effective_on=date '2024-05-18')=12 then return; end if;
    raise exception 'wbh: Chicago roster run exists but expected 12 observations are missing' using errcode='P0001';
  end if;

  insert into public.wbh_source_documents
    (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,content_type,byte_size,storage_state,transformation_version,notes)
  values
    ('pbe_curation','chicago_sky_2024_05_18_roster',v_url,'GET',v_now,200,
     encode(extensions.digest(convert_to(v_capture,'UTF8'),'sha256'),'hex'),'text/plain',octet_length(v_capture),'hash_only','wbh_manual_roster_evidence_v1',
     'Manual factual transcription from official Chicago Sky game notes roster table; source body not retained.')
  returning document_id into v_doc;

  insert into public.wbh_ingestion_runs
    (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)
  values
    ('pbe_curation','manual_public_roster_curation','1.0.0','wbh_manual_roster_evidence_v1','ingest',v_now,
     jsonb_build_object('dataset','wnba_2024_chicago_roster_20240518_v1','edition_id','wnba_2024','expected_rows',12,'linked_rows',11,'conflict_rows',1,'roster_stints_written',0))
  returning run_id into v_run;

  insert into public.wbh_season_roster_evidence
    (evidence_id,edition_id,team_edition_id,person_id,source_player_name,source_birth_date,source_birth_precision,evidence_kind,effective_on,citation_url,citation_title,citation_publisher,identity_status,identity_tier,identity_confidence,identity_method,identity_note,source_document_id,ingestion_run_id,transformation_version,effective_at)
  values
    ('rse_'||substr(md5(v_url||'|Diamond DeShields'),1,24),'wnba_2024','te_chicago_sky_2024','gp_YXRG5F81147F','Diamond DeShields','1996-08-01','day','dated_roster','2024-05-18',v_url,'Chicago Sky at Dallas Wings Game Notes — May 18, 2024','Chicago Sky','conflict','T3',1.0,'manual_name_dob_conflict','Exact canonical name, but official Chicago roster lists DOB 1996-08-01 while the current Wikidata-backed canonical person record lists 1995-03-05. Preserved as conflict; no automatic correction.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-18T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Elizabeth Williams'),1,24),'wnba_2024','te_chicago_sky_2024','gp_DXT2ECP6TTHS','Elizabeth Williams','1993-06-23','day','dated_roster','2024-05-18',v_url,'Chicago Sky at Dallas Wings Game Notes — May 18, 2024','Chicago Sky','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-18T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Kysre Gondrezick'),1,24),'wnba_2024','te_chicago_sky_2024','gp_PF0J9WBH39S2','Kysre Gondrezick','1997-07-27','day','dated_roster','2024-05-18',v_url,'Chicago Sky at Dallas Wings Game Notes — May 18, 2024','Chicago Sky','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-18T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Marina Mabrey'),1,24),'wnba_2024','te_chicago_sky_2024','gp_RNJR7SR939DA','Marina Mabrey','1996-09-14','day','dated_roster','2024-05-18',v_url,'Chicago Sky at Dallas Wings Game Notes — May 18, 2024','Chicago Sky','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-18T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Angel Reese'),1,24),'wnba_2024','te_chicago_sky_2024','gp_MAVZ4A7DN19B','Angel Reese','2002-05-06','day','dated_roster','2024-05-18',v_url,'Chicago Sky at Dallas Wings Game Notes — May 18, 2024','Chicago Sky','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-18T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Chennedy Carter'),1,24),'wnba_2024','te_chicago_sky_2024','gp_P7JAH60DBSH3','Chennedy Carter','1998-11-14','day','dated_roster','2024-05-18',v_url,'Chicago Sky at Dallas Wings Game Notes — May 18, 2024','Chicago Sky','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-18T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Kamilla Cardoso'),1,24),'wnba_2024','te_chicago_sky_2024','gp_585QJ199NH2Y','Kamilla Cardoso','2001-04-30','day','dated_roster','2024-05-18',v_url,'Chicago Sky at Dallas Wings Game Notes — May 18, 2024','Chicago Sky','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-18T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Dana Evans'),1,24),'wnba_2024','te_chicago_sky_2024','gp_ZA878Q7W262Z','Dana Evans','1998-08-01','day','dated_roster','2024-05-18',v_url,'Chicago Sky at Dallas Wings Game Notes — May 18, 2024','Chicago Sky','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-18T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Michaela Onyenwere'),1,24),'wnba_2024','te_chicago_sky_2024','gp_KJNJ39KCDGRS','Michaela Onyenwere','1999-08-10','day','dated_roster','2024-05-18',v_url,'Chicago Sky at Dallas Wings Game Notes — May 18, 2024','Chicago Sky','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-18T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Lindsay Allen'),1,24),'wnba_2024','te_chicago_sky_2024','gp_GT3A7XEGE909','Lindsay Allen','1995-03-20','day','dated_roster','2024-05-18',v_url,'Chicago Sky at Dallas Wings Game Notes — May 18, 2024','Chicago Sky','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-18T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Isabelle Harrison'),1,24),'wnba_2024','te_chicago_sky_2024','gp_97VGE49KWW11','Isabelle Harrison','1993-09-27','day','dated_roster','2024-05-18',v_url,'Chicago Sky at Dallas Wings Game Notes — May 18, 2024','Chicago Sky','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-18T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Brianna Turner'),1,24),'wnba_2024','te_chicago_sky_2024','gp_X0A8RRPB3YQN','Brianna Turner','1996-07-05','day','dated_roster','2024-05-18',v_url,'Chicago Sky at Dallas Wings Game Notes — May 18, 2024','Chicago Sky','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-18T00:00:00Z');

  if (select count(*) from public.wbh_season_roster_evidence where citation_url=v_url and effective_on=date '2024-05-18')<>12 then
    raise exception 'wbh: Chicago roster evidence insert did not produce 12 rows' using errcode='P0001';
  end if;
  update public.wbh_ingestion_runs set status='ok',counts=jsonb_build_object('rows',12,'linked',11,'conflict',1,'unresolved',0,'teams',1,'roster_stints_written',0) where run_id=v_run;
end $seed$;

commit;
