-- Women's Basketball History — multi-source game result evidence v1
--
-- Canonical games keep one provenance lineage, but overlapping team-issued schedules should be able
-- to corroborate the same game without rewriting it. This table records those additional normalized
-- score/result observations so dedupe becomes auditable validation instead of data loss.

begin;

create table if not exists public.wbh_game_result_evidence (
  evidence_id            text primary key check (evidence_id ~ '^gre_[0-9a-f]{24}$'),
  game_id                text not null references public.wbh_games (game_id) on update cascade,
  source_record_id       text not null check (btrim(source_record_id) <> ''),
  evidence_role          text not null check (evidence_role in ('origin','corroboration')),
  local_date             date not null,
  away_team_edition_id   text not null references public.wbh_team_editions (team_edition_id) on update cascade,
  home_team_edition_id   text not null references public.wbh_team_editions (team_edition_id) on update cascade,
  away_points            integer not null check (away_points >= 0),
  home_points            integer not null check (home_points >= 0),
  game_type              text not null check (game_type in ('regular','playoff','final','in_season_cup','group','knockout','qualifier','friendly','all_star','exhibition','classification')),
  stage_id               text references public.wbh_stages (stage_id) on update cascade,
  source_document_id     uuid not null references public.wbh_source_documents (document_id),
  ingestion_run_id       uuid not null references public.wbh_ingestion_runs (run_id),
  transformation_version text not null default 'v1',
  derivation             text,
  confidence             numeric not null default 1.0 check (confidence > 0 and confidence <= 1),
  effective_at           timestamptz,
  observed_at            timestamptz not null,
  recorded_at            timestamptz not null,
  is_synthetic           boolean not null default false,
  constraint wbh_game_result_evidence_distinct_teams check (away_team_edition_id <> home_team_edition_id),
  constraint wbh_game_result_evidence_no_ties check (away_points <> home_points),
  constraint wbh_game_result_evidence_away_in_game_fk foreign key (game_id, away_team_edition_id)
    references public.wbh_game_teams (game_id, team_edition_id) on update cascade,
  constraint wbh_game_result_evidence_home_in_game_fk foreign key (game_id, home_team_edition_id)
    references public.wbh_game_teams (game_id, team_edition_id) on update cascade,
  unique (game_id, source_document_id, source_record_id)
);

create index if not exists wbh_game_result_evidence_game_idx
  on public.wbh_game_result_evidence (game_id, recorded_at);
create index if not exists wbh_game_result_evidence_run_idx
  on public.wbh_game_result_evidence (ingestion_run_id);

comment on table public.wbh_game_result_evidence is
  'Normalized source observations for canonical games. Multiple sources may corroborate one game without rewriting canonical provenance.';

drop trigger if exists wbh_game_result_evidence_key_immutable_trg on public.wbh_game_result_evidence;
create trigger wbh_game_result_evidence_key_immutable_trg before update on public.wbh_game_result_evidence
  for each row execute function public.wbh_primary_key_immutable();

drop trigger if exists wbh_game_result_evidence_provenance_trg on public.wbh_game_result_evidence;
create trigger wbh_game_result_evidence_provenance_trg before insert or update on public.wbh_game_result_evidence
  for each row execute function public.wbh_provenance_guard();

drop trigger if exists wbh_game_result_evidence_revision_trg on public.wbh_game_result_evidence;
create trigger wbh_game_result_evidence_revision_trg after update on public.wbh_game_result_evidence
  for each row execute function public.wbh_fact_revision_audit();

alter table public.wbh_game_result_evidence enable row level security;
revoke all on public.wbh_game_result_evidence from anon, authenticated;
grant select, insert, update on public.wbh_game_result_evidence to service_role;

-- Keep all WBH helpers server-side after introducing the new table/trigger dependencies.
do $acl$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname like 'wbh\_%'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated',r.fn);
    execute format('grant execute on function %s to service_role',r.fn);
  end loop;
end $acl$;

commit;
