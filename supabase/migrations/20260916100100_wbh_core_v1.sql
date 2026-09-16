-- PropBetEdge — Women's Basketball History (wbh) canonical core v1
-- Target: Supabase tkmlnhmylqnttmnsnief. Requires 20260916100000_wbh_provenance_v1.sql.
--
-- Provider-agnostic by construction. No table here has a provider id column: every external
-- identifier lives in wbh_entity_source_ids as an ALIAS of an internal, opaque canonical id
-- (owner rule 7). Swapping the historical data provider therefore changes adapters and alias rows,
-- never the canonical keys or anything downstream of them.
--
-- Additive only. Creates wbh_* objects and nothing else. No auth, paywall, PBE ledger, model,
-- publishing or checkout object is referenced or altered.
--
-- Four invariants the schema itself enforces:
--   1. every canonical fact carries provenance (source document or a named derivation) and cannot be
--      written from a non-approved source or a dry run -- wbh_provenance_guard()
--   2. every game states what it counts for: game_type, season_phase, counts_for_standings,
--      counts_for_stats (owner rule 5), so a Commissioner's Cup final or an exhibition can never
--      silently enter a standings table
--   3. standings, series, rosters, totals and records are DERIVED tables rebuilt from game facts
--      (owner rule 6), never trusted provider endpoints; each build records its as_of and hash
--   4. every fact is time-addressed: effective_at (when it became true), observed_at (when its
--      source was observed) and recorded_at (when we learned it). Corrections require a new run and
--      keep before/after snapshots in wbh_fact_revisions, preserving as-of reconstruction.

begin;

-- ------------------------------------------------------------------ 1. competition reference

create table if not exists public.wbh_organizations (
  org_id       text primary key check (org_id ~ '^[a-z][a-z0-9_]{2,63}$'),
  display_name text not null,
  org_type     text not null check (org_type in ('league', 'federation', 'olympic', 'club_competition_organizer')),
  country_code text check (country_code ~ '^[A-Z]{3}$'),
  founded_year integer
);

create table if not exists public.wbh_competitions (
  competition_id   text primary key check (competition_id ~ '^[a-z][a-z0-9_]{2,63}$'),
  org_id           text not null references public.wbh_organizations (org_id) on update cascade,
  display_name     text not null,
  competition_type text not null check (competition_type in (
                     'league', 'national_team_tournament', 'olympics', 'continental_cup',
                     'club_continental', 'domestic_cup', 'in_season_cup', 'exhibition')),
  gender           text not null default 'women' check (gender in ('women', 'men', 'mixed')),
  country_code     text check (country_code ~ '^[A-Z]{3}$'),
  tier             integer,
  first_year       integer,
  last_year        integer,
  notes            text
);

create table if not exists public.wbh_competition_editions (
  edition_id     text primary key check (edition_id ~ '^[a-z][a-z0-9_]{2,95}$'),
  competition_id text not null references public.wbh_competitions (competition_id) on update cascade,
  season_label   text not null,                  -- '2024', '2024-25', 'Paris 2024'
  season_year    integer not null,
  start_date     date,
  end_date       date,
  host_country   text check (host_country ~ '^[A-Z]{3}$'),
  team_count     integer,
  status         text not null default 'complete' check (status in ('scheduled', 'in_progress', 'complete', 'abandoned')),
  completeness   text not null default 'unknown' check (completeness in ('unknown', 'absent', 'partial', 'complete')),
  unique (competition_id, season_year, season_label),
  unique (edition_id, competition_id)
);

create table if not exists public.wbh_stages (
  stage_id     text primary key check (stage_id ~ '^[a-z][a-z0-9_]{2,127}$'),
  edition_id   text not null references public.wbh_competition_editions (edition_id) on update cascade,
  display_name text not null,
  season_phase text not null check (season_phase in (
                 'preseason', 'regular_season', 'in_season_cup', 'group', 'knockout',
                 'playoffs', 'final', 'classification', 'exhibition')),
  ordinal      integer not null default 0,
  unique (edition_id, display_name),
  unique (stage_id, edition_id)
);

-- ------------------------------------------------------------------ 2. franchises, teams, venues

-- A franchise is the continuing entity. Its identity is ours; relocations and renames are events,
-- not new keys, and a provider reusing an id across unrelated clubs cannot corrupt it.
create table if not exists public.wbh_franchises (
  franchise_id   text primary key check (franchise_id ~ '^fr_[a-z0-9_]{2,60}$'),
  canonical_name text not null,
  country_code   text check (country_code ~ '^[A-Z]{3}$'),
  founded_year   integer,
  defunct_year   integer,
  notes          text
);

