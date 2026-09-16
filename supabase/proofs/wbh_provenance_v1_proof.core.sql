-- Proof body for 20260916100000_wbh_provenance_v1.sql + 20260916100100_wbh_core_v1.sql.
-- Assembled by supabase/proofs/build-wbh-proof.mjs into a transaction that ALWAYS rolls back.
--
-- This proof is mostly about REFUSAL. A provenance system is only worth having if the gates actually
-- reject the writes they are supposed to reject, so most checks below assert that an insert FAILED
-- for the right reason. Every positive write runs as service_role, the production writer.

create temp table _proof (step text primary key, check_name text not null, pass boolean not null, detail text);
grant all on _proof to public;

create or replace function pg_temp._fingerprint() returns text language sql as $fp$
  select md5(string_agg(x, '|' order by x)) from (
    select 'rel:' || n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || coalesce(c.relacl::text, '') as x
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and n.nspname not like 'pg\_temp%' and n.nspname not like 'pg\_toast\_temp%'
       and c.relname not like 'wbh\_%'
    union all
    select 'col:' || a.attrelid::regclass::text || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attnum > 0 and not a.attisdropped and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
       and n.nspname not like 'pg\_temp%' and n.nspname not like 'pg\_toast%' and c.relname not like 'wbh\_%'
    union all
    select 'con:' || conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
      from pg_constraint where conrelid <> 0 and conrelid::regclass::text not like '%wbh\_%' and connamespace::regnamespace::text not like 'pg\_temp%'
    union all
    select 'trg:' || tgrelid::regclass::text || ':' || tgname || ':' || pg_get_triggerdef(oid)
      from pg_trigger where not tgisinternal and tgrelid::regclass::text not like '%wbh\_%'
    union all
    select 'pol:' || schemaname || '.' || tablename || ':' || policyname || ':' || cmd::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') || ':' || array_to_string(roles, ',')
      from pg_policies where tablename not like 'wbh\_%'
    union all
    select 'fn:' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, '') || ':' || p.prosecdef::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_temp%' and p.proname not like 'wbh\_%'
    union all
    select 'nsp:' || nspname || ':' || coalesce(nspacl::text, '') from pg_namespace where nspname not like 'pg\_temp%' and nspname not like 'pg\_toast\_temp%'
    union all
    select 'defacl:' || defaclrole::regrole::text || ':' || coalesce(defaclnamespace::regnamespace::text, '') || ':' || defaclobjtype::text || ':' || defaclacl::text from pg_default_acl
  ) s
$fp$;

create temp table _fp as select pg_temp._fingerprint() as before_fp, null::text as after_fp,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname not like 'pg\_temp%' and n.nspname not like 'pg\_toast%' and c.relname not like 'wbh\_%') as before_rel_count,
  (select count(*) from pg_class where relname like 'wnba\_pbe%') as before_pbe_count,
  (select count(*) from pg_class where relname like 'pbe\_sport\_entitlements%') as before_entitlement_count;

insert into _proof values ('01', 'clean install: no wbh_* object exists before the migrations',
  not exists (select 1 from pg_class where relname like 'wbh\_%') and not exists (select 1 from pg_proc where proname like 'wbh\_%'),
  (select count(*)::text || ' pre-existing wbh relations' from pg_class where relname like 'wbh\_%'));

-- ================================================================ first execution
{{MIGRATION_A}}
{{MIGRATION_B}}

create temp table _objs as select
  (select count(*) from pg_class where relname like 'wbh\_%') as rels,
  (select count(*) from pg_proc where proname like 'wbh\_%') as fns,
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname like 'wbh\_%' and not t.tgisinternal) as trgs;

-- ================================================================ second execution (idempotency)
{{MIGRATION_A}}
{{MIGRATION_B}}

insert into _proof select '02', 'second execution succeeds and creates nothing new',
  o.rels = (select count(*) from pg_class where relname like 'wbh\_%')
  and o.fns = (select count(*) from pg_proc where proname like 'wbh\_%')
  and o.trgs = (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname like 'wbh\_%' and not t.tgisinternal),
  format('rels %s fns %s trgs %s', o.rels, o.fns, o.trgs) from _objs o;

-- ================================================================ the rights gate

set local role service_role;

-- 03 an unregistered source is refused outright: the default is NO
do $t$
declare msg text;
begin
  begin
    perform public.wbh_assert_ingestible('some_site_we_never_reviewed');
    insert into _proof values ('03', 'unknown source is refused (fails closed)', false, 'assert_ingestible returned instead of raising');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('03', 'unknown source is refused (fails closed)', msg like '%not registered%', msg);
  end;
