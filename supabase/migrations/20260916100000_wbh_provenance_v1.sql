-- PropBetEdge — Women's Basketball History (wbh) provenance + source-rights plumbing v1
-- Target: Supabase tkmlnhmylqnttmnsnief (models / predictions / markets / history).
--
-- OWNER DECISIONS ENCODED HERE (2026-09-15):
--   D1  ESPN is rights-blocked for bulk historical ingestion and raw retention. It is seeded as
--       'prohibited' below. The live WNBA product's own ESPN reads are a different system and are
--       untouched by this migration; this registry governs wbh_* ingestion only.
--   D2  Storage is this project under a dedicated wbh_* namespace, raw artifacts in R2, additive
--       migrations only, every canonical fact carrying full provenance.
--
-- This migration creates ONLY wbh_* objects. It does not touch any existing table, view, function,
-- trigger, policy or role, and in particular touches nothing named wnba_pbe_* (the frozen model
-- ledger), nothing in the billing project, and no auth/paywall object. Every statement is
-- re-runnable.
--
-- THE CENTRAL RULE: ingestion fails CLOSED. A source that is not explicitly in an approved state
-- cannot produce a real ingestion run, cannot have raw bytes retained, and cannot become canonical
-- data. The default for an unknown or unreviewed source is refusal, not permission.

begin;

-- ------------------------------------------------------------------ rights vocabulary

-- The six states the owner defined. Kept as a function so every check constraint, trigger and
-- future migration reads one definition instead of copying a string list.
create or replace function public.wbh_rights_states() returns text[]
language sql immutable
set search_path = ''
as $$ select array['approved_commercial', 'approved_attribution', 'licensed', 'evaluation_only', 'prohibited', 'unresolved'] $$;

-- Only these three may produce canonical data. evaluation_only and unresolved are quarantine;
-- prohibited is refusal.
create or replace function public.wbh_ingestible_states() returns text[]
language sql immutable
set search_path = ''
as $$ select array['approved_commercial', 'approved_attribution', 'licensed'] $$;

create or replace function public.wbh_permission_values() returns text[]
language sql immutable
set search_path = ''
as $$ select array['permitted', 'forbidden', 'separate_license', 'unknown'] $$;

create or replace function public.wbh_reject_mutation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'wbh: % rows are append-only (% rejected)', tg_table_name, tg_op
    using errcode = 'P0001', hint = coalesce(tg_argv[0], 'insert a new record instead');
end $$;

create or replace function public.wbh_reject_truncate() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'wbh: % cannot be truncated', tg_table_name using errcode = 'P0001';
end $$;

-- ------------------------------------------------------------------ 1. source registry