create table if not exists public.wbh_franchise_lineage_events (
  event_id             bigint generated always as identity primary key,
  franchise_id         text not null references public.wbh_franchises (franchise_id) on update cascade,
  event_type           text not null check (event_type in (
                         'founded', 'relocated', 'renamed', 'rebranded', 'suspended',
                         'resumed', 'folded', 'succeeded_by', 'expansion')),
  effective_date       date,
  effective_season     integer,
  from_name            text,
  to_name              text,
  related_franchise_id text references public.wbh_franchises (franchise_id) on update cascade,
  citation_url         text,
  citation_note        text not null,
  unique (franchise_id, event_type, effective_season, to_name)
);

comment on table public.wbh_franchise_lineage_events is
  'Curated with a citation per row. Provider team ids are unreliable across relocations and are never the lineage authority.';

create table if not exists public.wbh_venues (
  venue_id     text primary key check (venue_id ~ '^vn_[a-z0-9_]{2,60}$'),
  display_name text not null,
  city         text,
  region       text,
  country_code text check (country_code ~ '^[A-Z]{3}$'),
  capacity     integer,
  opened_year  integer,
  closed_year  integer
);

create table if not exists public.wbh_teams (
  team_id        text primary key check (team_id ~ '^tm_[a-z0-9_]{2,60}$'),
  team_kind      text not null check (team_kind in ('club', 'national', 'all_star', 'select', 'invitational')),
  franchise_id   text references public.wbh_franchises (franchise_id) on update cascade,
  country_code   text check (country_code ~ '^[A-Z]{3}$'),
  canonical_name text not null,
  constraint wbh_teams_club_has_franchise check (team_kind <> 'club' or franchise_id is not null)
);

-- The team as it existed in one edition: the name, badge and home it actually had that season.
create table if not exists public.wbh_team_editions (
  team_edition_id text primary key check (team_edition_id ~ '^te_[a-z0-9_]{2,90}$'),
  team_id         text not null references public.wbh_teams (team_id) on update cascade,
  edition_id      text not null references public.wbh_competition_editions (edition_id) on update cascade,
  display_name    text not null,
  abbreviation    text,
  venue_id        text references public.wbh_venues (venue_id) on update cascade,
  conference      text,
  division        text,
  unique (team_id, edition_id)
);

-- ------------------------------------------------------------------ 3. people and identity

create table if not exists public.wbh_persons (
  person_id           text primary key check (person_id ~ '^gp_[0-9A-HJKMNP-TV-Z]{12}$'),  -- opaque, Crockford base32
  primary_full_name   text not null,
  sort_name           text,
  given_name          text,
  family_name         text,
  birth_date          date,
  birth_date_precision text check (birth_date_precision in ('day', 'month', 'year')),
  birth_country_code  text check (birth_country_code ~ '^[A-Z]{3}$'),
  sport_country_code  text check (sport_country_code ~ '^[A-Z]{3}$'),   -- Wikidata P1532: country for sport
  height_cm           integer check (height_cm between 120 and 260),
  primary_position    text,
  notes               text
);

comment on column public.wbh_persons.person_id is
  'Opaque and random. Never derived from a name, and never reused after a split.';

create table if not exists public.wbh_person_aliases (
  alias_id   bigint generated always as identity primary key,
  person_id  text not null references public.wbh_persons (person_id) on update cascade,
  alias      text not null,
  alias_norm text not null,                      -- casefolded, accent-stripped; for search only
  alias_type text not null check (alias_type in ('birth_name', 'married_name', 'transliteration', 'display', 'nickname', 'misspelling')),
  script     text,
  unique (person_id, alias_norm, alias_type)
);

comment on table public.wbh_person_aliases is
  'Search surface only. A name match is never sufficient evidence to merge two people.';

-- The one place a provider identifier may exist, for ANY entity type. Provider ids are aliases.
create table if not exists public.wbh_entity_source_ids (
  entity_link_id bigint generated always as identity primary key,
  entity_type    text not null check (entity_type in ('person', 'franchise', 'team', 'team_edition', 'venue', 'competition', 'edition', 'game')),
  entity_id      text not null,
  source_id      text not null references public.wbh_sources (source_id) on update cascade,
  external_id    text not null,
  external_url   text,
  id_space       text,                            -- e.g. 'wikidata:P3588' — which identifier this is
  status         text not null default 'candidate' check (status in ('linked', 'candidate', 'rejected')),
  tier           text not null check (tier in ('T1', 'T2', 'T3', 'T4', 'T5')),
  confidence     numeric not null check (confidence > 0 and confidence <= 1),
  method         text not null,
  evidence       jsonb not null default '{}'::jsonb,
  reviewed_by    text,
  reviewed_at    timestamptz
);