end $t$;

-- 04 ESPN (prohibited) cannot open a real ingestion run
do $t$
declare msg text;
begin
  begin
    insert into public.wbh_ingestion_runs (source_id, adapter_id, adapter_version, transformation_version, mode, as_of)
    values ('espn', 'espn_summary', '1.0.0', 'v1', 'ingest', now());
    insert into _proof values ('04', 'prohibited source cannot open an ingest run', false, 'insert unexpectedly succeeded');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('04', 'prohibited source cannot open an ingest run', msg like '%only mode = dry_run%', msg);
  end;
end $t$;

-- 05 but a dry run against it is allowed: we may still measure coverage without keeping anything
do $t$
declare msg text; n int;
begin
  begin
    insert into public.wbh_ingestion_runs (source_id, adapter_id, adapter_version, transformation_version, mode, as_of)
    values ('espn', 'espn_summary', '1.0.0', 'v1', 'dry_run', now());
    get diagnostics n = row_count;
    insert into _proof values ('05', 'dry_run against a prohibited source is allowed (measurement, no retention)', n = 1, format('%s row', n));
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('05', 'dry_run against a prohibited source is allowed (measurement, no retention)', false, msg);
  end;
end $t$;

-- 06 ESPN raw bytes may not be retained
do $t$
declare msg text;
begin
  begin
    insert into public.wbh_source_documents (source_id, retrieved_at, content_sha256, storage_state, r2_bucket, r2_key, rights_state_at_capture)
    values ('espn', now(), repeat('a', 64), 'stored', 'wbh-raw', 'wbh/espn/' || repeat('a', 64), 'approved_commercial');
    insert into _proof values ('06', 'prohibited source: raw retention refused', false, 'insert unexpectedly succeeded');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('06', 'prohibited source: raw retention refused', msg like '%does not permit raw retention%', msg);
  end;
end $t$;

-- 07 recording only the hash of a prohibited source is allowed, and the rights state is stamped by
--    the server from the registry, not taken from the writer's optimistic claim
do $t$
declare stamped text; msg text;
begin
  begin
    insert into public.wbh_source_documents (source_id, retrieved_at, content_sha256, storage_state, rights_state_at_capture)
    values ('espn', now(), repeat('b', 64), 'hash_only', 'approved_commercial')
    returning rights_state_at_capture into stamped;
    insert into _proof values ('07', 'capture stamps the true rights state, ignoring the writer', stamped = 'prohibited', 'stamped ' || stamped);
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('07', 'capture stamps the true rights state, ignoring the writer', false, msg);
  end;
end $t$;

-- 08 an approved source's stored document must be content addressed
do $t$
declare msg text;
begin
  begin
    insert into public.wbh_source_documents (source_id, retrieved_at, content_sha256, storage_state, r2_bucket, r2_key, rights_state_at_capture)
    values ('wikidata', now(), repeat('c', 64), 'stored', 'wbh-raw', 'wbh/wikidata/latest.json', 'approved_commercial');
    insert into _proof values ('08', 'stored raw must be content addressed', false, 'insert unexpectedly succeeded');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('08', 'stored raw must be content addressed', msg like '%content addressed%', msg);
  end;
end $t$;

-- 09 source documents are append-only apart from purging the bytes
do $t$
declare msg text; doc uuid; st text;
begin
  insert into public.wbh_source_documents (source_id, retrieved_at, content_sha256, storage_state, r2_bucket, r2_key, rights_state_at_capture)
  values ('wikidata', now(), repeat('d', 64), 'stored', 'wbh-raw', 'wbh/wikidata/' || repeat('d', 64) || '.json', 'approved_commercial')
  returning document_id into doc;
  begin
    update public.wbh_source_documents set content_sha256 = repeat('e', 64) where document_id = doc;
    insert into _proof values ('09', 'captured documents are append-only', false, 'content hash was rewritten');
  exception when others then
    msg := sqlerrm;
    update public.wbh_source_documents set storage_state = 'purged', purge_reason = 'proof cleanup' where document_id = doc;
    select storage_state into st from public.wbh_source_documents where document_id = doc;
    insert into _proof values ('09', 'captured documents are append-only (only stored -> purged)',
      msg like '%append-only%' and st = 'purged'
      and (select r2_key is null from public.wbh_source_documents where document_id = doc), msg);
  end;
