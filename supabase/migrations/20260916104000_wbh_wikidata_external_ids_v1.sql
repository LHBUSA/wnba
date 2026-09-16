-- PropBetEdge — Women's Basketball History
-- Wikidata CC0 global player external-ID crosswalk v1.
--
-- Source: the immutable, validated Wikidata identity manifest committed at
-- 43a59d5e6fe9cbbcfd631f9affc8118e27774d32. The manifest contains only Wikidata
-- structured claims. This migration does not fetch Basketball-Reference, FIBA, Olympedia,
-- Olympics.com, RealGM, Eurobasket, LFB, Proballers, Sports-Reference, ESPN, or WNBA pages.
-- External provider identifiers enter WBH only as facts asserted by Wikidata CC0.

begin;

create extension if not exists http with schema extensions;

do $seed$
declare
  r record;
  manifest jsonb;
  v_doc uuid;
  v_run uuid;
  v_existing integer;
  v_people integer;
  v_external integer;
  v_unique_external integer;
  v_inserted integer;
  v_counts jsonb;
  source_url constant text := 'https://raw.githubusercontent.com/LHBUSA/wnba/43a59d5e6fe9cbbcfd631f9affc8118e27774d32/data/wbh/manifests/wikidata-wnba-identity-v1.json';
  expected_manifest_sha constant text := 'd68a25788b9b899511aec3793b1b089ba4c427926ee2025c32dd7f9f1e1fcede';
  allowed_props constant text[] := array['P4561','P4790','P3542','P12338','P8286','P5815','P3957','P3527','P4382','P8548','P3696'];
