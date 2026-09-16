-- Women's Basketball History — 2024 official roster evidence v1
--
-- Manual fact curation only: no WNBA page/PDF body is stored. Each observation records the
-- readable public citation and only the factual roster fields needed for reconciliation.
-- New York: finalized opening roster, 2024-05-13.
-- Las Vegas: dated roster in official game notes for 2024-06-15.
-- wbh_roster_stints remains untouched.

begin;

do $seed$
declare
  v_run uuid;
  v_ny_doc uuid;
  v_lv_doc uuid;
  v_now timestamptz := clock_timestamp();
  v_ny_url text := 'https://liberty.wnba.com/news/new-york-liberty-announce-2024-regular-season-roster';
  v_lv_url text := 'https://cdn.wnba.com/sites/1611661319/2024/06/2024-06-15-Aces-vs-New-York-Game-Notes-FINAL.pdf';
  v_ny_capture text := '2024-05-13|New York Liberty|opening roster|Kennedy Burke|1997-02-14;Marquesha Davis|2001-05-29;Ivana Dojkic|1997-12-24;Leonie Fiebich|2000-01-10;Sabrina Ionescu|1997-12-06;Jonquel Jones|1994-01-05;Betnijah Laney-Hamilton|1993-10-29;Nyara Sabally|2000-02-26;Breanna Stewart|1994-08-27;Kayla Thornton|1992-10-20;Courtney Vandersloot|1989-02-08';
  v_lv_capture text := '2024-06-15|Las Vegas Aces|dated roster|Kierstan Bell|2000-03-16;Emma Cannon|1989-06-01;Alysha Clark|1987-07-07;Sydney Colson|1989-08-06;Chelsea Gray|1992-10-08;Megan Gustafson|1996-12-13;Tiffany Hayes|1989-08-20;Kate Martin|2000-06-05;Kelsey Plum|1994-08-24;Kiah Stokes|1993-03-30;Aja Wilson|1996-08-08;Jackie Young|1997-09-16';
  v_existing integer;