end $t$;

-- ================================================================ canonical writes

-- 10 the happy path for an approved source, end to end
do $t$
declare run uuid; doc uuid; msg text; syn boolean; rec timestamptz;
begin
  begin
    insert into public.wbh_ingestion_runs (source_id, adapter_id, adapter_version, transformation_version, mode, as_of)
    values ('synthetic_fixture', 'fixture', '1.0.0', 'v1', 'ingest', '2024-12-31T00:00:00Z') returning run_id into run;
    insert into public.wbh_source_documents (source_id, retrieved_at, content_sha256, storage_state, r2_bucket, r2_key, rights_state_at_capture)
    values ('synthetic_fixture', now(), repeat('1', 64), 'stored', 'wbh-raw', 'wbh/fixture/' || repeat('1', 64), 'approved_commercial')
    returning document_id into doc;

    insert into public.wbh_organizations (org_id, display_name, org_type, ingestion_run_id, source_document_id)
      values ('syn_org', 'Synthetic Organization', 'league', run, doc);
    insert into public.wbh_competitions (competition_id, org_id, display_name, competition_type, ingestion_run_id, source_document_id)
      values ('syn_league', 'syn_org', 'Synthetic League', 'league', run, doc);
    insert into public.wbh_competition_editions (edition_id, competition_id, season_label, season_year, ingestion_run_id, source_document_id)
      values ('syn_league_2024', 'syn_league', '2024', 2024, run, doc);
    insert into public.wbh_stages (stage_id, edition_id, display_name, season_phase, ingestion_run_id, source_document_id)
      values ('syn_league_2024_reg', 'syn_league_2024', 'Regular Season', 'regular_season', run, doc);
    insert into public.wbh_franchises (franchise_id, canonical_name, ingestion_run_id, source_document_id) values ('fr_syn_a', 'Synthetic A', run, doc);
    insert into public.wbh_franchises (franchise_id, canonical_name, ingestion_run_id, source_document_id) values ('fr_syn_b', 'Synthetic B', run, doc);
    insert into public.wbh_teams (team_id, team_kind, franchise_id, canonical_name, ingestion_run_id, source_document_id)
      values ('tm_syn_a', 'club', 'fr_syn_a', 'Synthetic A', run, doc), ('tm_syn_b', 'club', 'fr_syn_b', 'Synthetic B', run, doc);
    insert into public.wbh_team_editions (team_edition_id, team_id, edition_id, display_name, ingestion_run_id, source_document_id)
      values ('te_syn_a_2024', 'tm_syn_a', 'syn_league_2024', 'Synthetic A', run, doc),
             ('te_syn_b_2024', 'tm_syn_b', 'syn_league_2024', 'Synthetic B', run, doc);
    insert into public.wbh_persons (person_id, primary_full_name, birth_date, ingestion_run_id, source_document_id)
      values ('gp_0123456789AB', 'Synthetic Player', '1998-04-02', run, doc);
    insert into public.wbh_games (game_id, edition_id, stage_id, competition_id, status, game_type, season_phase,
                                  counts_for_standings, counts_for_stats, ingestion_run_id, source_document_id, effective_at)
      values ('gm_syn_2024_001', 'syn_league_2024', 'syn_league_2024_reg', 'syn_league', 'final', 'regular', 'regular_season',
              true, true, run, doc, '2024-06-01T23:00:00Z');
    insert into public.wbh_game_teams (game_id, team_edition_id, side, points, result, ingestion_run_id, source_document_id)
      values ('gm_syn_2024_001', 'te_syn_a_2024', 'home', 88, 'win', run, doc),
             ('gm_syn_2024_001', 'te_syn_b_2024', 'away', 80, 'loss', run, doc);
    insert into public.wbh_player_game_stats (game_id, person_id, team_edition_id, points, rebounds, assists, ingestion_run_id, source_document_id)
      values ('gm_syn_2024_001', 'gp_0123456789AB', 'te_syn_a_2024', 24, 9, 5, run, doc);

    select is_synthetic, recorded_at into syn, rec from public.wbh_games where game_id = 'gm_syn_2024_001';
    insert into _proof values ('10', 'approved source writes canonical rows and is stamped synthetic', syn and rec is not null,
      format('is_synthetic %s', syn));
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('10', 'approved source writes canonical rows and is stamped synthetic', false, msg);
  end;
end $t$;

