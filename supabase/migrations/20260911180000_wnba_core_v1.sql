-- PropBetEdge WNBA core schema v1
-- STAGED. Additive only (create if not exists). Apply only with owner approval.
--
-- Runtime invariant:
--   ESPN / The Odds API / publishers -> Cloudflare Workers (wnba-ingest, wnba-news)
--   -> Supabase (this schema, service_role only) -> wnba-api -> browser.
-- Browsers never read or write these tables directly: RLS is enabled with NO
-- anon/authenticated policies, and table privileges are revoked from both roles.
--
-- Identity rule: every row keys on the SOURCE identifier (ESPN game/athlete/team
-- id, Odds API event id, canonical article URL hash). No fuzzy joins here.

begin;

-- ------------------------------------------------------------------ reference

create table if not exists public.wnba_teams (
  team_id        text primary key,                 -- ESPN team id
  abbr           text not null,
  name           text not null,
  short_name     text,
  location       text,
  color          text,
  alt_color      text,
  source         text not null default 'espn',
  captured_at    timestamptz not null,
  updated_at     timestamptz not null default now()
);

create table if not exists public.wnba_players (
  athlete_id     text primary key,                 -- ESPN athlete id
  name           text not null,
  first_name     text,
  last_name      text,
  position       text,
  height         text,
  dob            date,
  college        text,
  source         text not null default 'espn',
  first_seen_at  timestamptz not null default now(),
  captured_at    timestamptz not null,
  updated_at     timestamptz not null default now()
);

-- Roster membership history: one row per (season, team, athlete); first/last seen
-- preserve when a player joined or left a team as observed by ingest.
create table if not exists public.wnba_rosters (
  season         int not null,
  team_id        text not null references public.wnba_teams(team_id),
  athlete_id     text not null references public.wnba_players(athlete_id),
  jersey         text,
  status         text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null,
  primary key (season, team_id, athlete_id)
);
create index if not exists wnba_rosters_athlete_idx on public.wnba_rosters(athlete_id, last_seen_at desc);

-- ------------------------------------------------------------------ games

create table if not exists public.wnba_games (
  game_id           text primary key,              -- ESPN event id
  season            int not null,
  season_type       int not null,                  -- 1 pre, 2 regular, 3 post
  start_utc         timestamptz not null,
  home_team_id      text,
  away_team_id      text,
  status_state      text,                          -- pre | in | post
  status_name       text,                          -- STATUS_SCHEDULED | STATUS_FINAL | ...
  completed         boolean not null default false,
  period            int,
  clock             text,
  home_score        int,
  away_score        int,
  venue_name        text,
  venue_city        text,
  venue_state       text,
  neutral_site      boolean,
  source            text not null default 'espn',
  source_updated_at timestamptz,
  captured_at       timestamptz not null,
  updated_at        timestamptz not null default now()
);
create index if not exists wnba_games_start_idx on public.wnba_games(start_utc);
create index if not exists wnba_games_season_idx on public.wnba_games(season, season_type, start_utc);

-- Event stream exactly as published. Corrections by the source overwrite the
-- row (last_captured_at moves); nothing here is synthesized.
create table if not exists public.wnba_game_events (
  game_id           text not null references public.wnba_games(game_id),
  event_id          text not null,                 -- ESPN play id
  seq               int,
  period            int,
  clock             text,
  elapsed_s         numeric,
  wallclock         timestamptz,
  type_id           text,
  type              text,
  text              text,
  team_id           text,
  athlete_ids       text[] not null default '{}',
  home_score        int,
  away_score        int,
  scoring           boolean not null default false,
  points            int not null default 0,
  shooting          boolean not null default false,
  points_attempted  int,
  made              boolean,
  coord_x           numeric,                       -- null when the source published no location
  coord_y           numeric,
  source            text not null default 'espn',
  first_captured_at timestamptz not null default now(),
  last_captured_at  timestamptz not null,
  primary key (game_id, event_id)
);
create index if not exists wnba_game_events_seq_idx on public.wnba_game_events(game_id, seq);

