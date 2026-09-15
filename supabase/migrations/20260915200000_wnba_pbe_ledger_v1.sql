-- PropBetEdge WNBA — PBE model ledger v1
-- Target: Supabase tkmlnhmylqnttmnsnief (sports-intelligence / model system of record).
-- Billing, identity and entitlements stay in the network billing project; nothing here reads or copies them.
--
-- ONE additive migration. It creates only wnba_pbe_* objects and touches no existing table, view,
-- function, trigger or policy. Every statement is re-runnable (if not exists / or replace / drop-if-exists
-- on its OWN triggers only).
--
-- Three concepts, never collapsed into one mutable row:
--   1. wnba_pbe_prediction_observations  every pre-lock scoring pass, append-only
--   2. wnba_pbe_locked_predictions        the official call, written once, never updated or deleted
--   3. wnba_pbe_grade_revisions           append-only grades; the latest revision is the displayed grade
-- plus the model registry (wnba_pbe_model_versions, immutable) and champion history
-- (wnba_pbe_model_promotions, append-only). Official locks are accepted only from the current champion.
--
-- Access: RLS on, zero policies, table privileges revoked from anon + authenticated. Writers are server-side
-- (service_role). Paid reads go through wnba-api after wnba_pro verification; the public aggregate goes
-- through a deliberately scoped server endpoint. Nothing here is reachable through anonymous REST.

begin;

-- ------------------------------------------------------------------ shared guard functions

-- Append-only / immutable tables reject every UPDATE and DELETE. TG_ARGV[0] names the rule in the error.
create or replace function public.wnba_pbe_reject_mutation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'wnba_pbe: % rows are immutable (% rejected)', tg_table_name, tg_op
    using errcode = 'P0001', hint = coalesce(tg_argv[0], 'append a new record instead');
end $$;

create or replace function public.wnba_pbe_reject_truncate() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'wnba_pbe: % cannot be truncated', tg_table_name using errcode = 'P0001';
end $$;

-- Server clock stamp: the named timestamptz column is set to the insert clock, so no writer can backdate it.
create or replace function public.wnba_pbe_stamp_insert() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new := jsonb_populate_record(new, jsonb_build_object(tg_argv[0], clock_timestamp()));
  return new;
end $$;

-- ------------------------------------------------------------------ 0. model registry (immutable)