-- 11 a canonical row with no provenance at all is impossible
do $t$
declare msg text;
begin
  begin
    insert into public.wbh_venues (venue_id, display_name) values ('vn_syn_arena', 'Synthetic Arena');
    insert into _proof values ('11', 'canonical row without an ingestion run is refused', false, 'insert unexpectedly succeeded');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('11', 'canonical row without an ingestion run is refused',
      msg like '%null value%ingestion_run_id%' or msg like '%provenance is not optional%', msg);
  end;
end $t$;

-- 12 a dry run cannot write canonical rows
do $t$
declare run uuid; msg text;
begin
  select run_id into run from public.wbh_ingestion_runs where source_id = 'espn' and mode = 'dry_run' limit 1;
  begin
    insert into public.wbh_venues (venue_id, display_name, ingestion_run_id) values ('vn_syn_dry', 'Dry Run Arena', run);
    insert into _proof values ('12', 'a dry run cannot write canonical rows', false, 'insert unexpectedly succeeded');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('12', 'a dry run cannot write canonical rows', msg like '%dry run may not write%', msg);
  end;
end $t$;

-- 13 a document from a prohibited source cannot be laundered into a canonical row through an
--    approved run: the guard re-derives rights from BOTH sides
do $t$
declare run uuid; doc uuid; msg text;
begin
  select run_id into run from public.wbh_ingestion_runs where source_id = 'synthetic_fixture' and mode = 'ingest' limit 1;
  select document_id into doc from public.wbh_source_documents where source_id = 'espn' limit 1;
  begin
    insert into public.wbh_venues (venue_id, display_name, ingestion_run_id, source_document_id)
    values ('vn_syn_laundered', 'Laundered Arena', run, doc);
    insert into _proof values ('13', 'a prohibited document cannot be laundered through an approved run', false, 'insert unexpectedly succeeded');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('13', 'a prohibited document cannot be laundered through an approved run',
      msg like '%may not produce canonical data%', msg);
  end;
end $t$;

-- ================================================================ classification and identity

-- 14 an exhibition can never count toward standings
do $t$
declare run uuid; msg text;
begin
  select run_id into run from public.wbh_ingestion_runs where source_id = 'synthetic_fixture' and mode = 'ingest' limit 1;
  begin
    insert into public.wbh_games (game_id, edition_id, stage_id, competition_id, status, game_type, season_phase,
                                  counts_for_standings, counts_for_stats, ingestion_run_id, derivation)
    values ('gm_syn_2024_as', 'syn_league_2024', 'syn_league_2024_reg', 'syn_league', 'final', 'all_star', 'exhibition',
            true, false, run, 'proof classification');
    insert into _proof values ('14', 'all-star / exhibition games cannot count for standings', false, 'insert unexpectedly succeeded');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('14', 'all-star / exhibition games cannot count for standings',
      msg like '%wbh_games_exhibition_never_counts%', msg);
  end;
end $t$;

-- 15 a name-only match can never be auto-linked
do $t$
declare run uuid; msg text; n int;
begin
  select run_id into run from public.wbh_ingestion_runs where source_id = 'synthetic_fixture' and mode = 'ingest' limit 1;
  begin
    insert into public.wbh_entity_source_ids (entity_type, entity_id, source_id, external_id, status, tier, confidence, method, ingestion_run_id, derivation)
    values ('person', 'gp_0123456789AB', 'wikidata', 'Q999999', 'linked', 'T5', 0.6, 'exact_name_and_country', run, 'proof identity');
    insert into _proof values ('15', 'a T5 name-context match may never be linked automatically', false, 'insert unexpectedly succeeded');
  exception when others then
    msg := sqlerrm;
    -- the same evidence is acceptable as a candidate for human review
    insert into public.wbh_entity_source_ids (entity_type, entity_id, source_id, external_id, status, tier, confidence, method, ingestion_run_id, derivation)
    values ('person', 'gp_0123456789AB', 'wikidata', 'Q999999', 'candidate', 'T5', 0.6, 'exact_name_and_country', run, 'proof identity');
    get diagnostics n = row_count;
    insert into _proof values ('15', 'a T5 name-context match may never be linked automatically, only proposed',
      msg like '%may never be linked automatically%' and n = 1, msg);
  end;
end $t$;