create table if not exists public.wbh_sources (
  source_id             text primary key check (source_id ~ '^[a-z][a-z0-9_]{2,63}$'),
  display_name          text not null,
  publisher             text,
  homepage_url          text,

  -- rights state drives every gate in this schema
  rights_state          text not null check (rights_state = any (public.wbh_rights_states())),
  rights_basis          text not null check (rights_basis in ('public_domain', 'cc0', 'open_license', 'contract_license', 'terms_of_use', 'unknown')),
  license_id            text,                       -- SPDX id, or the vendor contract reference
  license_url           text,
  terms_url             text,
  terms_quote           text,                       -- the clause we actually read, verbatim
  terms_reviewed_at     timestamptz,
  terms_reviewed_by     text,

  -- the four questions that decide whether a sports-betting analytics product may use a source
  commercial_use        text not null default 'unknown' check (commercial_use  = any (public.wbh_permission_values())),
  redistribution        text not null default 'unknown' check (redistribution  = any (public.wbh_permission_values())),
  database_build        text not null default 'unknown' check (database_build  = any (public.wbh_permission_values())),
  gambling_use          text not null default 'unknown' check (gambling_use    = any (public.wbh_permission_values())),

  raw_storage_allowed   boolean not null default false,   -- may we retain the raw payload in R2?
  attribution_required  boolean not null default false,
  attribution_text      text,

  historical_depth      jsonb not null default '{}'::jsonb,   -- {competition: {from, to, fields: []}}
  capabilities          text[] not null default '{}',         -- box_score, play_by_play, identity, awards, ...
  is_synthetic          boolean not null default false,       -- fixtures/test data; never real history
  review_due            date,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- an approved state must be justified by the recorded answers, so nobody can mark a source
  -- approved while its own row still says the terms forbid what we want to do
  -- Fail closed on every permission dimension that matters to this commercial betting product.
  -- A friendly-looking state label may never contradict the actual reviewed permissions.
  constraint wbh_sources_ingestible_needs_permission check (
    rights_state <> all (public.wbh_ingestible_states())
    or (commercial_use = 'permitted'
        and redistribution = 'permitted'
        and database_build = 'permitted'
        and gambling_use = 'permitted')
  ),
  constraint wbh_sources_attribution_state check (
    rights_state <> 'approved_attribution'
    or (attribution_required and nullif(btrim(attribution_text), '') is not null)
  ),
  constraint wbh_sources_licensed_needs_license check (
    rights_state <> 'licensed' or license_id is not null
  ),
  -- raw bytes may only be retained for a source that is both ingestible and explicitly permits storage
  constraint wbh_sources_raw_storage_needs_approval check (
    not raw_storage_allowed or rights_state = any (public.wbh_ingestible_states())
  ),
  -- a review is only a review if it says when and who
  constraint wbh_sources_reviewed_pair check (
    (terms_reviewed_at is null) = (terms_reviewed_by is null)
  ),
  -- an approved source must have been reviewed by a human at a known time
  constraint wbh_sources_approved_needs_review check (
    rights_state <> all (public.wbh_ingestible_states()) or terms_reviewed_at is not null
  )
);

comment on table public.wbh_sources is
  'Source-rights registry. Ingestion fails closed: only rights_state in wbh_ingestible_states() may produce canonical data.';

-- Every rights change is kept forever. A source moving from prohibited to approved is the single
-- most consequential edit in this schema, so it leaves an immutable trail.
create table if not exists public.wbh_source_rights_revisions (
  revision_id     bigint generated always as identity primary key,
  source_id       text not null,
  changed_at      timestamptz not null default now(),
  changed_by      text not null default current_user,
  operation       text not null check (operation in ('insert', 'update')),
  rights_state    text not null,
  previous_state  text,
  row_snapshot    jsonb not null
);

create index if not exists wbh_source_rights_revisions_source_idx
  on public.wbh_source_rights_revisions (source_id, changed_at desc);

create or replace function public.wbh_sources_audit() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := clock_timestamp();
    new.created_at := old.created_at;
  end if;
  insert into public.wbh_source_rights_revisions (source_id, operation, rights_state, previous_state, row_snapshot)
  values (new.source_id, lower(tg_op), new.rights_state,
          case when tg_op = 'UPDATE' then old.rights_state end,
          to_jsonb(new));
  return new;
end $$;

drop trigger if exists wbh_sources_audit_trg on public.wbh_sources;
create trigger wbh_sources_audit_trg before insert or update on public.wbh_sources
  for each row execute function public.wbh_sources_audit();

drop trigger if exists wbh_source_rights_revisions_immutable on public.wbh_source_rights_revisions;
create trigger wbh_source_rights_revisions_immutable before update or delete on public.wbh_source_rights_revisions
  for each row execute function public.wbh_reject_mutation('rights history is permanent');

-- ------------------------------------------------------------------ 2. the gate

-- Single authority for "may this source produce canonical data right now". Raises, never returns
-- false, so a caller that forgets to check the result still cannot proceed.
create or replace function public.wbh_assert_ingestible(p_source_id text) returns public.wbh_sources
language plpgsql stable
set search_path = ''
as $$
declare
  src public.wbh_sources;
begin
  select * into src from public.wbh_sources where source_id = p_source_id;
  if not found then
    raise exception 'wbh: source % is not registered; ingestion fails closed', p_source_id
      using errcode = 'P0001', hint = 'register the source and record its terms before ingesting';
  end if;
  if not (src.rights_state = any (public.wbh_ingestible_states())) then
    raise exception 'wbh: source % is % and may not produce canonical data', p_source_id, src.rights_state
      using errcode = 'P0001', hint = 'quarantine only: evaluation_only, unresolved and prohibited sources are never canonical';
  end if;
  return src;
