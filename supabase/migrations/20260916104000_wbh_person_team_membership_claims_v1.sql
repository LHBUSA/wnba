-- Women's Basketball History — rights-clean person/team membership evidence v1
--
-- This is NOT the season roster table. wbh_roster_stints remains appearance-derived.
-- These rows preserve source statements (initially Wikidata P54) as provenance-backed evidence
-- that can later support identity resolution, club canonicalization, and roster reconciliation.

begin;

create table if not exists public.wbh_person_team_membership_claims (
  membership_claim_id text primary key check (membership_claim_id ~ '^mbr_[0-9a-f]{24}$'),
  person_id            text not null references public.wbh_persons (person_id) on update cascade,
  source_team_qid      text not null check (source_team_qid ~ '^Q[1-9][0-9]*$'),
  team_id              text references public.wbh_teams (team_id) on update cascade,
  source_statement_id  text not null check (btrim(source_statement_id) <> ''),
  statement_rank       text not null default 'normal' check (statement_rank in ('preferred', 'normal')),
  started_on           date,
  started_on_precision text check (started_on_precision in ('day', 'month', 'year')),
  ended_on             date,
  ended_on_precision   text check (ended_on_precision in ('day', 'month', 'year')),
  qualifier_evidence   jsonb not null default '{}'::jsonb,
  source_document_id   uuid references public.wbh_source_documents (document_id),
  ingestion_run_id     uuid not null references public.wbh_ingestion_runs (run_id),
  transformation_version text not null default 'v1',
  derivation           text,
  confidence           numeric not null default 1.0 check (confidence > 0 and confidence <= 1),
  effective_at         timestamptz,
  observed_at          timestamptz not null,
  recorded_at          timestamptz not null,
  is_synthetic         boolean not null default false,
  constraint wbh_membership_start_precision check ((started_on is null) = (started_on_precision is null)),
  constraint wbh_membership_end_precision check ((ended_on is null) = (ended_on_precision is null)),
  constraint wbh_membership_range check (started_on is null or ended_on is null or started_on <= ended_on),
  unique (source_statement_id)
);

create index if not exists wbh_person_team_membership_person_idx
  on public.wbh_person_team_membership_claims (person_id);
create index if not exists wbh_person_team_membership_source_team_idx
  on public.wbh_person_team_membership_claims (source_team_qid);
create index if not exists wbh_person_team_membership_team_idx
  on public.wbh_person_team_membership_claims (team_id) where team_id is not null;
create index if not exists wbh_person_team_membership_recorded_idx
  on public.wbh_person_team_membership_claims (recorded_at);

comment on table public.wbh_person_team_membership_claims is
  'Source-backed team-membership statements. Evidence only: season rosters are still derived from appearances in wbh_roster_stints.';
comment on column public.wbh_person_team_membership_claims.team_id is
  'Optional canonical team mapping. NULL means the source team entity has not yet been canonicalized.';
comment on column public.wbh_person_team_membership_claims.qualifier_evidence is
  'Normalized source qualifier facts only; provider prose is never stored.';

-- Use the same fail-closed provenance and immutable-key contract as every canonical WBH fact.
drop trigger if exists wbh_person_team_membership_claims_key_immutable_trg on public.wbh_person_team_membership_claims;
create trigger wbh_person_team_membership_claims_key_immutable_trg
  before update on public.wbh_person_team_membership_claims
  for each row execute function public.wbh_primary_key_immutable();

drop trigger if exists wbh_person_team_membership_claims_provenance_trg on public.wbh_person_team_membership_claims;
create trigger wbh_person_team_membership_claims_provenance_trg
  before insert or update on public.wbh_person_team_membership_claims
  for each row execute function public.wbh_provenance_guard();

drop trigger if exists wbh_person_team_membership_claims_revision_trg on public.wbh_person_team_membership_claims;
create trigger wbh_person_team_membership_claims_revision_trg
  after update on public.wbh_person_team_membership_claims
  for each row execute function public.wbh_fact_revision_audit();

-- 2024 evidence view is deliberately conservative. An undated P54 statement does NOT become
-- a 2024 roster fact. At least one temporal qualifier is required for qualified_overlap.
create or replace view public.wbh_wnba_2024_membership_evidence
with (security_invoker = true) as
select
  c.membership_claim_id,
  c.person_id,
  c.team_id,
  c.source_team_qid,
  c.source_statement_id,
  c.statement_rank,
  c.started_on,
  c.started_on_precision,
  c.ended_on,
  c.ended_on_precision,
  case
    when c.started_on is null and c.ended_on is null then 'undated_claim'
    when (c.started_on is null or c.started_on <= date '2024-12-31')
     and (c.ended_on is null or c.ended_on >= date '2024-01-01') then 'qualified_overlap'
    else 'outside_2024'
  end as evidence_class,
  c.qualifier_evidence,
  c.observed_at,
  c.recorded_at
from public.wbh_person_team_membership_claims c
join public.wbh_ingestion_runs r on r.run_id = c.ingestion_run_id
join public.wbh_sources s on s.source_id = r.source_id
where c.team_id is not null
  and not c.is_synthetic
  and s.rights_state = any (public.wbh_ingestible_states());

alter table public.wbh_person_team_membership_claims enable row level security;
revoke all on public.wbh_person_team_membership_claims from anon, authenticated;
grant select, insert, update on public.wbh_person_team_membership_claims to service_role;

revoke all on public.wbh_wnba_2024_membership_evidence from anon, authenticated;
grant select on public.wbh_wnba_2024_membership_evidence to service_role;

-- CREATE TRIGGER/VIEW did not add callable functions, but keep the sequence ACL policy consistent.
do $acl$
declare r record;
begin
  for r in
    select c.oid::regclass as seq from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'wbh\_%'
  loop
    execute format('revoke all on sequence %s from anon, authenticated', r.seq);
    execute format('grant usage, select on sequence %s to service_role', r.seq);
  end loop;
end $acl$;

commit;