create table if not exists public.wnba_pbe_model_versions (
  model_id                   text primary key,
  model_type                 text not null,
  feature_schema             text not null,
  artifact_sha256            text not null check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  feature_spec_sha256        text not null check (feature_spec_sha256 ~ '^[0-9a-f]{64}$'),
  validation_receipt_sha256  text not null check (validation_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  training_window            jsonb not null,           -- {seasons, from, to, rows, cutoff}
  validation_summary         jsonb not null,           -- metrics as frozen in the receipt
  role_at_registration       text not null check (role_at_registration in ('champion_candidate', 'challenger')),
  artifact_uri               text,                     -- repo path or R2 key of the frozen artifact
  registered_at              timestamptz not null default now(),
  unique (artifact_sha256)
);

-- Champion history. The current champion is the latest row. Promotion is explicit and never rewritten.
create table if not exists public.wnba_pbe_model_promotions (
  promotion_id       bigint generated always as identity primary key,
  model_id           text not null references public.wnba_pbe_model_versions(model_id),
  promoted_at        timestamptz not null default now(),
  promoted_by        text not null,                    -- owner identity / approval reference
  evidence           jsonb not null,                   -- frozen-benchmark comparison that justified it
  supersedes_model_id text references public.wnba_pbe_model_versions(model_id)
);
create index if not exists wnba_pbe_model_promotions_latest_idx on public.wnba_pbe_model_promotions (promoted_at desc, promotion_id desc);

create or replace function public.wnba_pbe_current_champion() returns text
language sql stable
set search_path = ''
as $$
  select model_id from public.wnba_pbe_model_promotions order by promoted_at desc, promotion_id desc limit 1
$$;

-- ------------------------------------------------------------------ 1. pre-lock observations (append-only)

create table if not exists public.wnba_pbe_prediction_observations (
  observation_id        uuid primary key default gen_random_uuid(),
  recorded_at           timestamptz not null default now(),   -- forced to the insert clock by trigger
  run_id                text not null,                        -- scoring pass that produced it
  game_id               text not null,                        -- canonical ESPN event id
  season                int not null,
  season_type           int not null check (season_type in (2, 3)),
  scheduled_tip_utc     timestamptz not null,
  home_team_id          text not null,
  away_team_id          text not null,
  neutral_site          boolean not null default false,
  model_id              text not null references public.wnba_pbe_model_versions(model_id),
  generated_at          timestamptz not null,                 -- model clock for this pass
  as_of                 timestamptz not null,                 -- data visibility cutoff used for features
  call                  text not null check (call in ('PICK', 'NO_CALL')),
  no_call_reason        text,
  p_home                double precision not null check (p_home > 0 and p_home < 1),
  pick_team_id          text,
  pick_probability      double precision check (pick_probability is null or (pick_probability >= 0.5 and pick_probability < 1)),
  confidence            text check (confidence in ('high', 'medium', 'low')),
  feature_vector        jsonb not null,
  feature_hash          text not null check (feature_hash ~ '^[0-9a-f]{64}$'),
  reasoning             jsonb not null,
  data_quality          jsonb not null,
  market                jsonb,                                -- consensus snapshot seen by this pass (presentation only)
  market_devig_probability double precision check (market_devig_probability is null or (market_devig_probability > 0 and market_devig_probability < 1)),
  pbe_edge              double precision,
  constraint wnba_pbe_obs_teams check (home_team_id <> away_team_id),
  constraint wnba_pbe_obs_asof check (as_of <= scheduled_tip_utc and generated_at <= scheduled_tip_utc),
  constraint wnba_pbe_obs_call check (
    (call = 'PICK' and pick_team_id in (home_team_id, away_team_id) and pick_probability is not null and confidence is not null and no_call_reason is null)
    or (call = 'NO_CALL' and pick_team_id is null and no_call_reason is not null)
  )
);
create index if not exists wnba_pbe_obs_game_idx on public.wnba_pbe_prediction_observations (game_id, recorded_at desc);
create index if not exists wnba_pbe_obs_model_idx on public.wnba_pbe_prediction_observations (model_id, recorded_at desc);

create or replace function public.wnba_pbe_observation_insert() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.recorded_at := clock_timestamp();
  if new.recorded_at >= new.scheduled_tip_utc then
    raise exception 'wnba_pbe: observation for game % recorded at/after scheduled tip', new.game_id using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ------------------------------------------------------------------ 2. official locked predictions (write-once)

create table if not exists public.wnba_pbe_locked_predictions (
  prediction_id              uuid primary key default gen_random_uuid(),
  contract                   text not null default 'game_winner_v1',  -- what is being predicted
  game_id                    text not null,
  season                     int not null,
  season_type                int not null check (season_type in (2, 3)),
  scheduled_tip_utc          timestamptz not null,
  home_team_id               text not null,
  away_team_id               text not null,
  neutral_site               boolean not null,
  call                       text not null check (call in ('PICK', 'NO_CALL')),
  no_call_reason             text,
  selected_team_id           text,
  selected_side              text check (selected_side in ('home', 'away')),
  p_home                     double precision not null check (p_home > 0 and p_home < 1),
  win_probability            double precision check (win_probability is null or (win_probability >= 0.5 and win_probability < 1)),
  confidence                 text check (confidence in ('high', 'medium', 'low')),
  feature_vector             jsonb not null,
  feature_hash               text not null check (feature_hash ~ '^[0-9a-f]{64}$'),
  model_id                   text not null references public.wnba_pbe_model_versions(model_id),
  artifact_sha256            text not null check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  feature_spec_sha256        text not null check (feature_spec_sha256 ~ '^[0-9a-f]{64}$'),
  reasoning                  jsonb not null,
  generated_at               timestamptz not null,
  locked_at                  timestamptz not null default now(),        -- forced to the insert clock by trigger
  lock_policy                text not null,
  source_observation_id      uuid not null references public.wnba_pbe_prediction_observations(observation_id),
  market_at_lock             jsonb,                                     -- consensus moneyline, books, captured_at, age
  market_devig_probability   double precision check (market_devig_probability is null or (market_devig_probability > 0 and market_devig_probability < 1)),
  pbe_edge_at_lock           double precision,
  constraint wnba_pbe_lock_teams check (home_team_id <> away_team_id),
  constraint wnba_pbe_lock_call check (
    (call = 'PICK'
      and selected_team_id is not null and win_probability is not null and confidence is not null and no_call_reason is null
      and ((selected_side = 'home' and selected_team_id = home_team_id and abs(win_probability - p_home) < 1e-12)
        or (selected_side = 'away' and selected_team_id = away_team_id and abs(win_probability - (1 - p_home)) < 1e-12)))
    or (call = 'NO_CALL' and selected_team_id is null and selected_side is null and win_probability is null and no_call_reason is not null)
  ),
  constraint wnba_pbe_lock_edge check (
    pbe_edge_at_lock is null
    or (call = 'PICK' and market_devig_probability is not null and abs(pbe_edge_at_lock - (win_probability - market_devig_probability)) < 1e-9)
  ),
  constraint wnba_pbe_lock_generated check (generated_at <= scheduled_tip_utc),
  -- one official production lock per canonical game per contract, whichever model produced it
  constraint wnba_pbe_lock_one_per_game unique (game_id, contract)
);
create index if not exists wnba_pbe_lock_tip_idx on public.wnba_pbe_locked_predictions (scheduled_tip_utc desc);
create index if not exists wnba_pbe_lock_team_home_idx on public.wnba_pbe_locked_predictions (home_team_id, scheduled_tip_utc desc);
create index if not exists wnba_pbe_lock_team_away_idx on public.wnba_pbe_locked_predictions (away_team_id, scheduled_tip_utc desc);

create or replace function public.wnba_pbe_lock_insert() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  obs public.wnba_pbe_prediction_observations%rowtype;
  mv  public.wnba_pbe_model_versions%rowtype;
  champion text;
begin
  new.locked_at := clock_timestamp();
  if new.locked_at >= new.scheduled_tip_utc then
    raise exception 'wnba_pbe: lock for game % at/after scheduled tip', new.game_id using errcode = 'P0001';
  end if;

  champion := public.wnba_pbe_current_champion();
  if champion is null or champion <> new.model_id then
    raise exception 'wnba_pbe: official locks come only from the current champion (%), not %', coalesce(champion, 'none'), new.model_id using errcode = 'P0001';
  end if;

  select * into mv from public.wnba_pbe_model_versions where model_id = new.model_id;
  if not found or mv.artifact_sha256 <> new.artifact_sha256 or mv.feature_spec_sha256 <> new.feature_spec_sha256 then
    raise exception 'wnba_pbe: lock hashes do not match registered model %', new.model_id using errcode = 'P0001';
  end if;

  -- The official call must be exactly an observation that was recorded before it.
  select * into obs from public.wnba_pbe_prediction_observations where observation_id = new.source_observation_id;
  if not found or obs.game_id <> new.game_id or obs.model_id <> new.model_id or obs.feature_hash <> new.feature_hash
     or obs.home_team_id <> new.home_team_id or obs.away_team_id <> new.away_team_id
     or obs.call <> new.call or obs.p_home <> new.p_home
     or obs.pick_team_id is distinct from new.selected_team_id
     or obs.confidence is distinct from new.confidence
     or obs.feature_vector <> new.feature_vector or obs.reasoning <> new.reasoning
     or obs.generated_at <> new.generated_at then
    raise exception 'wnba_pbe: lock for game % does not match its source observation', new.game_id using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ------------------------------------------------------------------ 3. grade revisions (append-only)

create table if not exists public.wnba_pbe_grade_revisions (
  grade_id              uuid primary key default gen_random_uuid(),
  prediction_id         uuid not null references public.wnba_pbe_locked_predictions(prediction_id),
  revision              int not null check (revision >= 1),
  result                text not null check (result in ('win', 'loss', 'void')),
  home_score            int check (home_score >= 0),
  away_score            int check (away_score >= 0),
  winner_team_id        text,
  result_reference      jsonb not null,               -- authoritative source: provider event id, status, url, captured_at
  graded_at             timestamptz not null default now(),   -- forced to the insert clock by trigger
  graded_by             text not null,                -- grader run id / operator
  supersedes_grade_id   uuid references public.wnba_pbe_grade_revisions(grade_id),
  correction_reason     text,
  constraint wnba_pbe_grade_revision_unique unique (prediction_id, revision),
  constraint wnba_pbe_grade_chain check (
    (revision = 1 and supersedes_grade_id is null and correction_reason is null)
    or (revision > 1 and supersedes_grade_id is not null and correction_reason is not null and length(trim(correction_reason)) > 0)
  ),
  constraint wnba_pbe_grade_scores check (
    (result = 'void' and winner_team_id is null)
    or (result <> 'void' and home_score is not null and away_score is not null and home_score <> away_score and winner_team_id is not null)
  )
);
create index if not exists wnba_pbe_grade_prediction_idx on public.wnba_pbe_grade_revisions (prediction_id, revision desc);

create or replace function public.wnba_pbe_grade_insert() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  lp public.wnba_pbe_locked_predictions%rowtype;
  latest public.wnba_pbe_grade_revisions%rowtype;
  expected text;
begin
  new.graded_at := clock_timestamp();
  -- Concurrent graders race on unique (prediction_id, revision): the loser fails, nothing is overwritten.
  -- (No row locks: FOR SHARE/UPDATE would need UPDATE privilege, which no writer is ever granted.)
  select * into lp from public.wnba_pbe_locked_predictions where prediction_id = new.prediction_id;
  if not found then
    raise exception 'wnba_pbe: grade for unknown prediction %', new.prediction_id using errcode = 'P0001';
  end if;
  if lp.call <> 'PICK' then
    raise exception 'wnba_pbe: NO_CALL prediction % is never graded', new.prediction_id using errcode = 'P0001';
  end if;
  if new.graded_at <= lp.scheduled_tip_utc then
    raise exception 'wnba_pbe: grade for prediction % before scheduled tip', new.prediction_id using errcode = 'P0001';
  end if;

  select * into latest from public.wnba_pbe_grade_revisions
    where prediction_id = new.prediction_id order by revision desc limit 1;
  if not found then
    if new.revision <> 1 then
      raise exception 'wnba_pbe: first grade must be revision 1' using errcode = 'P0001';
    end if;
  elsif new.revision <> latest.revision + 1 or new.supersedes_grade_id is distinct from latest.grade_id then
    raise exception 'wnba_pbe: revision % must follow revision % and supersede it', new.revision, latest.revision using errcode = 'P0001';
  end if;

  if new.result <> 'void' then
    if new.winner_team_id not in (lp.home_team_id, lp.away_team_id)
       or (new.home_score > new.away_score) <> (new.winner_team_id = lp.home_team_id) then
      raise exception 'wnba_pbe: winner does not match the final score' using errcode = 'P0001';
    end if;
    expected := case when new.winner_team_id = lp.selected_team_id then 'win' else 'loss' end;
    if new.result <> expected then
      raise exception 'wnba_pbe: result % contradicts the score (expected %)', new.result, expected using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

-- Latest revision per prediction = the displayed grade. security_invoker keeps RLS/privileges of the caller.
create or replace view public.wnba_pbe_current_grades with (security_invoker = true) as
  select distinct on (g.prediction_id) g.*
  from public.wnba_pbe_grade_revisions g
  order by g.prediction_id, g.revision desc;

-- ------------------------------------------------------------------ triggers (only on the new tables)

drop trigger if exists wnba_pbe_model_versions_stamp on public.wnba_pbe_model_versions;
create trigger wnba_pbe_model_versions_stamp before insert on public.wnba_pbe_model_versions
  for each row execute function public.wnba_pbe_stamp_insert('registered_at');
drop trigger if exists wnba_pbe_model_promotions_stamp on public.wnba_pbe_model_promotions;
create trigger wnba_pbe_model_promotions_stamp before insert on public.wnba_pbe_model_promotions
  for each row execute function public.wnba_pbe_stamp_insert('promoted_at');
drop trigger if exists wnba_pbe_model_versions_immutable on public.wnba_pbe_model_versions;
create trigger wnba_pbe_model_versions_immutable before update or delete on public.wnba_pbe_model_versions
  for each row execute function public.wnba_pbe_reject_mutation('register a new model version');
drop trigger if exists wnba_pbe_model_versions_no_truncate on public.wnba_pbe_model_versions;
create trigger wnba_pbe_model_versions_no_truncate before truncate on public.wnba_pbe_model_versions
  for each statement execute function public.wnba_pbe_reject_truncate();

drop trigger if exists wnba_pbe_model_promotions_immutable on public.wnba_pbe_model_promotions;
create trigger wnba_pbe_model_promotions_immutable before update or delete on public.wnba_pbe_model_promotions
  for each row execute function public.wnba_pbe_reject_mutation('append a new promotion');
drop trigger if exists wnba_pbe_model_promotions_no_truncate on public.wnba_pbe_model_promotions;
create trigger wnba_pbe_model_promotions_no_truncate before truncate on public.wnba_pbe_model_promotions
  for each statement execute function public.wnba_pbe_reject_truncate();

drop trigger if exists wnba_pbe_observations_insert on public.wnba_pbe_prediction_observations;
create trigger wnba_pbe_observations_insert before insert on public.wnba_pbe_prediction_observations
  for each row execute function public.wnba_pbe_observation_insert();
drop trigger if exists wnba_pbe_observations_immutable on public.wnba_pbe_prediction_observations;
create trigger wnba_pbe_observations_immutable before update or delete on public.wnba_pbe_prediction_observations
  for each row execute function public.wnba_pbe_reject_mutation('observations are append-only');
drop trigger if exists wnba_pbe_observations_no_truncate on public.wnba_pbe_prediction_observations;
create trigger wnba_pbe_observations_no_truncate before truncate on public.wnba_pbe_prediction_observations
  for each statement execute function public.wnba_pbe_reject_truncate();

drop trigger if exists wnba_pbe_locked_insert on public.wnba_pbe_locked_predictions;
create trigger wnba_pbe_locked_insert before insert on public.wnba_pbe_locked_predictions
  for each row execute function public.wnba_pbe_lock_insert();
drop trigger if exists wnba_pbe_locked_immutable on public.wnba_pbe_locked_predictions;
create trigger wnba_pbe_locked_immutable before update or delete on public.wnba_pbe_locked_predictions
  for each row execute function public.wnba_pbe_reject_mutation('an official locked prediction never changes');
drop trigger if exists wnba_pbe_locked_no_truncate on public.wnba_pbe_locked_predictions;
create trigger wnba_pbe_locked_no_truncate before truncate on public.wnba_pbe_locked_predictions
  for each statement execute function public.wnba_pbe_reject_truncate();

drop trigger if exists wnba_pbe_grades_insert on public.wnba_pbe_grade_revisions;
create trigger wnba_pbe_grades_insert before insert on public.wnba_pbe_grade_revisions
  for each row execute function public.wnba_pbe_grade_insert();
drop trigger if exists wnba_pbe_grades_immutable on public.wnba_pbe_grade_revisions;
create trigger wnba_pbe_grades_immutable before update or delete on public.wnba_pbe_grade_revisions
  for each row execute function public.wnba_pbe_reject_mutation('append a correcting revision');
drop trigger if exists wnba_pbe_grades_no_truncate on public.wnba_pbe_grade_revisions;
create trigger wnba_pbe_grades_no_truncate before truncate on public.wnba_pbe_grade_revisions
  for each statement execute function public.wnba_pbe_reject_truncate();

-- ------------------------------------------------------------------ access: server-side only

alter table public.wnba_pbe_model_versions            enable row level security;
alter table public.wnba_pbe_model_promotions          enable row level security;
alter table public.wnba_pbe_prediction_observations   enable row level security;
alter table public.wnba_pbe_locked_predictions        enable row level security;
alter table public.wnba_pbe_grade_revisions           enable row level security;

revoke all on public.wnba_pbe_model_versions, public.wnba_pbe_model_promotions,
              public.wnba_pbe_prediction_observations, public.wnba_pbe_locked_predictions,
              public.wnba_pbe_grade_revisions, public.wnba_pbe_current_grades
  from anon, authenticated;
revoke all on function public.wnba_pbe_current_champion(), public.wnba_pbe_reject_mutation(), public.wnba_pbe_stamp_insert(),
                       public.wnba_pbe_reject_truncate(), public.wnba_pbe_observation_insert(),
                       public.wnba_pbe_lock_insert(), public.wnba_pbe_grade_insert()
  from public, anon, authenticated;

-- service_role writes rows but can never update or delete them: the privilege is revoked (Supabase default
-- privileges grant ALL on new tables) and the triggers above refuse it for every role regardless.
revoke update, delete, truncate, references, trigger on public.wnba_pbe_model_versions, public.wnba_pbe_model_promotions,
              public.wnba_pbe_prediction_observations, public.wnba_pbe_locked_predictions,
              public.wnba_pbe_grade_revisions, public.wnba_pbe_current_grades
  from service_role;
grant select, insert on public.wnba_pbe_model_versions, public.wnba_pbe_model_promotions,
                        public.wnba_pbe_prediction_observations, public.wnba_pbe_locked_predictions,
                        public.wnba_pbe_grade_revisions
  to service_role;
grant select on public.wnba_pbe_current_grades to service_role;
grant execute on function public.wnba_pbe_current_champion() to service_role;

commit;