end $$;

-- ------------------------------------------------------------------ 3. raw artifact index (R2)

create table if not exists public.wbh_source_documents (
  document_id             uuid primary key default gen_random_uuid(),
  source_id               text not null references public.wbh_sources (source_id) on update cascade,
  source_record_id        text,                       -- the source's own identifier for this record
  request_url             text,
  request_method          text not null default 'GET',
  retrieved_at            timestamptz not null,
  http_status             integer,
  content_sha256          text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  content_type            text,
  byte_size               bigint check (byte_size >= 0),

  -- content addressed: the R2 key is derived from the hash, never from a mutable name
  storage_state           text not null check (storage_state in ('stored', 'hash_only', 'not_stored_rights', 'purged')),
  r2_bucket               text,
  r2_key                  text,

  -- rights as they stood at capture time, stamped by the server, not supplied by the writer
  rights_state_at_capture text not null check (rights_state_at_capture = any (public.wbh_rights_states())),
  license_id_at_capture   text,
  transformation_version  text,
  is_synthetic            boolean not null default false,
  notes                   text,
  purged_at               timestamptz,
  purge_reason            text,
  recorded_at             timestamptz not null default now(),
  constraint wbh_source_documents_stored_needs_key check (
    storage_state <> 'stored' or (r2_bucket is not null and r2_key is not null)
  ),
  constraint wbh_source_documents_nonstored_has_no_key check (
    storage_state = 'stored' or (r2_bucket is null and r2_key is null)
  ),
  constraint wbh_source_documents_purge_pair check (
    (storage_state = 'purged') = (purged_at is not null)
  )
);

-- The same bytes can legitimately be observed more than once. Deduplicate R2 by hash/key, not the
-- observation ledger: repeated captures are required for trustworthy as-of reconstruction.
create index if not exists wbh_source_documents_source_idx on public.wbh_source_documents (source_id, retrieved_at desc);
create index if not exists wbh_source_documents_hash_idx on public.wbh_source_documents (source_id, content_sha256);
create index if not exists wbh_source_documents_r2_key_idx
  on public.wbh_source_documents (r2_bucket, r2_key) where storage_state = 'stored';

create or replace function public.wbh_source_documents_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  src public.wbh_sources;
begin
  select * into src from public.wbh_sources where source_id = new.source_id;
  if not found then
    raise exception 'wbh: source % is not registered', new.source_id using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    -- the writer never chooses these
    new.rights_state_at_capture := src.rights_state;
    new.license_id_at_capture   := src.license_id;
    new.is_synthetic            := src.is_synthetic;
    new.recorded_at             := clock_timestamp();

    if new.storage_state = 'purged' then
      raise exception 'wbh: a source document cannot be inserted already purged' using errcode = 'P0001';
    end if;
    new.purged_at := null;
    new.purge_reason := null;

    if new.storage_state = 'stored' and not src.raw_storage_allowed then
      raise exception 'wbh: source % does not permit raw retention; record the hash only', new.source_id
        using errcode = 'P0001', hint = 'set storage_state = not_stored_rights';
    end if;
    if new.storage_state = 'stored' and not (src.rights_state = any (public.wbh_ingestible_states())) then
      raise exception 'wbh: source % is % and its raw bytes may not be retained', new.source_id, src.rights_state
        using errcode = 'P0001';
    end if;
    -- the R2 key must contain the content hash: content addressing is structural, not a convention
    if new.storage_state = 'stored' and position(new.content_sha256 in new.r2_key) = 0 then
      raise exception 'wbh: r2_key must be content addressed and contain the sha256'
        using errcode = 'P0001', hint = 'wbh/<source>/<sha256>[.ext]';
    end if;
    return new;
  end if;

  -- The only legal edit is retiring the bytes. Purging may not be smuggled together with a rewrite
  -- of the source URL, hash, rights snapshot, parser version, notes, or any other captured fact.
  if old.storage_state = 'stored' and new.storage_state = 'purged' then
    if (to_jsonb(new) - array['storage_state','r2_bucket','r2_key','purged_at','purge_reason'])
       <> (to_jsonb(old) - array['storage_state','r2_bucket','r2_key','purged_at','purge_reason']) then
      raise exception 'wbh: source documents are append-only; purge cannot rewrite captured metadata'
        using errcode = 'P0001';
    end if;
    if nullif(btrim(new.purge_reason), '') is null then
      raise exception 'wbh: purge_reason is required when retiring stored bytes' using errcode = 'P0001';
    end if;
    new.r2_key := null;
    new.r2_bucket := null;
    new.purged_at := clock_timestamp();
    return new;
  end if;
  raise exception 'wbh: source documents are append-only (only stored -> purged is allowed)'
    using errcode = 'P0001';