-- 16 one provider id resolves to at most one entity once linked
do $t$
declare run uuid; msg text;
begin
  select run_id into run from public.wbh_ingestion_runs where source_id = 'synthetic_fixture' and mode = 'ingest' limit 1;
  insert into public.wbh_persons (person_id, primary_full_name, ingestion_run_id, derivation) values ('gp_CDEFGHJKMNPQ', 'Other Synthetic', run, 'proof identity');
  insert into public.wbh_entity_source_ids (entity_type, entity_id, source_id, external_id, status, tier, confidence, method, ingestion_run_id, derivation)
  values ('person', 'gp_0123456789AB', 'wikidata', 'Q123456', 'linked', 'T2', 0.98, 'wikidata_external_ids', run, 'proof identity');
  begin
    insert into public.wbh_entity_source_ids (entity_type, entity_id, source_id, external_id, status, tier, confidence, method, ingestion_run_id, derivation)
    values ('person', 'gp_CDEFGHJKMNPQ', 'wikidata', 'Q123456', 'linked', 'T2', 0.98, 'wikidata_external_ids', run, 'proof identity');
    insert into _proof values ('16', 'a linked provider id cannot point at two people', false, 'insert unexpectedly succeeded');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('16', 'a linked provider id cannot point at two people', msg like '%wbh_entity_source_ids_linked_unique%', msg);
  end;
end $t$;

-- ================================================================ registry integrity

-- 17 a source cannot be marked approved while its own recorded terms forbid database building
do $t$
declare msg text;
begin
  begin
    insert into public.wbh_sources (source_id, display_name, rights_state, rights_basis, commercial_use, database_build, terms_reviewed_at, terms_reviewed_by)
    values ('wishful_thinking', 'Wishful', 'approved_commercial', 'terms_of_use', 'permitted', 'forbidden', now(), 'proof');
    insert into _proof values ('17', 'approval contradicting the recorded terms is refused', false, 'insert unexpectedly succeeded');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('17', 'approval contradicting the recorded terms is refused', msg like '%wbh_sources_ingestible_needs_permission%', msg);
  end;
end $t$;

-- 18 raw retention cannot be enabled for a non-approved source
do $t$
declare msg text;
begin
  begin
    update public.wbh_sources set raw_storage_allowed = true where source_id = 'espn';
    insert into _proof values ('18', 'raw retention cannot be enabled for a prohibited source', false, 'update unexpectedly succeeded');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('18', 'raw retention cannot be enabled for a prohibited source', msg like '%wbh_sources_raw_storage_needs_approval%', msg);
  end;
end $t$;

-- 19 an approved state requires a recorded human review
do $t$
declare msg text;
begin
  begin
    insert into public.wbh_sources (source_id, display_name, rights_state, rights_basis, commercial_use, database_build)
    values ('unreviewed_vendor', 'Unreviewed', 'licensed', 'contract_license', 'permitted', 'permitted');
    insert into _proof values ('19', 'an approved source must name a licence and a reviewer', false, 'insert unexpectedly succeeded');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('19', 'an approved source must name a licence and a reviewer',
      msg like '%wbh_sources_licensed_needs_license%' or msg like '%wbh_sources_approved_needs_review%', msg);
  end;
end $t$;

-- 20 every rights change leaves a permanent trail
do $t$
declare before_n int; after_n int; msg text;
begin
  select count(*) into before_n from public.wbh_source_rights_revisions where source_id = 'olympedia';
  update public.wbh_sources set notes = notes || ' (permission request sent)' where source_id = 'olympedia';
  select count(*) into after_n from public.wbh_source_rights_revisions where source_id = 'olympedia';
  begin
    update public.wbh_source_rights_revisions set rights_state = 'approved_commercial' where source_id = 'olympedia';
    insert into _proof values ('20', 'rights history is append-only', false, 'revision row was rewritten');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('20', 'every rights change is recorded and the history is append-only',
      after_n = before_n + 1 and msg like '%append-only%', format('revisions %s -> %s; %s', before_n, after_n, msg));
  end;
end $t$;

-- 21 quarantine accepts non-approved material and refuses approved material
do $t$
declare msg text; n int;
begin
  insert into public.wbh_quarantine_observations (source_id, purpose, subject, payload)
  values ('espn', 'coverage_probe', '2002 season', '{"finals": 272}'::jsonb);
  get diagnostics n = row_count;
  begin
    insert into public.wbh_quarantine_observations (source_id, purpose, subject, payload)
    values ('wikidata', 'coverage_probe', 'players', '{}'::jsonb);
    insert into _proof values ('21', 'quarantine is for non-approved sources only', false, 'approved source was quarantined');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('21', 'quarantine holds non-approved material and refuses approved material',
      n = 1 and msg like '%write canonical rows, not quarantine%', msg);
  end;