-- One provider id may resolve to at most one entity once it is LINKED. Candidates may compete.
create unique index if not exists wbh_entity_source_ids_linked_unique
  on public.wbh_entity_source_ids (source_id, entity_type, external_id)
  where status = 'linked';

create index if not exists wbh_entity_source_ids_entity_idx
  on public.wbh_entity_source_ids (entity_type, entity_id);

-- Name-only evidence can never be auto-linked. T5 is the name+context tier and is capped at candidate.
create or replace function public.wbh_entity_source_ids_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_table text;
  target_column text;
  target_exists boolean;
begin
  case new.entity_type
    when 'person' then target_table := 'wbh_persons'; target_column := 'person_id';
    when 'franchise' then target_table := 'wbh_franchises'; target_column := 'franchise_id';
    when 'team' then target_table := 'wbh_teams'; target_column := 'team_id';
    when 'team_edition' then target_table := 'wbh_team_editions'; target_column := 'team_edition_id';
    when 'venue' then target_table := 'wbh_venues'; target_column := 'venue_id';
    when 'competition' then target_table := 'wbh_competitions'; target_column := 'competition_id';
    when 'edition' then target_table := 'wbh_competition_editions'; target_column := 'edition_id';
    when 'game' then target_table := 'wbh_games'; target_column := 'game_id';
  end case;
  execute format('select exists (select 1 from public.%I where %I = $1)', target_table, target_column)
    into target_exists using new.entity_id;
  if not target_exists then
    raise exception 'wbh: % source id points at missing canonical % %', new.source_id, new.entity_type, new.entity_id
      using errcode = 'P0001';
  end if;

  if new.status = 'linked' and new.tier = 'T5' then
    raise exception 'wbh: tier T5 (name plus weak context) may never be linked automatically'
      using errcode = 'P0001', hint = 'record it as a candidate and have a human review it';
  end if;
  if new.status = 'linked' and new.tier in ('T3', 'T4') and new.reviewed_at is null and new.confidence < 0.90 then
    raise exception 'wbh: a % link below 0.90 confidence needs human review before it is linked', new.tier
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists wbh_entity_source_ids_guard_trg on public.wbh_entity_source_ids;
create trigger wbh_entity_source_ids_guard_trg before insert or update on public.wbh_entity_source_ids
  for each row execute function public.wbh_entity_source_ids_guard();

-- Proposed relationships between two INTERNAL persons (possible duplicates).
create table if not exists public.wbh_identity_candidates (
  candidate_id     bigint generated always as identity primary key,
  left_person_id   text not null references public.wbh_persons (person_id) on update cascade,
  right_person_id  text not null references public.wbh_persons (person_id) on update cascade,
  tier             text not null check (tier in ('T1', 'T2', 'T3', 'T4', 'T5')),
  confidence       numeric not null check (confidence > 0 and confidence <= 1),
  method           text not null,
  evidence         jsonb not null default '{}'::jsonb,
  status           text not null default 'candidate' check (status in ('candidate', 'merged', 'rejected', 'conflict')),
  reviewed_by      text,
  reviewed_at      timestamptz,
  constraint wbh_identity_candidates_distinct check (left_person_id <> right_person_id),
  constraint wbh_identity_candidates_canonical_order check (left_person_id < right_person_id),
  unique (left_person_id, right_person_id)
);

-- Merges and splits are events, never in-place rewrites.
create table if not exists public.wbh_identity_events (
  event_id       bigint generated always as identity primary key,
  event_type     text not null check (event_type in ('create', 'merge', 'split', 'relink', 'retire')),
  person_id      text not null references public.wbh_persons (person_id) on update cascade,
  other_person_id text references public.wbh_persons (person_id) on update cascade,
  reason         text not null,
  evidence       jsonb not null default '{}'::jsonb,
  actor          text not null default current_user,
  occurred_at    timestamptz not null default now()
);

drop trigger if exists wbh_identity_events_immutable on public.wbh_identity_events;
create trigger wbh_identity_events_immutable before update or delete on public.wbh_identity_events
  for each row execute function public.wbh_reject_mutation('identity history is permanent');