create table if not exists public.wnba_player_game_stats (
  game_id      text not null references public.wnba_games(game_id),
  athlete_id   text not null,
  team_id      text,
  starter      boolean,
  dnp          boolean,
  dnp_reason   text,
  min          numeric,
  pts int, fgm int, fga int, fg3m int, fg3a int, ftm int, fta int,
  reb int, oreb int, dreb int, ast int, stl int, blk int, tov int, pf int,
  plus_minus   int,
  final        boolean not null default false,
  captured_at  timestamptz not null,
  primary key (game_id, athlete_id)
);
create index if not exists wnba_pgs_athlete_idx on public.wnba_player_game_stats(athlete_id);

create table if not exists public.wnba_team_game_stats (
  game_id      text not null references public.wnba_games(game_id),
  team_id      text not null,
  home_away    text,
  stats        jsonb not null,                     -- source statistic name -> display value
  final        boolean not null default false,
  captured_at  timestamptz not null,
  primary key (game_id, team_id)
);

-- A completed game's event stream is archived once and is immutable afterwards.
create table if not exists public.wnba_replay_archives (
  game_id      text primary key references public.wnba_games(game_id),
  archived_at  timestamptz not null default now(),
  event_count  int not null,
  plotted_shots int not null,
  checksum     text not null,                      -- sha-256 of the normalized event array
  source       text not null default 'espn'
);

-- ------------------------------------------------------------------ standings

-- New row only when a team's record changes (unique on the record itself).
create table if not exists public.wnba_standings_snapshots (
  id           bigint generated always as identity primary key,
  season       int not null,
  season_type  int not null,
  team_id      text not null,
  conference   text,
  seed         int,
  wins         int not null,
  losses       int not null,
  win_pct      numeric,
  games_behind text,
  streak       text,
  clincher     text,
  captured_at  timestamptz not null,
  unique (season, season_type, team_id, wins, losses)
);

-- ------------------------------------------------------------------ availability

create table if not exists public.wnba_availability_current (
  athlete_id        text primary key,
  team_id           text,
  name              text,
  status            text,
  body_part         text,
  detail            text,
  side              text,
  source_return_date date,                          -- as published by the source; never estimated
  short_comment     text,
  source            text not null default 'espn',
  source_injury_id  text,
  source_updated_at timestamptz,
  captured_at       timestamptz not null
);

-- Before/after ledger. A row exists only when ingest observed a change between
-- two consecutive captures of the source feed.
create table if not exists public.wnba_availability_events (
  id                bigint generated always as identity primary key,
  athlete_id        text not null,
  team_id           text,
  name              text,
  change_kind       text not null check (change_kind in ('added','status_changed','detail_changed','removed')),
  status_before     text,
  status_after      text,
  detail_before     jsonb,
  detail_after      jsonb,
  source            text not null default 'espn',
  source_injury_id  text,
  source_updated_at timestamptz,
  captured_at       timestamptz not null,
  unique (athlete_id, change_kind, status_after, source_updated_at)
);
create index if not exists wnba_avail_events_time_idx on public.wnba_availability_events(captured_at desc);

-- ------------------------------------------------------------------ market

create table if not exists public.wnba_odds_runs (
  id                bigint generated always as identity primary key,
  run_at            timestamptz not null default now(),
  kind              text not null,                  -- featured | props
  events            int,
  credits_last      int,
  credits_used      int,
  credits_remaining int,
  status            text not null,
  detail            jsonb
);

-- One row per (event, market, book, outcome, point) per book update time.
-- Line movement = consecutive rows for the same key.
create table if not exists public.wnba_odds_snapshots (
  id               bigint generated always as identity primary key,
  captured_at      timestamptz not null,
  odds_event_id    text not null,
  game_id          text,                            -- ESPN id when the exact team join succeeded
  commence_time    timestamptz,
  market           text not null,                   -- h2h | spreads | totals | player_points ...
  book             text not null,
  outcome          text not null,                   -- team name | Over | Under
  participant      text,                            -- player name for props
  athlete_id       text,                            -- exact-name roster join, else null
  point            numeric,
  price            int not null,                    -- American odds as published
  book_updated_at  timestamptz,
  source           text not null default 'odds_api',
  unique nulls not distinct (odds_event_id, market, book, outcome, participant, point, book_updated_at)
);
create index if not exists wnba_odds_event_idx on public.wnba_odds_snapshots(odds_event_id, market, captured_at desc);

