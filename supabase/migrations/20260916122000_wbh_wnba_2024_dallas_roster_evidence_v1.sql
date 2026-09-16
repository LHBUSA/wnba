-- Women's Basketball History — Dallas Wings opening-day roster evidence, 2024-05-12
-- Manual factual transcription from Dallas Wings News Release syndicated by OurSports Central.
-- Source body is not retained; conflicts remain conflicts rather than silently overwriting canonical identity.

begin;

do $seed$
declare
  v_run uuid;
  v_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_url text := 'https://www.oursportscentral.com/services/releases/dallas-wings-waive-veronica-burton/n-6093449';
  v_capture text := '2024-05-12|Dallas Wings|opening roster|Jaelyn Brown|1998-10-12;Kalani Brown|1997-03-21;Natasha Howard|1991-09-02;Lou Lopez Sénéchal|1998-05-12;Teaira McCowan|1996-09-28;Arike Ogunbowale|1997-03-02;Satou Sabally|1998-04-25;Jacy Sheldon|2000-08-23;Maddy Siegrist|2000-05-22;Stephanie Soares|2000-09-17;Sevgi Uzun|1997-11-25';
  v_existing integer;
begin
  perform public.wbh_assert_ingestible('pbe_curation');
  select count(*) into v_existing from public.wbh_ingestion_runs where scope->>'dataset'='wnba_2024_dallas_roster_20240512_v1' and status='ok';
  if v_existing > 0 then
    if (select count(*) from public.wbh_season_roster_evidence where citation_url=v_url and effective_on=date '2024-05-12')=11 then return; end if;
    raise exception 'wbh: Dallas roster run exists but expected 11 observations are missing' using errcode='P0001';
  end if;

  insert into public.wbh_source_documents
    (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,content_type,byte_size,storage_state,transformation_version,notes)
  values
    ('pbe_curation','dallas_wings_2024_05_12_opening_roster',v_url,'GET',v_now,200,
     encode(extensions.digest(convert_to(v_capture,'UTF8'),'sha256'),'hex'),'text/plain',octet_length(v_capture),'hash_only','wbh_manual_roster_evidence_v1',
     'Manual factual transcription from Dallas Wings News Release syndicated by OurSports Central; source body not retained.')
  returning document_id into v_doc;

  insert into public.wbh_ingestion_runs
    (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)
  values
    ('pbe_curation','manual_public_roster_curation','1.0.0','wbh_manual_roster_evidence_v1','ingest',v_now,
     jsonb_build_object('dataset','wnba_2024_dallas_roster_20240512_v1','edition_id','wnba_2024','expected_rows',11,'linked_rows',10,'conflict_rows',1,'roster_stints_written',0))
  returning run_id into v_run;

  insert into public.wbh_season_roster_evidence
    (evidence_id,edition_id,team_edition_id,person_id,source_player_name,source_birth_date,source_birth_precision,evidence_kind,effective_on,citation_url,citation_title,citation_publisher,identity_status,identity_tier,identity_confidence,identity_method,identity_note,source_document_id,ingestion_run_id,transformation_version,effective_at)
  values
    ('rse_'||substr(md5(v_url||'|Jaelyn Brown'),1,24),'wnba_2024','te_dallas_wings_2024','gp_HECKKQFBZ9HG','Jaelyn Brown','1998-10-12','day','opening_roster','2024-05-12',v_url,'Dallas Wings Waive Veronica Burton / 2024 Dallas Wings Roster','Dallas Wings News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-12T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Kalani Brown'),1,24),'wnba_2024','te_dallas_wings_2024','gp_KQ79W4TAC24M','Kalani Brown','1997-03-21','day','opening_roster','2024-05-12',v_url,'Dallas Wings Waive Veronica Burton / 2024 Dallas Wings Roster','Dallas Wings News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-12T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Natasha Howard'),1,24),'wnba_2024','te_dallas_wings_2024','gp_2JNF42HYEV5R','Natasha Howard','1991-09-02','day','opening_roster','2024-05-12',v_url,'Dallas Wings Waive Veronica Burton / 2024 Dallas Wings Roster','Dallas Wings News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-12T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Lou Lopez Sénéchal'),1,24),'wnba_2024','te_dallas_wings_2024','gp_KD0X8H7G7BZD','Lou Lopez Sénéchal','1998-05-12','day','opening_roster','2024-05-12',v_url,'Dallas Wings Waive Veronica Burton / 2024 Dallas Wings Roster','Dallas Wings News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-12T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Teaira McCowan'),1,24),'wnba_2024','te_dallas_wings_2024','gp_NDFZCAT2PF50','Teaira McCowan','1996-09-28','day','opening_roster','2024-05-12',v_url,'Dallas Wings Waive Veronica Burton / 2024 Dallas Wings Roster','Dallas Wings News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-12T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Arike Ogunbowale'),1,24),'wnba_2024','te_dallas_wings_2024','gp_DNZ0SMQ1EKQQ','Arike Ogunbowale','1997-03-02','day','opening_roster','2024-05-12',v_url,'Dallas Wings Waive Veronica Burton / 2024 Dallas Wings Roster','Dallas Wings News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-12T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Satou Sabally'),1,24),'wnba_2024','te_dallas_wings_2024','gp_VDPER4X26M4N','Satou Sabally','1998-04-25','day','opening_roster','2024-05-12',v_url,'Dallas Wings Waive Veronica Burton / 2024 Dallas Wings Roster','Dallas Wings News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-12T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Jacy Sheldon'),1,24),'wnba_2024','te_dallas_wings_2024','gp_RKGNXB124NEM','Jacy Sheldon','2000-08-23','day','opening_roster','2024-05-12',v_url,'Dallas Wings Waive Veronica Burton / 2024 Dallas Wings Roster','Dallas Wings News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-12T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Maddy Siegrist'),1,24),'wnba_2024','te_dallas_wings_2024','gp_2T7NP98FNSC1','Maddy Siegrist','2000-05-22','day','opening_roster','2024-05-12',v_url,'Dallas Wings Waive Veronica Burton / 2024 Dallas Wings Roster','Dallas Wings News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-12T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Stephanie Soares'),1,24),'wnba_2024','te_dallas_wings_2024','gp_26XNYNAPEQXC','Stephanie Soares','2000-09-17','day','opening_roster','2024-05-12',v_url,'Dallas Wings Waive Veronica Burton / 2024 Dallas Wings Roster','Dallas Wings News Release / OurSports Central','conflict','T3',1.0,'manual_name_dob_conflict','Exact canonical name, but Dallas Wings release lists DOB 2000-09-17 while the current Wikidata-backed canonical person record lists 2000-04-17. Preserved as conflict; no automatic correction.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-12T00:00:00Z'),
    ('rse_'||substr(md5(v_url||'|Sevgi Uzun'),1,24),'wnba_2024','te_dallas_wings_2024','gp_KW13PQ0A170F','Sevgi Uzun','1997-11-25','day','opening_roster','2024-05-12',v_url,'Dallas Wings Waive Veronica Burton / 2024 Dallas Wings Roster','Dallas Wings News Release / OurSports Central','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-12T00:00:00Z');

  if (select count(*) from public.wbh_season_roster_evidence where citation_url=v_url and effective_on=date '2024-05-12')<>11 then
    raise exception 'wbh: Dallas roster evidence insert did not produce 11 rows' using errcode='P0001';
  end if;
  update public.wbh_ingestion_runs set status='ok',counts=jsonb_build_object('rows',11,'linked',10,'conflict',1,'unresolved',0,'teams',1,'roster_stints_written',0) where run_id=v_run;
end $seed$;

commit;