-- ------------------------------------------------------------------ 4. games

create table if not exists public.wbh_games (
  game_id             text primary key check (game_id ~ '^gm_[a-z0-9_]{2,90}$'),
  edition_id          text not null references public.wbh_competition_editions (edition_id) on update cascade,
  stage_id            text references public.wbh_stages (stage_id) on update cascade,
  competition_id      text not null references public.wbh_competitions (competition_id) on update cascade,

  scheduled_at        timestamptz,
  tipoff_at           timestamptz,
  local_date          date,
  status              text not null check (status in ('scheduled', 'in_progress', 'final', 'postponed', 'canceled', 'forfeit', 'unknown')),

  venue_id            text references public.wbh_venues (venue_id) on update cascade,
  neutral_site        boolean not null default false,
  attendance          integer check (attendance >= 0),
  attendance_known    boolean not null default false,   -- distinguishes 'no crowd' from 'not recorded'

  -- owner rule 5: a game always states what it counts for
  game_type           text not null check (game_type in (
                        'regular', 'playoff', 'final', 'in_season_cup', 'group', 'knockout',
                        'qualifier', 'friendly', 'all_star', 'exhibition', 'classification')),
  season_phase        text not null check (season_phase in (
                        'preseason', 'regular_season', 'in_season_cup', 'group', 'knockout',
                        'playoffs', 'final', 'classification', 'exhibition')),
  counts_for_standings boolean not null,
  counts_for_stats     boolean not null,

  period_format       text not null default 'quarters' check (period_format in ('halves', 'quarters')),
  regulation_periods  integer not null default 4 check (regulation_periods between 2 and 4),
  overtime_periods    integer not null default 0 check (overtime_periods >= 0),
  series_id           text,
  series_game_number  integer,
  completeness        text not null default 'unknown' check (completeness in ('unknown', 'schedule_only', 'score_only', 'box_score', 'full')),

  constraint wbh_games_exhibition_never_counts check (
    game_type not in ('all_star', 'exhibition', 'friendly') or (not counts_for_standings)
  ),
  constraint wbh_games_attendance_known check (
    attendance_known or attendance is null
  ),
  constraint wbh_games_edition_competition_fk foreign key (edition_id, competition_id)
    references public.wbh_competition_editions (edition_id, competition_id) on update cascade,
  constraint wbh_games_stage_edition_fk foreign key (stage_id, edition_id)
    references public.wbh_stages (stage_id, edition_id) on update cascade
);

create index if not exists wbh_games_edition_idx on public.wbh_games (edition_id, local_date);
create index if not exists wbh_games_standings_idx on public.wbh_games (edition_id) where counts_for_standings;

create table if not exists public.wbh_game_teams (
  game_id         text not null references public.wbh_games (game_id) on update cascade,
  team_edition_id text not null references public.wbh_team_editions (team_edition_id) on update cascade,
  side            text not null check (side in ('home', 'away', 'neutral_a', 'neutral_b')),
  points          integer check (points >= 0),
  linescore       jsonb not null default '[]'::jsonb,
  result          text check (result in ('win', 'loss', 'tie', 'no_result')),
  primary key (game_id, team_edition_id),
  unique (game_id, side)
);

create or replace function public.wbh_game_teams_scope_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  game_edition text;
  team_edition text;
begin
  select edition_id into game_edition from public.wbh_games where game_id = new.game_id;
  select edition_id into team_edition from public.wbh_team_editions where team_edition_id = new.team_edition_id;
  if game_edition is null or team_edition is null or game_edition <> team_edition then
    raise exception 'wbh: team edition % does not belong to game % edition', new.team_edition_id, new.game_id
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists wbh_game_teams_scope_guard_trg on public.wbh_game_teams;
create trigger wbh_game_teams_scope_guard_trg before insert or update on public.wbh_game_teams
  for each row execute function public.wbh_game_teams_scope_guard();

create table if not exists public.wbh_game_officials (
  game_id   text not null references public.wbh_games (game_id) on update cascade,
  person_id text not null references public.wbh_persons (person_id) on update cascade,
  role      text not null default 'referee',
  ordinal   integer not null default 0,
  primary key (game_id, person_id)
);

-- ------------------------------------------------------------------ 5. statistics