end $t$;

-- 28 approved-looking rights state cannot contradict betting/database/redistribution permissions
do $t$
declare msg text;
begin
  begin
    insert into public.wbh_sources
      (source_id, display_name, rights_state, rights_basis, commercial_use, redistribution, database_build, gambling_use,
       terms_reviewed_at, terms_reviewed_by, attribution_required, attribution_text)
    values
      ('bad_attribution', 'Bad Attribution', 'approved_attribution', 'open_license', 'permitted', 'permitted', 'permitted', 'forbidden',
       now(), 'proof', true, 'Required credit');
    insert into _proof values ('28', 'ingestible rights states require every product permission', false, 'insert unexpectedly succeeded');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('28', 'ingestible rights states require every product permission',
      msg like '%wbh_sources_ingestible_needs_permission%', msg);
  end;
end $t$;

-- 29 purging bytes cannot be used to rewrite captured metadata
do $t$
declare doc uuid; msg text; st text;
begin
  insert into public.wbh_source_documents
    (source_id, retrieved_at, content_sha256, storage_state, r2_bucket, r2_key, rights_state_at_capture, content_type)
  values
    ('wikidata', now(), repeat('f',64), 'stored', 'wbh-raw', 'wbh/wikidata/' || repeat('f',64), 'approved_commercial', 'application/json')
  returning document_id into doc;
  begin
    update public.wbh_source_documents
       set storage_state='purged', purge_reason='proof', content_type='text/plain'
     where document_id=doc;
    insert into _proof values ('29', 'purge cannot rewrite captured source metadata', false, 'rewrite unexpectedly succeeded');
  exception when others then
    msg := sqlerrm;
    update public.wbh_source_documents set storage_state='purged', purge_reason='proof cleanup' where document_id=doc;
    select storage_state into st from public.wbh_source_documents where document_id=doc;
    insert into _proof values ('29', 'purge cannot rewrite captured source metadata',
      msg like '%purge cannot rewrite%' and st='purged', msg);
  end;
end $t$;

-- 30 even two approved sources cannot be mixed into one provenance chain
do $t$
declare run uuid; doc uuid; msg text;
begin
  insert into public.wbh_ingestion_runs
    (source_id, adapter_id, adapter_version, transformation_version, mode, as_of)
  values ('pbe_curation', 'proof', '1.0.0', 'v1', 'ingest', now()) returning run_id into run;
  insert into public.wbh_source_documents
    (source_id, retrieved_at, content_sha256, storage_state, r2_bucket, r2_key, rights_state_at_capture)
  values ('wikidata', now(), repeat('9',64), 'stored', 'wbh-raw', 'wbh/wikidata/' || repeat('9',64), 'approved_commercial')
  returning document_id into doc;
  begin
    insert into public.wbh_venues (venue_id, display_name, ingestion_run_id, source_document_id)
    values ('vn_cross_source', 'Cross Source', run, doc);
    insert into _proof values ('30', 'approved run and approved document must belong to the same source', false, 'cross-source write succeeded');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('30', 'approved run and approved document must belong to the same source',
      msg like '%belongs to%ingestion run%', msg);
  end;
end $t$;

-- 31 franchise identity is canonical data too and must carry provenance
do $t$
declare msg text;
begin
  begin
    insert into public.wbh_franchises (franchise_id, canonical_name) values ('fr_missing_prov', 'Missing Provenance');
    insert into _proof values ('31', 'franchises cannot bypass canonical provenance', false, 'insert unexpectedly succeeded');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('31', 'franchises cannot bypass canonical provenance',
      msg like '%ingestion_run_id%' or msg like '%provenance is not optional%', msg);
  end;
end $t$;

