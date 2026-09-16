-- Women's Basketball History — season roster evidence ledger v1
--
-- This table stores source-backed roster observations. It is intentionally separate from
-- wbh_roster_stints, which remains appearance-derived from rights-clean games.
-- An evidence row may stay identity-unresolved; names are never auto-linked by name alone.

begin;

create table if not exists public.wbh_season_roster_evidence (
  evidence_id             text primary key check (evidence_id ~ '^rse_[0-9a-f]{24}$'),
  edition_id              text not null references public.wbh_competition_editions (edition_id) on update cascade,
  team_edition_id         text not null references public.wbh_team_editions (team_edition_id) on update cascade,
  person_id               text references public.wbh_persons (person_id) on update cascade,
  source_player_name      text not null check (btrim(source_player_name) <> ''),
  source_birth_date       date,
  source_birth_precision  text check (source_birth_precision in ('day','month','year')),
  evidence_kind           text not null check (evidence_kind in ('opening_roster','dated_roster','transaction','season_summary','game_appearance')),
  effective_on            date,
  citation_url            text not null check (citation_url ~ '^https://'),
  citation_title          text not null check (btrim(citation_title) <> ''),
  citation_publisher      text not null check (btrim(citation_publisher) <> ''),
  identity_status         text not null default 'unresolved' check (identity_status in ('linked','unresolved','conflict')),
  identity_tier           text check (identity_tier in ('T1','T2','T3','T4','T5')),
  identity_confidence     numeric check (identity_confidence > 0 and identity_confidence <= 1),
  identity_method         text,
  identity_note           text,
  source_document_id      uuid references public.wbh_source_documents (document_id),
  ingestion_run_id        uuid not null references public.wbh_ingestion_runs (run_id),
  transformation_version  text not null default 'v1',
  derivation              text,
  confidence              numeric not null default 1.0 check (confidence > 0 and confidence <= 1),
  effective_at            timestamptz,
  observed_at             timestamptz not null,
  recorded_at             timestamptz not null,
  is_synthetic            boolean not null default false,
  constraint wbh_roster_evidence_birth_precision check ((source_birth_date is null) = (source_birth_precision is null)),
  constraint wbh_roster_evidence_identity_shape check (
    (identity_status = 'linked' and person_id is not null and identity_tier is not null and identity_confidence is not null and nullif(btrim(identity_method),'') is not null)
    or (identity_status = 'unresolved' and person_id is null)
    or (identity_status = 'conflict')
  ),
  unique (team_edition_id, evidence_kind, effective_on, citation_url, source_player_name)
);

create index if not exists wbh_season_roster_evidence_team_idx
  on public.wbh_season_roster_evidence (team_edition_id, effective_on);
create index if not exists wbh_season_roster_evidence_person_idx
  on public.wbh_season_roster_evidence (person_id) where person_id is not null;
create index if not exists wbh_season_roster_evidence_identity_idx
  on public.wbh_season_roster_evidence (identity_status, team_edition_id);
create index if not exists wbh_season_roster_evidence_recorded_idx
  on public.wbh_season_roster_evidence (recorded_at);

comment on table public.wbh_season_roster_evidence is
  'Source-backed roster observations only. Never substitute this table for appearance-derived wbh_roster_stints.';
comment on column public.wbh_season_roster_evidence.identity_status is
  'linked requires non-name-only identity evidence. unresolved preserves the source fact without guessing a person_id.';

-- A roster observation must point to a team edition in the same competition edition.
create or replace function public.wbh_season_roster_evidence_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actual_edition text;
begin
  select te.edition_id into actual_edition
    from public.wbh_team_editions te
   where te.team_edition_id = new.team_edition_id;
  if actual_edition is null or actual_edition <> new.edition_id then
    raise exception 'wbh: roster evidence team edition % does not belong to edition %', new.team_edition_id, new.edition_id
      using errcode='P0001';
  end if;
  if new.identity_status = 'linked' and new.identity_tier = 'T5' then
    raise exception 'wbh: name-only T5 roster evidence may not be linked automatically' using errcode='P0001';
  end if;
  return new;
end $$;

drop trigger if exists wbh_season_roster_evidence_guard_trg on public.wbh_season_roster_evidence;
create trigger wbh_season_roster_evidence_guard_trg
  before insert or update on public.wbh_season_roster_evidence
  for each row execute function public.wbh_season_roster_evidence_guard();

drop trigger if exists wbh_season_roster_evidence_key_immutable_trg on public.wbh_season_roster_evidence;
create trigger wbh_season_roster_evidence_key_immutable_trg
  before update on public.wbh_season_roster_evidence
  for each row execute function public.wbh_primary_key_immutable();

drop trigger if exists wbh_season_roster_evidence_provenance_trg on public.wbh_season_roster_evidence;
create trigger wbh_season_roster_evidence_provenance_trg
  before insert or update on public.wbh_season_roster_evidence
  for each row execute function public.wbh_provenance_guard();

drop trigger if exists wbh_season_roster_evidence_revision_trg on public.wbh_season_roster_evidence;
create trigger wbh_season_roster_evidence_revision_trg
  after update on public.wbh_season_roster_evidence
  for each row execute function public.wbh_fact_revision_audit();

alter table public.wbh_season_roster_evidence enable row level security;
revoke all on public.wbh_season_roster_evidence from anon, authenticated;
grant select, insert, update on public.wbh_season_roster_evidence to service_role;

revoke execute on function public.wbh_season_roster_evidence_guard() from public, anon, authenticated;
grant execute on function public.wbh_season_roster_evidence_guard() to service_role;

commit;