create table if not exists public.wbh_player_game_stats (
  game_id          text not null references public.wbh_games (game_id) on update cascade,
  person_id        text not null references public.wbh_persons (person_id) on update cascade,
  team_edition_id  text not null references public.wbh_team_editions (team_edition_id) on update cascade,
  started          boolean,
  did_not_play     boolean not null default false,
  dnp_reason       text,
  seconds_played   integer check (seconds_played >= 0),
  points           integer, field_goals_made integer, field_goals_attempted integer,
  three_pointers_made integer, three_pointers_attempted integer,
  free_throws_made integer, free_throws_attempted integer,
  offensive_rebounds integer, defensive_rebounds integer, rebounds integer,
  assists integer, steals integer, blocks integer, turnovers integer, personal_fouls integer,
  plus_minus       integer,
  extra            jsonb not null default '{}'::jsonb,   -- competition-specific stats, no migration needed
  primary key (game_id, person_id),
  constraint wbh_player_game_stats_team_in_game_fk foreign key (game_id, team_edition_id)
    references public.wbh_game_teams (game_id, team_edition_id) on update cascade
);

create index if not exists wbh_player_game_stats_person_idx on public.wbh_player_game_stats (person_id);

create table if not exists public.wbh_team_game_stats (
  game_id          text not null references public.wbh_games (game_id) on update cascade,
  team_edition_id  text not null references public.wbh_team_editions (team_edition_id) on update cascade,
  points integer, field_goals_made integer, field_goals_attempted integer,
  three_pointers_made integer, three_pointers_attempted integer,
  free_throws_made integer, free_throws_attempted integer,
  offensive_rebounds integer, defensive_rebounds integer, rebounds integer,
  assists integer, steals integer, blocks integer, turnovers integer, personal_fouls integer,
  team_rebounds integer, points_in_paint integer, fast_break_points integer, largest_lead integer,
  from_player_sums boolean not null default false,       -- true when the provider gave no team box
  extra            jsonb not null default '{}'::jsonb,
  primary key (game_id, team_edition_id),
  constraint wbh_team_game_stats_team_in_game_fk foreign key (game_id, team_edition_id)
    references public.wbh_game_teams (game_id, team_edition_id) on update cascade
);

create table if not exists public.wbh_play_events (
  play_event_id    bigint generated always as identity primary key,
  game_id          text not null references public.wbh_games (game_id) on update cascade,
  sequence         integer not null,
  period           integer not null,
  clock_remaining_seconds integer check (clock_remaining_seconds >= 0),
  wallclock_at     timestamptz,
  team_edition_id  text references public.wbh_team_editions (team_edition_id) on update cascade,
  person_id        text references public.wbh_persons (person_id) on update cascade,
  assist_person_id text references public.wbh_persons (person_id) on update cascade,
  event_type       text not null,                 -- normalized vocabulary, never provider prose
  shot_type        text,
  shot_made        boolean,
  points_scored    integer check (points_scored between 0 and 4),
  coordinate_x     numeric,
  coordinate_y     numeric,
  coordinate_quality text not null default 'absent' check (coordinate_quality in ('measured', 'placeholder', 'derived', 'absent')),
  home_score       integer, away_score integer,
  extra            jsonb not null default '{}'::jsonb,
  unique (game_id, sequence),
  constraint wbh_play_events_team_in_game_fk foreign key (game_id, team_edition_id)
    references public.wbh_game_teams (game_id, team_edition_id) on update cascade
);

comment on column public.wbh_play_events.event_type is
  'Normalized event vocabulary. Provider play descriptions are not stored: the facts are ours, the prose is theirs.';

-- ------------------------------------------------------------------ 6. careers, awards, draft

create table if not exists public.wbh_coach_stints (
  coach_stint_id  bigint generated always as identity primary key,
  person_id       text not null references public.wbh_persons (person_id) on update cascade,
  team_edition_id text not null references public.wbh_team_editions (team_edition_id) on update cascade,
  role            text not null default 'head_coach' check (role in ('head_coach', 'interim_head_coach', 'assistant_coach')),
  started_on      date,
  ended_on        date,
  unique (person_id, team_edition_id, role, started_on)
);

create table if not exists public.wbh_draft_picks (
  draft_pick_id   bigint generated always as identity primary key,
  competition_id  text not null references public.wbh_competitions (competition_id) on update cascade,
  draft_year      integer not null,
  round           integer not null check (round > 0),
  pick_in_round   integer not null check (pick_in_round > 0),
  overall_pick    integer check (overall_pick > 0),
  person_id       text references public.wbh_persons (person_id) on update cascade,
  franchise_id    text references public.wbh_franchises (franchise_id) on update cascade,
  from_school     text,
  from_team       text,
  unique (competition_id, draft_year, round, pick_in_round)
);