end $$;

drop trigger if exists wbh_source_documents_guard_trg on public.wbh_source_documents;
create trigger wbh_source_documents_guard_trg before insert or update on public.wbh_source_documents
  for each row execute function public.wbh_source_documents_guard();

drop trigger if exists wbh_source_documents_no_delete on public.wbh_source_documents;
create trigger wbh_source_documents_no_delete before delete on public.wbh_source_documents
  for each row execute function public.wbh_reject_mutation('purge the bytes, keep the record');

-- ------------------------------------------------------------------ 4. ingestion runs

create table if not exists public.wbh_ingestion_runs (
  run_id                 uuid primary key default gen_random_uuid(),
  source_id              text not null references public.wbh_sources (source_id) on update cascade,
  adapter_id             text not null,
  adapter_version        text not null,
  transformation_version text not null,
  mode                   text not null check (mode in ('dry_run', 'ingest', 'backfill', 'revalidate')),
  as_of                  timestamptz not null,       -- the temporal cut this run is allowed to see
  scope                  jsonb not null default '{}'::jsonb,
  status                 text not null default 'running' check (status in ('running', 'ok', 'failed', 'blocked_rights')),
  counts                 jsonb not null default '{}'::jsonb,
  error                  text,
  is_synthetic           boolean not null default false,
  started_at             timestamptz not null default now(),
  finished_at            timestamptz,
  constraint wbh_ingestion_runs_finished_state check (
    (status = 'running' and finished_at is null)
    or (status <> 'running' and finished_at is not null)
  )
);

create index if not exists wbh_ingestion_runs_source_idx on public.wbh_ingestion_runs (source_id, started_at desc);

create or replace function public.wbh_ingestion_runs_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  src public.wbh_sources;
begin
  if tg_op = 'INSERT' then
    select * into src from public.wbh_sources where source_id = new.source_id;
    if not found then
      raise exception 'wbh: source % is not registered; ingestion fails closed', new.source_id using errcode = 'P0001';
    end if;
    new.is_synthetic := src.is_synthetic;
    new.started_at := clock_timestamp();
    new.status := 'running';
    new.finished_at := null;
    new.error := null;
    -- a dry run may profile any source, including a prohibited one, because it writes no canonical data
    if new.mode <> 'dry_run' and not (src.rights_state = any (public.wbh_ingestible_states())) then
      raise exception 'wbh: source % is %; only mode = dry_run is permitted', new.source_id, src.rights_state
        using errcode = 'P0001', hint = 'obtain approval or a licence and update wbh_sources first';
    end if;
    return new;
  end if;
  if new.run_id <> old.run_id or new.source_id <> old.source_id or new.mode <> old.mode
     or new.adapter_id <> old.adapter_id or new.adapter_version <> old.adapter_version
     or new.transformation_version <> old.transformation_version or new.as_of <> old.as_of
     or new.scope <> old.scope or new.is_synthetic <> old.is_synthetic or new.started_at <> old.started_at then
    raise exception 'wbh: an ingestion run''s identity, adapter, scope and temporal cut are immutable' using errcode = 'P0001';
  end if;
  if old.status <> 'running' then
    raise exception 'wbh: a finished ingestion run is immutable' using errcode = 'P0001';
  end if;
  if new.status <> 'running' and new.finished_at is null then
    new.finished_at := clock_timestamp();
  elsif new.status = 'running' and new.finished_at is not null then
    raise exception 'wbh: a running ingestion run cannot have finished_at' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists wbh_ingestion_runs_guard_trg on public.wbh_ingestion_runs;