-- 32 corrections require a new run and leave an immutable before/after revision
do $t$
declare oldrun uuid; run2 uuid; doc uuid; msg text; before_n int; after_n int; obs timestamptz; retrieved timestamptz;
begin
  select ingestion_run_id, source_document_id into oldrun, doc from public.wbh_games where game_id='gm_syn_2024_001';
  begin
    update public.wbh_games set attendance=1, attendance_known=true where game_id='gm_syn_2024_001';
    insert into _proof values ('32', 'canonical correction needs a new run and leaves a revision', false, 'same-run update succeeded');
  exception when others then
    msg := sqlerrm;
    select count(*) into before_n from public.wbh_fact_revisions where table_name='wbh_games';
    insert into public.wbh_ingestion_runs
      (source_id, adapter_id, adapter_version, transformation_version, mode, as_of)
    values ('synthetic_fixture', 'fixture-correction', '1.0.1', 'v1', 'revalidate', '2024-12-31T00:00:00Z') returning run_id into run2;
    update public.wbh_games set attendance=1, attendance_known=true, ingestion_run_id=run2 where game_id='gm_syn_2024_001';
    select count(*) into after_n from public.wbh_fact_revisions where table_name='wbh_games';
    select g.observed_at, d.retrieved_at into obs, retrieved from public.wbh_games g join public.wbh_source_documents d on d.document_id=g.source_document_id where g.game_id='gm_syn_2024_001';
    insert into _proof values ('32', 'canonical correction needs a new run and leaves a revision',
      msg like '%new ingestion_run_id%' and after_n=before_n+1 and obs=retrieved,
      format('revisions %s -> %s; observed=%s source=%s', before_n, after_n, obs, retrieved));
  end;
end $t$;

-- 33 a polymorphic provider id may not point at a canonical entity that does not exist
do $t$
declare run uuid; msg text;
begin
  select run_id into run from public.wbh_ingestion_runs where source_id='synthetic_fixture' and status='running' limit 1;
  begin
    insert into public.wbh_entity_source_ids
      (entity_type, entity_id, source_id, external_id, status, tier, confidence, method, ingestion_run_id, derivation)
    values ('person', 'gp_ZZZZZZZZZZZZ', 'wikidata', 'Q404404', 'candidate', 'T5', 0.5, 'proof', run, 'proof identity');
    insert into _proof values ('33', 'provider ids cannot target nonexistent canonical entities', false, 'insert unexpectedly succeeded');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('33', 'provider ids cannot target nonexistent canonical entities', msg like '%missing canonical person%', msg);
  end;
end $t$;

-- 34 player/team stat rows must reference a team that actually participated in the game
do $t$
declare run uuid; msg text;
begin
  select run_id into run from public.wbh_ingestion_runs where source_id='synthetic_fixture' and status='running' limit 1;
  insert into public.wbh_franchises (franchise_id, canonical_name, ingestion_run_id, derivation)
    values ('fr_syn_c', 'Synthetic C', run, 'proof');
  insert into public.wbh_teams (team_id, team_kind, franchise_id, canonical_name, ingestion_run_id, derivation)
    values ('tm_syn_c', 'club', 'fr_syn_c', 'Synthetic C', run, 'proof');
  insert into public.wbh_team_editions (team_edition_id, team_id, edition_id, display_name, ingestion_run_id, derivation)
    values ('te_syn_c_2024', 'tm_syn_c', 'syn_league_2024', 'Synthetic C', run, 'proof');
  begin
    insert into public.wbh_team_game_stats (game_id, team_edition_id, points, ingestion_run_id, derivation)
    values ('gm_syn_2024_001', 'te_syn_c_2024', 70, run, 'proof');
    insert into _proof values ('34', 'statistics can only reference teams participating in the game', false, 'insert unexpectedly succeeded');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('34', 'statistics can only reference teams participating in the game',
      msg like '%wbh_team_game_stats_team_in_game_fk%' or msg like '%foreign key%', msg);
  end;
end $t$;

-- 35 global derived datasets are null-safe unique too (NULL edition is not an escape hatch)
do $t$
declare run uuid; msg text; stamp timestamptz := '2024-12-31T00:00:00Z';
begin
  select run_id into run from public.wbh_ingestion_runs where source_id='synthetic_fixture' and status='running' limit 1;
  insert into public.wbh_derived_datasets (kind, edition_id, as_of, rule_version, input_sha256, dataset_sha256, row_count, is_synthetic, ingestion_run_id)
  values ('career_totals', null, stamp, 'proof-v1', repeat('1',64), repeat('2',64), 0, true, run);
  begin
    insert into public.wbh_derived_datasets (kind, edition_id, as_of, rule_version, input_sha256, dataset_sha256, row_count, is_synthetic, ingestion_run_id)
    values ('career_totals', null, stamp, 'proof-v1', repeat('3',64), repeat('4',64), 0, true, run);
    insert into _proof values ('35', 'global derived datasets are unique even with NULL edition_id', false, 'duplicate unexpectedly succeeded');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('35', 'global derived datasets are unique even with NULL edition_id', msg like '%wbh_derived_datasets_unique%', msg);
  end;
end $t$;