begin
  perform public.wbh_assert_ingestible('pbe_curation');

  select count(*) into v_existing from public.wbh_ingestion_runs
   where scope->>'dataset'='wnba_2024_official_roster_evidence_v1' and status='ok';
  if v_existing > 0 then
    if (select count(*) from public.wbh_season_roster_evidence
         where edition_id='wnba_2024' and citation_url in (v_ny_url,v_lv_url)) = 23 then
      return;
    end if;
    raise exception 'wbh: official roster evidence run exists but expected 23 observations are not present' using errcode='P0001';
  end if;

  insert into public.wbh_source_documents
    (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,content_type,byte_size,storage_state,transformation_version,notes)
  values
    ('pbe_curation','ny_liberty_2024_opening_roster',v_ny_url,'GET',v_now,200,
     encode(extensions.digest(convert_to(v_ny_capture,'UTF8'),'sha256'),'hex'),'text/plain',octet_length(v_ny_capture),'hash_only','wbh_manual_roster_evidence_v1',
     'Manual factual transcription only; source page body not retained. Published 2024-05-13 by New York Liberty.')
  returning document_id into v_ny_doc;

  insert into public.wbh_source_documents
    (source_id,source_record_id,request_url,request_method,retrieved_at,http_status,content_sha256,content_type,byte_size,storage_state,transformation_version,notes)
  values
    ('pbe_curation','lv_aces_2024_06_15_roster',v_lv_url,'GET',v_now,200,
     encode(extensions.digest(convert_to(v_lv_capture,'UTF8'),'sha256'),'hex'),'text/plain',octet_length(v_lv_capture),'hash_only','wbh_manual_roster_evidence_v1',
     'Manual factual transcription only; PDF body not retained. Official Aces game notes dated 2024-06-15, roster page 3.')
  returning document_id into v_lv_doc;

  insert into public.wbh_ingestion_runs
    (source_id,adapter_id,adapter_version,transformation_version,mode,as_of,scope)
  values
    ('pbe_curation','manual_public_roster_curation','1.0.0','wbh_manual_roster_evidence_v1','ingest',v_now,
     jsonb_build_object('dataset','wnba_2024_official_roster_evidence_v1','edition_id','wnba_2024','expected_rows',23,'linked_rows',22,'conflict_rows',1,'roster_stints_written',0))
  returning run_id into v_run;

  -- New York Liberty opening roster: official source supplies player name + DOB. Accent/married-name
  -- variants are manually linked only where the DOB is the same canonical person.
  insert into public.wbh_season_roster_evidence
    (evidence_id,edition_id,team_edition_id,person_id,source_player_name,source_birth_date,source_birth_precision,evidence_kind,effective_on,citation_url,citation_title,citation_publisher,identity_status,identity_tier,identity_confidence,identity_method,identity_note,source_document_id,ingestion_run_id,transformation_version,effective_at)
  values
    ('rse_'||substr(md5(v_ny_url||'|Kennedy Burke'),1,24),'wnba_2024','te_new_york_liberty_2024','gp_2W18SMQN0WV4','Kennedy Burke','1997-02-14','day','opening_roster','2024-05-13',v_ny_url,'New York Liberty Announce 2024 Regular Season Roster','New York Liberty','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_ny_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_ny_url||'|Marquesha Davis'),1,24),'wnba_2024','te_new_york_liberty_2024','gp_1QAD48NVZCGN','Marquesha Davis','2001-05-29','day','opening_roster','2024-05-13',v_ny_url,'New York Liberty Announce 2024 Regular Season Roster','New York Liberty','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_ny_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_ny_url||'|Ivana Dojkic'),1,24),'wnba_2024','te_new_york_liberty_2024','gp_4TFRVH98P114','Ivana Dojkić','1997-12-24','day','opening_roster','2024-05-13',v_ny_url,'New York Liberty Announce 2024 Regular Season Roster','New York Liberty','linked','T3',1.0,'manual_name_dob_match','Accent-normalized name and exact DOB.',v_ny_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_ny_url||'|Leonie Fiebich'),1,24),'wnba_2024','te_new_york_liberty_2024','gp_B3S4JHCCXTGK','Leonie Fiebich','2000-01-10','day','opening_roster','2024-05-13',v_ny_url,'New York Liberty Announce 2024 Regular Season Roster','New York Liberty','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_ny_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_ny_url||'|Sabrina Ionescu'),1,24),'wnba_2024','te_new_york_liberty_2024','gp_ACQ47RGKX5HW','Sabrina Ionescu','1997-12-06','day','opening_roster','2024-05-13',v_ny_url,'New York Liberty Announce 2024 Regular Season Roster','New York Liberty','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_ny_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_ny_url||'|Jonquel Jones'),1,24),'wnba_2024','te_new_york_liberty_2024','gp_J0G0FA0RFTVC','Jonquel Jones','1994-01-05','day','opening_roster','2024-05-13',v_ny_url,'New York Liberty Announce 2024 Regular Season Roster','New York Liberty','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_ny_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_ny_url||'|Betnijah Laney-Hamilton'),1,24),'wnba_2024','te_new_york_liberty_2024','gp_MVSQA54ZXNXQ','Betnijah Laney-Hamilton','1993-10-29','day','opening_roster','2024-05-13',v_ny_url,'New York Liberty Announce 2024 Regular Season Roster','New York Liberty','linked','T3',0.99,'manual_name_dob_match','Official 2024 married-name form; canonical identity label at capture was Betnijah Laney; DOB exact.',v_ny_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_ny_url||'|Nyara Sabally'),1,24),'wnba_2024','te_new_york_liberty_2024','gp_MT14QT8YM8T1','Nyara Sabally','2000-02-26','day','opening_roster','2024-05-13',v_ny_url,'New York Liberty Announce 2024 Regular Season Roster','New York Liberty','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_ny_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_ny_url||'|Breanna Stewart'),1,24),'wnba_2024','te_new_york_liberty_2024','gp_7NMH7TBTN4JS','Breanna Stewart','1994-08-27','day','opening_roster','2024-05-13',v_ny_url,'New York Liberty Announce 2024 Regular Season Roster','New York Liberty','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_ny_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_ny_url||'|Kayla Thornton'),1,24),'wnba_2024','te_new_york_liberty_2024','gp_Q298JRWCXFJ1','Kayla Thornton','1992-10-20','day','opening_roster','2024-05-13',v_ny_url,'New York Liberty Announce 2024 Regular Season Roster','New York Liberty','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_ny_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z'),
    ('rse_'||substr(md5(v_ny_url||'|Courtney Vandersloot'),1,24),'wnba_2024','te_new_york_liberty_2024','gp_2D0DZYMA79J3','Courtney Vandersloot','1989-02-08','day','opening_roster','2024-05-13',v_ny_url,'New York Liberty Announce 2024 Regular Season Roster','New York Liberty','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_ny_doc,v_run,'wbh_manual_roster_evidence_v1','2024-05-13T00:00:00Z');

  -- Las Vegas roster from dated official game notes. Megan Gustafson resolves through an existing
  -- alias + exact DOB. Tiffany Hayes is intentionally left CONFLICT because this PDF says 08/20/1989
  -- while the canonical Wikidata-backed person currently says 09/20/1989; we do not guess which is wrong.
  insert into public.wbh_season_roster_evidence
    (evidence_id,edition_id,team_edition_id,person_id,source_player_name,source_birth_date,source_birth_precision,evidence_kind,effective_on,citation_url,citation_title,citation_publisher,identity_status,identity_tier,identity_confidence,identity_method,identity_note,source_document_id,ingestion_run_id,transformation_version,effective_at)
  values
    ('rse_'||substr(md5(v_lv_url||'|Kierstan Bell'),1,24),'wnba_2024','te_las_vegas_aces_2024','gp_FNDW4TB8D606','Kierstan Bell','2000-03-16','day','dated_roster','2024-06-15',v_lv_url,'Aces vs. Liberty Game Notes — June 15, 2024','Las Vegas Aces','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_lv_doc,v_run,'wbh_manual_roster_evidence_v1','2024-06-15T00:00:00Z'),
    ('rse_'||substr(md5(v_lv_url||'|Emma Cannon'),1,24),'wnba_2024','te_las_vegas_aces_2024','gp_PRVTNNBSDNWY','Emma Cannon','1989-06-01','day','dated_roster','2024-06-15',v_lv_url,'Aces vs. Liberty Game Notes — June 15, 2024','Las Vegas Aces','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_lv_doc,v_run,'wbh_manual_roster_evidence_v1','2024-06-15T00:00:00Z'),
    ('rse_'||substr(md5(v_lv_url||'|Alysha Clark'),1,24),'wnba_2024','te_las_vegas_aces_2024','gp_DXA2R0B76ZTG','Alysha Clark','1987-07-07','day','dated_roster','2024-06-15',v_lv_url,'Aces vs. Liberty Game Notes — June 15, 2024','Las Vegas Aces','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_lv_doc,v_run,'wbh_manual_roster_evidence_v1','2024-06-15T00:00:00Z'),
    ('rse_'||substr(md5(v_lv_url||'|Sydney Colson'),1,24),'wnba_2024','te_las_vegas_aces_2024','gp_T8SE8H9EM3A8','Sydney Colson','1989-08-06','day','dated_roster','2024-06-15',v_lv_url,'Aces vs. Liberty Game Notes — June 15, 2024','Las Vegas Aces','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_lv_doc,v_run,'wbh_manual_roster_evidence_v1','2024-06-15T00:00:00Z'),
    ('rse_'||substr(md5(v_lv_url||'|Chelsea Gray'),1,24),'wnba_2024','te_las_vegas_aces_2024','gp_AD99J12GWAZH','Chelsea Gray','1992-10-08','day','dated_roster','2024-06-15',v_lv_url,'Aces vs. Liberty Game Notes — June 15, 2024','Las Vegas Aces','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_lv_doc,v_run,'wbh_manual_roster_evidence_v1','2024-06-15T00:00:00Z'),
    ('rse_'||substr(md5(v_lv_url||'|Megan Gustafson'),1,24),'wnba_2024','te_las_vegas_aces_2024','gp_3ZP85ZPK4C0V','Megan Gustafson','1996-12-13','day','dated_roster','2024-06-15',v_lv_url,'Aces vs. Liberty Game Notes — June 15, 2024','Las Vegas Aces','linked','T3',0.99,'manual_alias_dob_match','Existing canonical identity label is current married name Megan DiLeo; Megan Gustafson is a stored alias and DOB matches exactly.',v_lv_doc,v_run,'wbh_manual_roster_evidence_v1','2024-06-15T00:00:00Z'),
    ('rse_'||substr(md5(v_lv_url||'|Tiffany Hayes'),1,24),'wnba_2024','te_las_vegas_aces_2024','gp_8QTWA540X83F','Tiffany Hayes','1989-08-20','day','dated_roster','2024-06-15',v_lv_url,'Aces vs. Liberty Game Notes — June 15, 2024','Las Vegas Aces','conflict','T4',0.60,'manual_name_match_dob_conflict','Name matches canonical Tiffany Hayes, but source DOB 1989-08-20 conflicts with canonical 1989-09-20. Not linked.',v_lv_doc,v_run,'wbh_manual_roster_evidence_v1','2024-06-15T00:00:00Z'),
    ('rse_'||substr(md5(v_lv_url||'|Kate Martin'),1,24),'wnba_2024','te_las_vegas_aces_2024','gp_ZCCDP82Q0ENR','Kate Martin','2000-06-05','day','dated_roster','2024-06-15',v_lv_url,'Aces vs. Liberty Game Notes — June 15, 2024','Las Vegas Aces','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_lv_doc,v_run,'wbh_manual_roster_evidence_v1','2024-06-15T00:00:00Z'),
    ('rse_'||substr(md5(v_lv_url||'|Kelsey Plum'),1,24),'wnba_2024','te_las_vegas_aces_2024','gp_W9YAYBX56EWP','Kelsey Plum','1994-08-24','day','dated_roster','2024-06-15',v_lv_url,'Aces vs. Liberty Game Notes — June 15, 2024','Las Vegas Aces','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_lv_doc,v_run,'wbh_manual_roster_evidence_v1','2024-06-15T00:00:00Z'),
    ('rse_'||substr(md5(v_lv_url||'|Kiah Stokes'),1,24),'wnba_2024','te_las_vegas_aces_2024','gp_DBTYE8RH2MEX','Kiah Stokes','1993-03-30','day','dated_roster','2024-06-15',v_lv_url,'Aces vs. Liberty Game Notes — June 15, 2024','Las Vegas Aces','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_lv_doc,v_run,'wbh_manual_roster_evidence_v1','2024-06-15T00:00:00Z'),
    ('rse_'||substr(md5(v_lv_url||'|Aja Wilson'),1,24),'wnba_2024','te_las_vegas_aces_2024','gp_TZP3PGVSTQ7C','A’ja Wilson','1996-08-08','day','dated_roster','2024-06-15',v_lv_url,'Aces vs. Liberty Game Notes — June 15, 2024','Las Vegas Aces','linked','T3',1.0,'manual_name_dob_match','Punctuation-normalized name and exact DOB.',v_lv_doc,v_run,'wbh_manual_roster_evidence_v1','2024-06-15T00:00:00Z'),
    ('rse_'||substr(md5(v_lv_url||'|Jackie Young'),1,24),'wnba_2024','te_las_vegas_aces_2024','gp_SY9CQENDFAPZ','Jackie Young','1997-09-16','day','dated_roster','2024-06-15',v_lv_url,'Aces vs. Liberty Game Notes — June 15, 2024','Las Vegas Aces','linked','T3',1.0,'manual_name_dob_match','Exact canonical name and DOB.',v_lv_doc,v_run,'wbh_manual_roster_evidence_v1','2024-06-15T00:00:00Z');

  if (select count(*) from public.wbh_season_roster_evidence
       where edition_id='wnba_2024' and citation_url in (v_ny_url,v_lv_url)) <> 23 then
    raise exception 'wbh: official roster evidence insert did not produce 23 observations' using errcode='P0001';
  end if;

  update public.wbh_ingestion_runs
     set status='ok', counts=jsonb_build_object('rows',23,'linked',22,'conflict',1,'unresolved',0,'teams',2,'roster_stints_written',0)
   where run_id=v_run;
end $seed$;

commit;