create table if not exists public.wbh_awards (
  award_id       text primary key check (award_id ~ '^aw_[a-z0-9_]{2,60}$'),
  competition_id text references public.wbh_competitions (competition_id) on update cascade,
  display_name   text not null,
  award_scope    text not null check (award_scope in ('player', 'team', 'coach', 'executive')),
  cadence        text not null default 'season' check (cadence in ('season', 'game', 'week', 'month', 'career'))
);

create table if not exists public.wbh_award_recipients (
  award_recipient_id bigint generated always as identity primary key,
  award_id        text not null references public.wbh_awards (award_id) on update cascade,
  edition_id      text references public.wbh_competition_editions (edition_id) on update cascade,
  season_year     integer,
  person_id       text references public.wbh_persons (person_id) on update cascade,
  team_edition_id text references public.wbh_team_editions (team_edition_id) on update cascade,
  placement       integer,
  vote_detail     jsonb not null default '{}'::jsonb,
  constraint wbh_award_recipients_one_subject check (num_nonnulls(person_id, team_edition_id) = 1)
);

create unique index if not exists wbh_award_recipients_unique
  on public.wbh_award_recipients (award_id, coalesce(edition_id, ''), coalesce(season_year, -1),
                                  coalesce(person_id, ''), coalesce(team_edition_id, ''), coalesce(placement, 0));

-- ------------------------------------------------------------------ 7. derived layer (rebuildable)

-- Every derived build is a dataset with a temporal cut and a hash. Two builds with the same as_of
-- and the same inputs must produce the same dataset_sha256; that is the determinism test.
create table if not exists public.wbh_derived_datasets (
  dataset_id      uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('standings', 'series', 'roster_stints', 'player_season_totals',
                                                'team_season_totals', 'career_totals', 'records')),
  edition_id      text references public.wbh_competition_editions (edition_id) on update cascade,
  as_of           timestamptz not null,
  rule_version    text not null,
  input_sha256    text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  dataset_sha256  text not null check (dataset_sha256 ~ '^[0-9a-f]{64}$'),
  row_count       integer not null check (row_count >= 0),
  is_current      boolean not null default true,
  is_synthetic    boolean not null default false,
  built_at        timestamptz not null default now(),
  ingestion_run_id uuid not null references public.wbh_ingestion_runs (run_id)
);

create unique index if not exists wbh_derived_datasets_unique
  on public.wbh_derived_datasets (kind, coalesce(edition_id, '__global__'), as_of, rule_version);
create unique index if not exists wbh_derived_datasets_one_current
  on public.wbh_derived_datasets (kind, coalesce(edition_id, '__global__')) where is_current;

create table if not exists public.wbh_standings (
  dataset_id      uuid not null references public.wbh_derived_datasets (dataset_id) on delete cascade,
  team_edition_id text not null references public.wbh_team_editions (team_edition_id) on update cascade,
  games_played integer not null, wins integer not null, losses integer not null, ties integer not null default 0,
  win_pct      numeric not null,
  points_for   integer, points_against integer,
  conference_wins integer, conference_losses integer,
  streak       text,
  rank_overall integer, rank_conference integer,
  games_behind numeric,
  tiebreak_method text,
  primary key (dataset_id, team_edition_id)
);

create table if not exists public.wbh_series (
  dataset_id     uuid not null references public.wbh_derived_datasets (dataset_id) on delete cascade,
  series_id      text not null,
  edition_id     text not null references public.wbh_competition_editions (edition_id) on update cascade,
  stage_id       text references public.wbh_stages (stage_id) on update cascade,
  team_edition_a text not null references public.wbh_team_editions (team_edition_id) on update cascade,
  team_edition_b text not null references public.wbh_team_editions (team_edition_id) on update cascade,
  wins_a integer not null, wins_b integer not null,
  format         text,                              -- 'best_of_3', 'best_of_5', 'single_game'
  winner_team_edition_id text references public.wbh_team_editions (team_edition_id) on update cascade,
  decided        boolean not null default false,
  primary key (dataset_id, series_id)
);

create table if not exists public.wbh_roster_stints (
  dataset_id      uuid not null references public.wbh_derived_datasets (dataset_id) on delete cascade,
  person_id       text not null references public.wbh_persons (person_id) on update cascade,
  team_edition_id text not null references public.wbh_team_editions (team_edition_id) on update cascade,
  first_game_id   text references public.wbh_games (game_id) on update cascade,
  last_game_id    text references public.wbh_games (game_id) on update cascade,
  first_appearance date,
  last_appearance  date,
  games_played    integer not null default 0,
  derivation      text not null default 'appearance_derived',
  primary key (dataset_id, person_id, team_edition_id)
);