create trigger wbh_ingestion_runs_guard_trg before insert or update on public.wbh_ingestion_runs
  for each row execute function public.wbh_ingestion_runs_guard();

drop trigger if exists wbh_ingestion_runs_no_delete on public.wbh_ingestion_runs;
create trigger wbh_ingestion_runs_no_delete before delete on public.wbh_ingestion_runs
  for each row execute function public.wbh_reject_mutation('runs are the audit trail');

-- ------------------------------------------------------------------ 5. provenance guard for canonical facts

-- Attached by wbh_core to every canonical fact table. It re-derives the rights decision from the
-- source at write time, so a row cannot be inserted by naming an approved run and a prohibited
-- document, and it stamps the synthetic flag rather than trusting it.
create or replace function public.wbh_provenance_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  doc public.wbh_source_documents;
  run public.wbh_ingestion_runs;
  src public.wbh_sources;
  rec jsonb := to_jsonb(new);
  v_doc uuid := nullif(rec ->> 'source_document_id', '')::uuid;
  v_run uuid := nullif(rec ->> 'ingestion_run_id', '')::uuid;
  synthetic boolean := false;
begin
  if v_run is null then
    raise exception 'wbh: %.ingestion_run_id is required (provenance is not optional)', tg_table_name using errcode = 'P0001';
  end if;
  select * into run from public.wbh_ingestion_runs where run_id = v_run;
  if not found then
    raise exception 'wbh: ingestion run % does not exist', v_run using errcode = 'P0001';
  end if;
  if run.mode = 'dry_run' then
    raise exception 'wbh: a dry run may not write canonical rows' using errcode = 'P0001';
  end if;
  if run.status <> 'running' then
    raise exception 'wbh: ingestion run % is %; canonical writes require an active running run', v_run, run.status
      using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and nullif(to_jsonb(old) ->> 'ingestion_run_id', '')::uuid = v_run then
    raise exception 'wbh: canonical corrections require a new ingestion_run_id so history is auditable'
      using errcode = 'P0001';
  end if;
  src := public.wbh_assert_ingestible(run.source_id);
  synthetic := src.is_synthetic;

  if v_doc is not null then
    select * into doc from public.wbh_source_documents where document_id = v_doc;
    if not found then
      raise exception 'wbh: source document % does not exist', v_doc using errcode = 'P0001';
    end if;
    -- The document must come from the SAME source as the run. Two independently approved sources
    -- are not interchangeable provenance and may not be mixed accidentally.
    perform public.wbh_assert_ingestible(doc.source_id);
    if doc.source_id <> run.source_id then
      raise exception 'wbh: source document % belongs to %, but ingestion run % belongs to %',
        v_doc, doc.source_id, v_run, run.source_id using errcode = 'P0001';
    end if;
    synthetic := synthetic or doc.is_synthetic;
  elsif coalesce(rec ->> 'derivation', '') = '' then
    raise exception 'wbh: %: a row needs either a source_document_id or a derivation', tg_table_name
      using errcode = 'P0001', hint = 'derived rows must name the deterministic rule that produced them';
  elsif run.source_id not in ('pbe_curation', 'synthetic_fixture') then
    raise exception 'wbh: source % canonical facts require a source_document_id; derivation-only writes are reserved for internal curation/fixtures', run.source_id
      using errcode = 'P0001';
  end if;

  new := jsonb_populate_record(new, jsonb_build_object(
    'is_synthetic', synthetic,
    'observed_at', case when v_doc is not null then doc.retrieved_at else run.as_of end,
    'recorded_at', clock_timestamp()
  ));
  return new;
end $$;

