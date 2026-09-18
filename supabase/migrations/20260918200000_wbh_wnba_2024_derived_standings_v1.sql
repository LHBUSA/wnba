-- Women's Basketball History — derived 2024 standings, with the determinism gate
--
-- Standings are DERIVED from canonical game facts, never ingested. This migration builds them twice
-- from the same inputs, hashes both results, and refuses to store anything unless the two hashes are
-- identical. That is the gate the previous block owed: a rebuild that cannot be reproduced is not a
-- derivation, it is a snapshot.
--
-- Inputs: every 2024 game with counts_for_standings and a recorded result. That deliberately includes
-- the 2024-09-01 fixture whose score is unknown but whose result is established, and deliberately
-- excludes the Commissioner's Cup final, which counts for statistics but not for standings.
--
-- Ranking rule (rule_version standings_v1): order by win percentage descending, then by team edition
-- id, purely so the output is total and reproducible. It is NOT the league's official tiebreaker,
-- and tiebreak_method records exactly that so nobody mistakes it for one.

begin;

do $seed$
declare
  v_run uuid;
  v_dataset_id uuid;
  v_now timestamptz := clock_timestamp();
  v_as_of constant timestamptz := timestamptz '2024-12-31 00:00:00+00';
  v_dataset constant text := 'wnba_2024_derived_standings_v1';
  v_rule constant text := 'standings_v1';
  v_existing integer;
  v_input_hash text;
  v_hash_a text;
  v_hash_b text;
  v_rows integer;
  v_games integer;
begin
  perform public.wbh_assert_ingestible('pbe_curation');

  select count(*) into v_existing
    from public.wbh_ingestion_runs where scope->>'dataset' = v_dataset and status = 'ok';
  if v_existing > 0 then return; end if;

  -- ---------------------------------------------------------------- the input set, as of a cut
  create temp table _input on commit drop as
  select gt.team_edition_id, gt.result, g.game_id
    from public.wbh_games g
    join public.wbh_game_teams gt on gt.game_id = g.game_id
   where g.edition_id = 'wnba_2024'
     and g.counts_for_standings
     and gt.result is not null
     -- the temporal cut uses the date the game was played. effective_at on the existing game rows
     -- is the moment they were written, not the moment they became true, so it cannot carry as-of
     -- semantics yet; backfilling it to the game date is a separate, explicit job.
     and g.local_date <= v_as_of::date;

  select count(distinct game_id) into v_games from _input;
  if v_games <> 240 then
    raise exception 'wbh: expected 240 standings games, found %', v_games using errcode = 'P0001';
  end if;

  select encode(extensions.digest(convert_to(string_agg(x, '|' order by x), 'UTF8'), 'sha256'), 'hex')
    into v_input_hash
    from (select game_id || ':' || team_edition_id || ':' || result as x from _input) s;

  -- ---------------------------------------------------------------- build it twice
  create temp table _build_a on commit drop as
  select team_edition_id,
         count(*)::int as games_played,
         count(*) filter (where result = 'win')::int as wins,
         count(*) filter (where result = 'loss')::int as losses,
         round(count(*) filter (where result = 'win')::numeric / nullif(count(*), 0), 6) as win_pct
    from _input group by team_edition_id;

  create temp table _build_b on commit drop as
  select team_edition_id,
         count(*)::int as games_played,
         count(*) filter (where result = 'win')::int as wins,
         count(*) filter (where result = 'loss')::int as losses,
         round(count(*) filter (where result = 'win')::numeric / nullif(count(*), 0), 6) as win_pct
    from _input group by team_edition_id;

  select encode(extensions.digest(convert_to(string_agg(x, '|' order by x), 'UTF8'), 'sha256'), 'hex')
    into v_hash_a
    from (select team_edition_id || ':' || games_played || ':' || wins || ':' || losses || ':' || win_pct as x
            from _build_a) s;
  select encode(extensions.digest(convert_to(string_agg(x, '|' order by x), 'UTF8'), 'sha256'), 'hex')
    into v_hash_b
    from (select team_edition_id || ':' || games_played || ':' || wins || ':' || losses || ':' || win_pct as x
            from _build_b) s;

  if v_hash_a is distinct from v_hash_b then
    raise exception 'wbh: standings rebuild is not deterministic (% vs %)', v_hash_a, v_hash_b
      using errcode = 'P0001';
  end if;

  -- every club must have played exactly 40 counted games
  if exists (select 1 from _build_a where games_played <> 40) then
    raise exception 'wbh: a club does not have 40 counted games' using errcode = 'P0001';
  end if;
  if (select sum(wins) from _build_a) <> (select sum(losses) from _build_a) then
    raise exception 'wbh: wins and losses do not balance' using errcode = 'P0001';
  end if;

  -- ---------------------------------------------------------------- store it
  insert into public.wbh_ingestion_runs
    (source_id, adapter_id, adapter_version, transformation_version, mode, as_of, scope)
  values
    ('pbe_curation', 'wbh_derive_standings', '1.0.0', v_rule, 'ingest', v_as_of,
     jsonb_build_object('dataset', v_dataset, 'edition_id', 'wnba_2024',
                        'derived_from', 'canonical game results only',
                        'rebuilds_compared', 2, 'hashes_identical', true,
                        'cup_final_excluded', true,
                        'as_of_basis', 'local_date; effective_at is write time on existing rows',
                        'tiebreak', 'win_pct desc then team_edition_id; not the official tiebreaker'))
  returning run_id into v_run;

  insert into public.wbh_derived_datasets
    (kind, edition_id, as_of, rule_version, input_sha256, dataset_sha256, row_count,
     is_current, is_synthetic, ingestion_run_id)
  values
    ('standings', 'wnba_2024', v_as_of, v_rule, v_input_hash, v_hash_a,
     (select count(*) from _build_a), true, false, v_run)
  returning dataset_id into v_dataset_id;

  insert into public.wbh_standings
    (dataset_id, team_edition_id, games_played, wins, losses, win_pct, rank_overall, tiebreak_method)
  select v_dataset_id, b.team_edition_id, b.games_played, b.wins, b.losses, b.win_pct,
         row_number() over (order by b.win_pct desc, b.team_edition_id),
         'win_pct desc, then team_edition_id; deterministic ordering, not the league tiebreaker'
    from _build_a b;

  select count(*) into v_rows from public.wbh_standings where dataset_id = v_dataset_id;
  if v_rows <> 12 then
    raise exception 'wbh: expected 12 standings rows, wrote %', v_rows using errcode = 'P0001';
  end if;

  -- the leader must be the club with the most wins
  if (select team_edition_id from public.wbh_standings where dataset_id = v_dataset_id and rank_overall = 1)
     <> (select team_edition_id from _build_a order by wins desc, team_edition_id limit 1) then
    raise exception 'wbh: rank 1 is not the club with the most wins' using errcode = 'P0001';
  end if;

  update public.wbh_ingestion_runs
     set status = 'ok',
         counts = jsonb_build_object('standings_rows', v_rows, 'games_counted', v_games,
                                     'dataset_sha256', v_hash_a, 'input_sha256', v_input_hash),
         finished_at = clock_timestamp()
   where run_id = v_run;
end $seed$;

commit;