comment on table public.wbh_roster_stints is
  'Derived from appearances. Provider season-roster endpoints are known to return CURRENT rosters for historical seasons and are never used.';

create table if not exists public.wbh_player_season_totals (
  dataset_id      uuid not null references public.wbh_derived_datasets (dataset_id) on delete cascade,
  person_id       text not null references public.wbh_persons (person_id) on update cascade,
  team_edition_id text not null references public.wbh_team_editions (team_edition_id) on update cascade,
  games_played integer not null, games_started integer,
  seconds_played bigint,
  points integer, field_goals_made integer, field_goals_attempted integer,
  three_pointers_made integer, three_pointers_attempted integer,
  free_throws_made integer, free_throws_attempted integer,
  offensive_rebounds integer, defensive_rebounds integer, rebounds integer,
  assists integer, steals integer, blocks integer, turnovers integer, personal_fouls integer,
  primary key (dataset_id, person_id, team_edition_id)
);

-- Provider season totals kept SEPARATELY for reconciliation. Never merged into ours, never displayed
-- as our number: a mismatch is a finding, not something to overwrite.
create table if not exists public.wbh_provider_season_totals (
  provider_total_id bigint generated always as identity primary key,
  source_id       text not null references public.wbh_sources (source_id) on update cascade,
  person_id       text references public.wbh_persons (person_id) on update cascade,
  edition_id      text not null references public.wbh_competition_editions (edition_id) on update cascade,
  stats           jsonb not null,
  unique (source_id, person_id, edition_id)
);

create table if not exists public.wbh_record_definitions (
  record_id     text primary key check (record_id ~ '^rc_[a-z0-9_]{2,60}$'),
  display_name  text not null,
  scope         text not null check (scope in ('game', 'season', 'career', 'franchise', 'edition', 'streak')),
  subject       text not null check (subject in ('player', 'team')),
  stat          text not null,
  direction     text not null default 'max' check (direction in ('max', 'min')),
  qualifier     jsonb not null default '{}'::jsonb,   -- e.g. {"min_games": 20, "counts_for_stats": true}
  rule_version  text not null default 'v1'
);

create table if not exists public.wbh_record_holders (
  record_holder_id bigint generated always as identity primary key,
  dataset_id      uuid not null references public.wbh_derived_datasets (dataset_id) on delete cascade,
  record_id       text not null references public.wbh_record_definitions (record_id) on update cascade,
  rank            integer not null check (rank > 0),
  person_id       text references public.wbh_persons (person_id) on update cascade,
  team_edition_id text references public.wbh_team_editions (team_edition_id) on update cascade,
  franchise_id    text references public.wbh_franchises (franchise_id) on update cascade,
  value           numeric not null,
  game_id         text references public.wbh_games (game_id) on update cascade,
  edition_id      text references public.wbh_competition_editions (edition_id) on update cascade,
  achieved_on     date,
  constraint wbh_record_holders_subject check (num_nonnulls(person_id, team_edition_id, franchise_id) = 1)
);

-- ties share a rank, so the subject is part of the key rather than the rank alone
create unique index if not exists wbh_record_holders_unique
  on public.wbh_record_holders (dataset_id, record_id, rank,
                                coalesce(person_id, ''), coalesce(team_edition_id, ''), coalesce(franchise_id, ''));

-- ------------------------------------------------------------------ 8. provenance + temporal columns on every fact table

-- Applied uniformly rather than copy-pasted per table, so no table can quietly be created without it.
do $prov$
declare
  t text;
  fact_tables text[] := array[
    'wbh_franchises', 'wbh_franchise_lineage_events', 'wbh_venues', 'wbh_teams', 'wbh_team_editions',
    'wbh_organizations', 'wbh_competitions', 'wbh_competition_editions', 'wbh_stages',
    'wbh_persons', 'wbh_person_aliases', 'wbh_entity_source_ids',
    'wbh_games', 'wbh_game_teams', 'wbh_game_officials',
    'wbh_player_game_stats', 'wbh_team_game_stats', 'wbh_play_events',
    'wbh_coach_stints', 'wbh_draft_picks', 'wbh_awards', 'wbh_award_recipients',
    'wbh_provider_season_totals'
  ];