begin
  perform public.wbh_assert_ingestible('wikidata');

  select * into r from extensions.http_get(source_url);
  if r.status <> 200 then
    raise exception 'wbh external ids: immutable manifest returned HTTP %', r.status;
  end if;
  if octet_length(r.content) <> 1287899 then
    raise exception 'wbh external ids: manifest length % != reviewed 1287899', octet_length(r.content);
  end if;
  if encode(extensions.digest(r.content, 'sha256'), 'hex') <> expected_manifest_sha then
    raise exception 'wbh external ids: immutable manifest sha256 mismatch';
  end if;

  manifest := r.content::jsonb;
  if manifest->>'dataset' <> 'wikidata_wnba_identity_v1'
     or manifest->>'license' <> 'CC0-1.0'
     or manifest->>'source' <> 'Wikidata structured data only' then
    raise exception 'wbh external ids: manifest source contract mismatch';
  end if;
  if manifest#>>'{capture,raw_capture_sha256}' <> '2f00c0ed3b7aab4f10a3b61182486a1488b02506963692718957deb6a470bc86' then
    raise exception 'wbh external ids: raw Wikidata capture hash mismatch';
  end if;

  select count(*) into v_people from jsonb_array_elements(manifest->'people');
  if v_people <> 1314 then
    raise exception 'wbh external ids: manifest people % != reviewed 1314', v_people;
  end if;

  with ids as (
    select p->>'person_id' person_id, e.key property_id, v.value external_id
      from jsonb_array_elements(manifest->'people') p
      cross join lateral jsonb_each(p->'external_ids') e
      cross join lateral jsonb_array_elements_text(e.value) v(value)
     where e.key = any (allowed_props)
  )
  select count(*), count(distinct (property_id, external_id))
    into v_external, v_unique_external
    from ids;

  if v_external <> 8475 or v_unique_external <> 8475 then
    raise exception 'wbh external ids: reviewed crosswalk expected 8475 unique property/id pairs, got % rows / % unique',
      v_external, v_unique_external;
  end if;

  -- The manifest IDs must resolve to the exact canonical people already loaded from this same capture,
  -- and the P3588 anchor must still agree before any secondary ID can be promoted.
  if exists (
    select 1
      from jsonb_array_elements(manifest->'people') p
      left join public.wbh_persons person on person.person_id = p->>'person_id'
      left join public.wbh_entity_source_ids anchor
        on anchor.entity_type = 'person'
       and anchor.entity_id = p->>'person_id'
       and anchor.source_id = 'wikidata'
       and anchor.id_space = 'wikidata:P3588'
       and anchor.external_id = p->>'wnba_com_id'
       and anchor.status = 'linked'
     where person.person_id is null or anchor.entity_link_id is null
  ) then
    raise exception 'wbh external ids: manifest person/P3588 anchor does not match canonical identity spine';
  end if;

  select count(*) into v_existing
    from public.wbh_ingestion_runs
   where scope->>'dataset' = 'wikidata_wnba_external_ids_v1'
     and status = 'ok';
  if v_existing > 0 then
    if (select count(*)
          from public.wbh_entity_source_ids
         where entity_type='person' and source_id='wikidata'
           and id_space = any (array[
             'wikidata:P4561','wikidata:P4790','wikidata:P3542','wikidata:P12338',
             'wikidata:P8286','wikidata:P5815','wikidata:P3957','wikidata:P3527',
             'wikidata:P4382','wikidata:P8548','wikidata:P3696'
           ]) and status='linked') = 8475 then
      return;
    end if;
    raise exception 'wbh external ids: completed run exists but linked crosswalk is incomplete';
  end if;

  if exists (
    select 1 from public.wbh_entity_source_ids
     where entity_type='person' and source_id='wikidata'
       and id_space = any (array[
         'wikidata:P4561','wikidata:P4790','wikidata:P3542','wikidata:P12338',
         'wikidata:P8286','wikidata:P5815','wikidata:P3957','wikidata:P3527',
         'wikidata:P4382','wikidata:P8548','wikidata:P3696'
       ])
  ) then
    raise exception 'wbh external ids: secondary Wikidata crosswalk rows already exist without a completed run; refusing to merge implicitly';
  end if;

  select document_id into v_doc
    from public.wbh_source_documents
   where source_id='wikidata'
     and source_record_id='wikidata:P3588:wnba_identity_snapshot_v1'
     and content_sha256='2f00c0ed3b7aab4f10a3b61182486a1488b02506963692718957deb6a470bc86'
   order by recorded_at desc
   limit 1;
  if v_doc is null then
    raise exception 'wbh external ids: canonical Wikidata source document not found';
  end if;

  insert into public.wbh_ingestion_runs
    (source_id, adapter_id, adapter_version, transformation_version, mode, as_of, scope)
  values
    ('wikidata', 'wikidata_external_id_crosswalk', '1.0.0', 'wbh_wikidata_external_crosswalk_v1',
     'ingest', (manifest#>>'{capture,captured_at}')::timestamptz,
     jsonb_build_object(
       'dataset','wikidata_wnba_external_ids_v1',
       'identity_dataset','wikidata_wnba_identity_v1',
       'manifest_sha256',expected_manifest_sha,
       'linked_external_ids',8475
     ))
  returning run_id into v_run;

  with ids as (
    select p->>'person_id' person_id, e.key property_id, v.value external_id
      from jsonb_array_elements(manifest->'people') p
      cross join lateral jsonb_each(p->'external_ids') e
      cross join lateral jsonb_array_elements_text(e.value) v(value)
     where e.key = any (allowed_props)
  )
  insert into public.wbh_entity_source_ids
    (entity_type, entity_id, source_id, external_id, id_space, status, tier, confidence,
     method, evidence, source_document_id, ingestion_run_id, transformation_version)
  select
    'person', person_id, 'wikidata', external_id, 'wikidata:' || property_id,
    'linked', 'T1', 1.0, 'wikidata_structured_claim',
    jsonb_build_object('source','Wikidata structured data','property',property_id),
    v_doc, v_run, 'wbh_wikidata_external_crosswalk_v1'
  from ids;

  get diagnostics v_inserted = row_count;
  if v_inserted <> 8475 then
    raise exception 'wbh external ids: inserted % rows, expected 8475', v_inserted;
  end if;

  with ids as (
    select e.key property_id, count(*) n
      from jsonb_array_elements(manifest->'people') p
      cross join lateral jsonb_each(p->'external_ids') e
      cross join lateral jsonb_array_elements_text(e.value) v(value)
     where e.key = any (allowed_props)
     group by e.key
  )
  select jsonb_object_agg(property_id, n order by property_id) into v_counts from ids;

  update public.wbh_ingestion_runs
     set status='ok',
         counts=jsonb_build_object(
           'linked_external_ids',8475,
           'by_property',v_counts
         )
   where run_id=v_run;
end $seed$;

drop extension http;

commit;