-- 36 canonical primary keys can never be rewritten by a correction
do $t$
declare run3 uuid; msg text;
begin
  insert into public.wbh_ingestion_runs
    (source_id, adapter_id, adapter_version, transformation_version, mode, as_of)
  values ('synthetic_fixture', 'fixture-key-test', '1.0.2', 'v1', 'revalidate', '2024-12-31T00:00:00Z') returning run_id into run3;
  begin
    update public.wbh_games set game_id='gm_syn_2024_rewritten', ingestion_run_id=run3 where game_id='gm_syn_2024_001';
    insert into _proof values ('36', 'canonical primary keys are immutable', false, 'primary key rewrite succeeded');
  exception when others then
    msg := sqlerrm;
    insert into _proof values ('36', 'canonical primary keys are immutable', msg like '%primary key wbh_games.game_id is immutable%', msg);
  end;
end $t$;

reset role;

-- ================================================================ exposure

insert into _proof select '22', 'RLS is enabled on every wbh table with zero policies',
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'wbh\_%')
  and not exists (select 1 from pg_policies where tablename like 'wbh\_%'),
  (select count(*)::text || ' wbh tables, ' || (select count(*) from pg_policies where tablename like 'wbh\_%')::text || ' policies'
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'wbh\_%');

insert into _proof select '23', 'anon and authenticated hold no privilege on any wbh object',
  not exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name like 'wbh\_%' and grantee in ('anon', 'authenticated')),
  coalesce((select string_agg(distinct grantee || ':' || table_name, ', ')
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name like 'wbh\_%' and grantee in ('anon', 'authenticated')), 'none');

insert into _proof select '23b', 'anon and authenticated cannot execute any wbh function',
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname like 'wbh\_%'
       and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  coalesce((select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname like 'wbh\_%'
       and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))), 'none');

insert into _proof select '24', 'product views are security_invoker and exclude synthetic rows',
  (select bool_and(coalesce(c.reloptions::text like '%security_invoker=true%', false))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v' and c.relname in ('wbh_games_public', 'wbh_persons_public'))
  and (select count(*) from public.wbh_games_public) = 0
  and (select count(*) from public.wbh_games) > 0,
  format('%s synthetic games hidden from the public view', (select count(*) from public.wbh_games));

-- 25 every canonical fact table carries the full provenance + temporal column set
insert into _proof select '25', 'every canonical fact table carries the full provenance and temporal column set',
  not exists (
    select 1
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('source_document_id'), ('ingestion_run_id'), ('transformation_version'), ('derivation'),
                         ('confidence'), ('effective_at'), ('observed_at'), ('recorded_at'), ('is_synthetic')) req(col)
     where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'wbh\_%'
       and c.relname not in ('wbh_sources', 'wbh_source_rights_revisions', 'wbh_source_documents',
                             'wbh_ingestion_runs', 'wbh_quarantine_observations', 'wbh_identity_candidates',
                             'wbh_identity_events', 'wbh_fact_revisions', 'wbh_derived_datasets', 'wbh_standings',
                             'wbh_series', 'wbh_roster_stints', 'wbh_player_season_totals',
                             'wbh_record_definitions', 'wbh_record_holders')
       and not exists (select 1 from pg_attribute a where a.attrelid=c.oid and a.attname=req.col and not a.attisdropped)
  ),
  'checked source/run/version/derivation/confidence/effective/observed/recorded/synthetic columns';

-- 26 nothing outside wbh_* changed
update _fp set after_fp = pg_temp._fingerprint();

insert into _proof select '26', 'no object outside wbh_* was created, altered or re-permissioned',
  f.before_fp = f.after_fp
  and f.before_rel_count = (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                             where n.nspname not like 'pg\_temp%' and n.nspname not like 'pg\_toast%' and c.relname not like 'wbh\_%'),
  format('fingerprint %s -> %s', left(f.before_fp, 12), left(f.after_fp, 12)) from _fp f;

insert into _proof select '27', 'the frozen PBE ledger and the entitlement surface gained and lost nothing',
  f.before_pbe_count = (select count(*) from pg_class where relname like 'wnba\_pbe%')
  and f.before_entitlement_count = (select count(*) from pg_class where relname like 'pbe\_sport\_entitlements%'),
  format('wnba_pbe relations %s -> %s (contents also covered by the check 26 fingerprint)',
         f.before_pbe_count, (select count(*) from pg_class where relname like 'wnba\_pbe%')) from _fp f;