begin
  foreach t in array fact_tables loop
    execute format('alter table public.%I add column if not exists source_document_id uuid references public.wbh_source_documents (document_id)', t);
    execute format('alter table public.%I add column if not exists ingestion_run_id uuid not null references public.wbh_ingestion_runs (run_id)', t);
    execute format('alter table public.%I add column if not exists transformation_version text not null default ''v1''', t);
    execute format('alter table public.%I add column if not exists derivation text', t);
    execute format('alter table public.%I add column if not exists confidence numeric not null default 1.0 check (confidence > 0 and confidence <= 1)', t);
    -- effective_at may be unknown; NULL is honest and never replaced with ingestion time.
    execute format('alter table public.%I add column if not exists effective_at timestamptz', t);
    -- observed_at and recorded_at are stamped by the provenance guard, never trusted from the writer.
    execute format('alter table public.%I add column if not exists observed_at timestamptz not null', t);
    execute format('alter table public.%I add column if not exists recorded_at timestamptz not null', t);
    execute format('alter table public.%I add column if not exists is_synthetic boolean not null default false', t);

    execute format('drop trigger if exists %I on public.%I', t || '_key_immutable_trg', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.wbh_primary_key_immutable()',
                   t || '_key_immutable_trg', t);
    execute format('drop trigger if exists %I on public.%I', t || '_provenance_trg', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.wbh_provenance_guard()',
                   t || '_provenance_trg', t);
    execute format('drop trigger if exists %I on public.%I', t || '_revision_trg', t);
    execute format('create trigger %I after update on public.%I for each row execute function public.wbh_fact_revision_audit()',
                   t || '_revision_trg', t);
    execute format('create index if not exists %I on public.%I (recorded_at)', t || '_recorded_idx', t);
  end loop;
end $prov$;

-- ------------------------------------------------------------------ 9. product views: real data only

-- Every product surface reads a view that excludes synthetic fixture rows, so test data can never
-- reach a page even if it exists in the table.
create or replace view public.wbh_games_public
with (security_invoker = true) as
  select g.*
    from public.wbh_games g
    join public.wbh_ingestion_runs r on r.run_id = g.ingestion_run_id
    join public.wbh_sources s on s.source_id = r.source_id
   where not g.is_synthetic and s.rights_state = any (public.wbh_ingestible_states());

create or replace view public.wbh_persons_public
with (security_invoker = true) as
  select p.*
    from public.wbh_persons p
    join public.wbh_ingestion_runs r on r.run_id = p.ingestion_run_id
    join public.wbh_sources s on s.source_id = r.source_id
   where not p.is_synthetic and s.rights_state = any (public.wbh_ingestible_states());

-- ------------------------------------------------------------------ 10. access

do $rls$
declare t text;
begin
  foreach t in array array[
    'wbh_organizations', 'wbh_competitions', 'wbh_competition_editions', 'wbh_stages',
    'wbh_franchises', 'wbh_franchise_lineage_events', 'wbh_venues', 'wbh_teams', 'wbh_team_editions',
    'wbh_persons', 'wbh_person_aliases', 'wbh_entity_source_ids', 'wbh_identity_candidates', 'wbh_identity_events',
    'wbh_games', 'wbh_game_teams', 'wbh_game_officials',
    'wbh_player_game_stats', 'wbh_team_game_stats', 'wbh_play_events',
    'wbh_coach_stints', 'wbh_draft_picks', 'wbh_awards', 'wbh_award_recipients',
    'wbh_derived_datasets', 'wbh_standings', 'wbh_series', 'wbh_roster_stints',
    'wbh_player_season_totals', 'wbh_provider_season_totals', 'wbh_record_definitions', 'wbh_record_holders'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to service_role', t);
  end loop;
end $rls$;

revoke all on public.wbh_games_public, public.wbh_persons_public from anon, authenticated;
grant select on public.wbh_games_public, public.wbh_persons_public to service_role;

-- Functions are executable by PUBLIC by default in PostgreSQL. Keep all wbh_* RPC/trigger helpers
-- server-only, and grant only the service role that owns ingestion. Likewise grant only wbh sequences.
do $acl$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'wbh\_%'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
    execute format('grant execute on function %s to service_role', r.fn);
  end loop;
  for r in
    select c.oid::regclass as seq from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'wbh\_%'
  loop
    execute format('revoke all on sequence %s from anon, authenticated', r.seq);
    execute format('grant usage, select on sequence %s to service_role', r.seq);
  end loop;
end $acl$;

commit;