-- ------------------------------------------------------------------ picks / track record

create table if not exists public.wnba_picks (
  pick_id          uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  game_id          text not null references public.wnba_games(game_id),
  game_start_utc   timestamptz not null,
  market           text not null,
  selection        text not null,
  line             numeric,
  price            int,                              -- recorded American price; null = unpriced (excluded from ROI)
  book             text,
  model_version    text not null,
  rationale        text,
  result           text check (result in ('win','loss','push','void')),
  graded_at        timestamptz,
  grading_source   jsonb,
  constraint wnba_picks_before_tip check (created_at < game_start_utc)
);

-- Line/price/selection are frozen once recorded; only grading fields may change.
create or replace function public.wnba_picks_freeze() returns trigger
language plpgsql as $$
begin
  if new.created_at is distinct from old.created_at
     or new.game_id is distinct from old.game_id
     or new.game_start_utc is distinct from old.game_start_utc
     or new.market is distinct from old.market
     or new.selection is distinct from old.selection
     or new.line is distinct from old.line
     or new.price is distinct from old.price
     or new.book is distinct from old.book
     or new.model_version is distinct from old.model_version then
    raise exception 'wnba_picks: recorded pick fields are immutable';
  end if;
  if old.result is not null and new.result is distinct from old.result then
    raise exception 'wnba_picks: a graded result cannot be changed';
  end if;
  return new;
end $$;

drop trigger if exists wnba_picks_freeze_trg on public.wnba_picks;
create trigger wnba_picks_freeze_trg before update on public.wnba_picks
  for each row execute function public.wnba_picks_freeze();

create or replace function public.wnba_picks_no_delete() returns trigger
language plpgsql as $$ begin raise exception 'wnba_picks: picks are never deleted'; end $$;
drop trigger if exists wnba_picks_no_delete_trg on public.wnba_picks;
create trigger wnba_picks_no_delete_trg before delete on public.wnba_picks
  for each row execute function public.wnba_picks_no_delete();

-- ------------------------------------------------------------------ player imagery

create table if not exists public.wnba_player_images (
  athlete_id          text primary key,
  status              text not null check (status in ('approved','rejected','no_identity_match','no_image','license_rejected')),
  reason              text,
  wikidata_qid        text,
  commons_file        text,
  source_page_url     text,
  original_url        text,
  license_short       text,
  license_url         text,
  artist              text,
  credit              text,
  attribution_text    text,
  capture_date        text,
  width               int,
  height              int,
  focal               jsonb,
  crops               jsonb,
  identity_confidence text,
  identity_evidence   text,
  verified_at         timestamptz,
  manifest_generated_at timestamptz,
  constraint wnba_player_images_approved_complete check (
    status <> 'approved' or (commons_file is not null and license_short is not null and attribution_text is not null and identity_confidence = 'high')
  )
);

-- ------------------------------------------------------------------ source health

create table if not exists public.wnba_source_health (
  id           bigint generated always as identity primary key,
  checked_at   timestamptz not null default now(),
  lane         text not null,                       -- api | ingest | news
  source       text not null,
  capability   text not null,
  status       text not null check (status in ('PASS','DEGRADED','FAIL')),
  http_status  int,
  latency_ms   int,
  detail       jsonb
);
create index if not exists wnba_source_health_idx on public.wnba_source_health(source, capability, checked_at desc);

-- ------------------------------------------------------------------ security

do $$
declare t text;
begin
  foreach t in array array[
    'wnba_teams','wnba_players','wnba_rosters','wnba_games','wnba_game_events',
    'wnba_player_game_stats','wnba_team_game_stats','wnba_replay_archives',
    'wnba_standings_snapshots','wnba_availability_current','wnba_availability_events',
    'wnba_odds_runs','wnba_odds_snapshots','wnba_picks','wnba_player_images','wnba_source_health'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on table public.%I to service_role', t);
  end loop;
end $$;

commit;
