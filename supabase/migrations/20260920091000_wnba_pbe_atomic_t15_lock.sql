-- PropBetEdge WNBA — atomic T-15 official lock
-- Hotfix 2026-09-20: official prediction observations have been reaching the
-- ledger while the second Worker -> PostgREST lock write has intermittently
-- failed. Move the irreversible lock boundary into the same database
-- transaction that records the T-15 observation.
--
-- The existing wnba_pbe_locked_insert trigger remains authoritative and still
-- validates champion model, model hashes, exact observation identity, lock
-- time, and immutable call semantics. This trigger only asks that existing
-- guard to create the lock from the observation that was just committed.
--
-- Historical observations are never backfilled. Only a NEW observation
-- recorded by the database clock from T-15:00 through tip can create a lock.

begin;

create or replace function public.wnba_pbe_autolock_t15_from_observation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  mv public.wnba_pbe_model_versions%rowtype;
  champion text;
begin
  -- Outside the frozen T-15m/v1 window this trigger is a no-op.
  if new.recorded_at < new.scheduled_tip_utc - interval '15 minutes'
     or new.recorded_at >= new.scheduled_tip_utc then
    return new;
  end if;

  -- Preserve observations from non-champion models for audit, but never turn
  -- them into official production locks.
  champion := public.wnba_pbe_current_champion();
  if champion is null or champion <> new.model_id then
    return new;
  end if;

  select * into mv
  from public.wnba_pbe_model_versions
  where model_id = new.model_id;

  if not found then
    return new;
  end if;

  insert into public.wnba_pbe_locked_predictions (
    contract,
    game_id,
    season,
    season_type,
    scheduled_tip_utc,
    home_team_id,
    away_team_id,
    neutral_site,
    call,
    no_call_reason,
    selected_team_id,
    selected_side,
    p_home,
    win_probability,
    confidence,
    feature_vector,
    feature_hash,
    model_id,
    artifact_sha256,
    feature_spec_sha256,
    reasoning,
    generated_at,
    lock_policy,
    source_observation_id,
    market_at_lock,
    market_devig_probability,
    pbe_edge_at_lock
  )
  values (
    'game_winner_v1',
    new.game_id,
    new.season,
    new.season_type,
    new.scheduled_tip_utc,
    new.home_team_id,
    new.away_team_id,
    new.neutral_site,
    new.call,
    new.no_call_reason,
    new.pick_team_id,
    case
      when new.pick_team_id = new.home_team_id then 'home'
      when new.pick_team_id = new.away_team_id then 'away'
      else null
    end,
    new.p_home,
    new.pick_probability,
    new.confidence,
    new.feature_vector,
    new.feature_hash,
    new.model_id,
    mv.artifact_sha256,
    mv.feature_spec_sha256,
    new.reasoning,
    new.generated_at,
    'T-15m/v1',
    new.observation_id,
    new.market,
    case when new.call = 'PICK' then new.market_devig_probability else null end,
    case
      when new.call = 'PICK' and new.market_devig_probability is not null
        then new.pbe_edge
      else null
    end
  )
  on conflict (game_id, contract) do nothing;

  return new;
end
$$;

drop trigger if exists wnba_pbe_observations_autolock_t15
  on public.wnba_pbe_prediction_observations;

create trigger wnba_pbe_observations_autolock_t15
after insert on public.wnba_pbe_prediction_observations
for each row
execute function public.wnba_pbe_autolock_t15_from_observation();

comment on function public.wnba_pbe_autolock_t15_from_observation() is
  'Atomic T-15m/v1 lock boundary: a newly recorded champion observation inside the lock window creates the immutable official lock in the same database transaction. Never backfills historical observations.';

commit;