-- Every in-place correction keeps the complete before/after snapshots. The current canonical row stays
-- convenient to query, while this immutable ledger makes a past recorded-at view reconstructable.
create table if not exists public.wbh_fact_revisions (
  revision_id       bigint generated always as identity primary key,
  table_name        text not null check (table_name ~ '^wbh_[a-z0-9_]+$'),
  ingestion_run_id  uuid not null references public.wbh_ingestion_runs (run_id),
  source_document_id uuid references public.wbh_source_documents (document_id),
  old_row           jsonb not null,
  new_row           jsonb not null,
  changed_by        text not null default current_user,
  changed_at        timestamptz not null default clock_timestamp()
);

create index if not exists wbh_fact_revisions_table_time_idx
  on public.wbh_fact_revisions (table_name, changed_at desc);

create or replace function public.wbh_fact_revision_audit() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.wbh_fact_revisions
    (table_name, ingestion_run_id, source_document_id, old_row, new_row)
  values
    (tg_table_name, nullif(to_jsonb(new) ->> 'ingestion_run_id', '')::uuid,
     nullif(to_jsonb(new) ->> 'source_document_id', '')::uuid, to_jsonb(old), to_jsonb(new));
  return new;
end $$;

drop trigger if exists wbh_fact_revisions_immutable on public.wbh_fact_revisions;
create trigger wbh_fact_revisions_immutable before update or delete on public.wbh_fact_revisions
  for each row execute function public.wbh_reject_mutation('fact revision history is permanent');

-- Canonical keys are identities, not mutable attributes. Corrections may change fact values under a new
-- ingestion run, but never rewrite the primary key and cascade a different identity through history.
create or replace function public.wbh_primary_key_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  k text;
begin
  for k in
    select a.attname
      from pg_catalog.pg_index i
      join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = tg_relid and i.indisprimary
  loop
    if (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k) then
      raise exception 'wbh: primary key %.% is immutable', tg_table_name, k using errcode = 'P0001';
    end if;
  end loop;
  return new;
end $$;

-- ------------------------------------------------------------------ 6. quarantine

-- Where non-approved material is allowed to land: opaque payloads, never joined to canonical tables,
-- never read by the product. Its only purpose is evaluating whether a source is worth licensing.
create table if not exists public.wbh_quarantine_observations (
  observation_id bigint generated always as identity primary key,
  source_id      text not null references public.wbh_sources (source_id) on update cascade,
  captured_at    timestamptz not null default now(),
  purpose        text not null check (purpose in ('rights_evaluation', 'coverage_probe', 'validation_sample')),
  subject        text,
  payload        jsonb not null,
  expires_at     date,
  notes          text
);

create or replace function public.wbh_quarantine_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  src public.wbh_sources;
begin
  select * into src from public.wbh_sources where source_id = new.source_id;
  if not found then
    raise exception 'wbh: source % is not registered', new.source_id using errcode = 'P0001';
  end if;
  -- approved sources do not belong here; they go to canonical tables with full provenance
  if src.rights_state = any (public.wbh_ingestible_states()) then
    raise exception 'wbh: source % is approved; write canonical rows, not quarantine', new.source_id
      using errcode = 'P0001';
  end if;
  new.captured_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists wbh_quarantine_guard_trg on public.wbh_quarantine_observations;
create trigger wbh_quarantine_guard_trg before insert or update on public.wbh_quarantine_observations
  for each row execute function public.wbh_quarantine_guard();

-- ------------------------------------------------------------------ 7. seed: what we actually know today

-- Nothing here grants a right. Every approved row records terms a human read, and the two approved
-- entries are our own curation and a CC0 dataset. Everything else is refusal or quarantine.
insert into public.wbh_sources (
  source_id, display_name, publisher, homepage_url, rights_state, rights_basis, license_id, license_url,
  terms_url, terms_quote, terms_reviewed_at, terms_reviewed_by,
  commercial_use, redistribution, database_build, gambling_use, raw_storage_allowed,
  attribution_required, attribution_text, capabilities, historical_depth, notes
) values
  ('wikidata', 'Wikidata', 'Wikimedia Foundation', 'https://www.wikidata.org',
   'approved_commercial', 'cc0', 'CC0-1.0', 'https://creativecommons.org/publicdomain/zero/1.0/',
   'https://www.wikidata.org/wiki/Wikidata:Licensing',
   'All structured data from the main, property, lexeme, and EntitySchema namespaces is available under the Creative Commons CC0 License.',
   now(), 'owner-decision-2026-09-15',
   'permitted', 'permitted', 'permitted', 'permitted', true,
   false, null,
   array['identity', 'external_ids', 'birth_date', 'nationality'],
   '{"scope": "persons and clubs, identifiers only; no Wikipedia prose (CC BY-SA share-alike)"}'::jsonb,
   'Identity spine. Structured claims only. Wikipedia article text is a different licence and is NOT covered by this row.'),

  ('pbe_curation', 'PropBetEdge manual curation', 'PropBetEdge', null,
   'approved_commercial', 'public_domain', null, null,
   null, null, now(), 'owner-decision-2026-09-15',
   'permitted', 'permitted', 'permitted', 'permitted', true,
   false, null,
   array['franchise_lineage', 'awards', 'corrections'],
   '{"scope": "facts entered by hand with a citation to a readable public reference"}'::jsonb,
   'Our own entries: franchise lineage, award corrections, competition reference data. Each row still cites where the fact was read.'),

  ('synthetic_fixture', 'Synthetic fixture generator', 'PropBetEdge', null,
   'approved_commercial', 'public_domain', null, null,
   null, null, now(), 'owner-decision-2026-09-15',
   'permitted', 'permitted', 'permitted', 'permitted', true,
   false, null,
   array['box_score', 'play_by_play', 'standings', 'identity'],
   '{"scope": "invented leagues and invented people for engineering acceptance tests"}'::jsonb,
   'Test data only. Rows produced from it are stamped is_synthetic and are excluded from every product view.'),

  ('espn', 'ESPN public JSON endpoints', 'ESPN / The Walt Disney Company', 'https://www.espn.com',
   'prohibited', 'terms_of_use', null, null,
   'https://disneytermsofuse.com/english/',
   'You may not ... use any robot, spider, scraper or other automated means to access the Disney Services ... or compile, build, create or contribute to any collection of data, data set or database.',
   now(), 'owner-decision-2026-09-15',
   'forbidden', 'forbidden', 'forbidden', 'unknown', false,
   false, null,
   array['box_score', 'play_by_play', 'shot_coordinates', 'officials', 'attendance'],
   '{"wnba": {"box_scores_from": 2002, "scores_from": 1998}, "olympics_women": {"from": 2016, "to": 2024}}'::jsonb,
   'D1 2026-09-15: rights-blocked for bulk historical ingestion and raw retention. Deepest coverage we found and still unusable for a commercial archive. The live product''s separate ESPN reads are out of scope of this registry.'),

  ('basketball_reference', 'Basketball-Reference / Sports Reference', 'Sports Reference LLC', 'https://www.basketball-reference.com',
   'prohibited', 'terms_of_use', null, null,
   'https://www.sports-reference.com/termsofuse.html',
   'You may not use any automated means to access the site ... or use the data to create a competing database or product.',
   now(), 'owner-decision-2026-09-15',
   'forbidden', 'forbidden', 'forbidden', 'unknown', false,
   false, null,
   array['box_score', 'awards', 'draft'],
   '{"wnba": {"from": 1997}}'::jsonb,
   'Identifiers may reach us only through Wikidata (P4561 / P4790). Never fetched directly.'),

  ('stats_wnba', 'stats.wnba.com', 'WNBA Enterprises', 'https://stats.wnba.com',
   'prohibited', 'terms_of_use', null, null,
   'https://www.wnba.com/terms-of-use/',
   'Terms bar use of the services in connection with any gambling activity and bar compiling the statistics into a database.',
   now(), 'owner-decision-2026-09-15',
   'forbidden', 'forbidden', 'forbidden', 'forbidden', false,
   false, null,
   array['box_score', 'play_by_play', 'tracking'],
   '{"wnba": {"from": 1997}}'::jsonb,
   'Double blocker for this product: database compilation and gambling use are both barred.'),

  ('fiba', 'FIBA (site, archive, LiveStats)', 'FIBA', 'https://www.fiba.basketball',
   'prohibited', 'terms_of_use', null, null,
   'https://www.fiba.basketball/terms-of-use',
   'No part of the site may be reproduced or stored in a retrieval system without prior written permission.',
   now(), 'owner-decision-2026-09-15',
   'forbidden', 'forbidden', 'forbidden', 'unknown', false,
   false, null,
   array['box_score', 'international_competitions'],
   '{"note": "archive retired; endpoints return 401/403 to automated clients"}'::jsonb,
   'A licensing conversation, not an ingestion target.'),

  ('olympedia', 'Olympedia', 'OlyMADMen', 'https://www.olympedia.org',
   'unresolved', 'unknown', null, null,
   'https://www.olympedia.org/robots.txt',
   'robots.txt permits crawling with Crawl-delay: 10; the site publishes no licence or terms of use.',
   now(), 'owner-decision-2026-09-15',
   'unknown', 'unknown', 'unknown', 'unknown', false,
   false, null,
   array['box_score', 'olympic_history'],
   '{"olympics_women": {"from": 1976, "to": 2024, "tournaments": 13}}'::jsonb,
   'D4: written permission to be requested. Only source with player box scores for every women''s Olympic tournament. Quarantine until answered.'),

  ('wikipedia', 'Wikipedia article text', 'Wikimedia Foundation', 'https://en.wikipedia.org',
   'unresolved', 'open_license', 'CC-BY-SA-4.0', 'https://creativecommons.org/licenses/by-sa/4.0/',
   'https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use',
   'Text is available under CC BY-SA 4.0; derivative works must be shared under the same licence.',
   now(), 'owner-decision-2026-09-15',
   'permitted', 'permitted', 'unknown', 'permitted', false,
   true, 'Wikipedia contributors, CC BY-SA 4.0',
   array['reference', 'lineage_citations'],
   '{}'::jsonb,
   'Share-alike is the trap: prose absorbed into our database could oblige us to licence derivatives alike. Citations and human reading only, never ingestion.'),

  ('olympics_com', 'Olympics.com results', 'International Olympic Committee', 'https://olympics.com',
   'unresolved', 'unknown', null, null,
   'https://olympics.com/en/terms-of-use', null,
   now(), 'owner-decision-2026-09-15',
   'unknown', 'unknown', 'unknown', 'unknown', false,
   false, null,
   array['olympic_results'],
   '{}'::jsonb,
   'Terms page did not load during the audit. NOT VERIFIED; stays unresolved until a human reads it.')
on conflict (source_id) do nothing;

-- Synthetic fixtures are engineering-only. Stamp the seeded source explicitly so every canonical
-- row produced from it is excluded from product views by the provenance guard.
update public.wbh_sources
set is_synthetic = true
where source_id = 'synthetic_fixture'
  and is_synthetic is distinct from true;

-- ------------------------------------------------------------------ 8. access

alter table public.wbh_sources                   enable row level security;
alter table public.wbh_source_rights_revisions   enable row level security;
alter table public.wbh_source_documents          enable row level security;
alter table public.wbh_ingestion_runs            enable row level security;
alter table public.wbh_fact_revisions            enable row level security;
alter table public.wbh_quarantine_observations   enable row level security;

-- RLS on with zero policies: nothing is reachable through anon or authenticated REST. Writers are
-- server-side (service_role) exactly as with the PBE ledger.
revoke all on public.wbh_sources,
              public.wbh_source_rights_revisions,
              public.wbh_source_documents,
              public.wbh_ingestion_runs,
              public.wbh_fact_revisions,
              public.wbh_quarantine_observations
  from anon, authenticated;

grant select, insert, update on public.wbh_sources to service_role;
grant select on public.wbh_source_rights_revisions to service_role;
grant select, insert, update on public.wbh_source_documents to service_role;
grant select, insert, update on public.wbh_ingestion_runs to service_role;
grant select, insert on public.wbh_fact_revisions to service_role;
grant select, insert on public.wbh_quarantine_observations to service_role;
grant usage, select on sequence public.wbh_quarantine_observations_observation_id_seq to service_role;

commit;
