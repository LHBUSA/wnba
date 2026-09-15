-- Proof body for 20260915200000_wnba_pbe_ledger_v1.sql. Assembled by supabase/proofs/build-proof.mjs into
-- a transaction that ALWAYS rolls back. The two MIGRATION markers below become the migration body (its own begin/commit removed).
-- Every positive write runs as service_role, the production writer. Expected failures are caught and recorded.

create temp table _proof (step text primary key, check_name text not null, pass boolean not null, detail text);
grant all on _proof to public;

create or replace function pg_temp._fingerprint() returns text language sql as $fp$
  select md5(string_agg(x, '|' order by x)) from (
    select 'rel:' || n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || coalesce(c.relacl::text, '') as x
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and n.nspname not like 'pg\_temp%' and n.nspname not like 'pg\_toast\_temp%'
       and c.relname not like 'wnba\_pbe%'
    union all
    select 'col:' || a.attrelid::regclass::text || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attnum > 0 and not a.attisdropped and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
       and n.nspname not like 'pg\_temp%' and n.nspname not like 'pg\_toast%' and c.relname not like 'wnba\_pbe%'
    union all
    select 'con:' || conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
      from pg_constraint where conrelid <> 0 and conrelid::regclass::text not like '%wnba\_pbe%' and connamespace::regnamespace::text not like 'pg\_temp%'
    union all
    select 'trg:' || tgrelid::regclass::text || ':' || tgname || ':' || pg_get_triggerdef(oid)
      from pg_trigger where not tgisinternal and tgrelid::regclass::text not like '%wnba\_pbe%'
    union all
    select 'pol:' || schemaname || '.' || tablename || ':' || policyname || ':' || cmd::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') || ':' || array_to_string(roles, ',')
      from pg_policies where tablename not like 'wnba\_pbe%'
    union all
    select 'fn:' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, '') || ':' || p.prosecdef::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_temp%' and p.proname not like 'wnba\_pbe%'
    union all
    select 'nsp:' || nspname || ':' || coalesce(nspacl::text, '') from pg_namespace where nspname not like 'pg\_temp%' and nspname not like 'pg\_toast\_temp%'
    union all
    select 'defacl:' || defaclrole::regrole::text || ':' || coalesce(defaclnamespace::regnamespace::text, '') || ':' || defaclobjtype::text || ':' || defaclacl::text from pg_default_acl
  ) s
$fp$;

create temp table _fp as select pg_temp._fingerprint() as before_fp, null::text as after_fp,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname not like 'pg\_temp%' and n.nspname not like 'pg\_toast%' and c.relname not like 'wnba\_pbe%') as before_rel_count;

insert into _proof values ('01', 'clean install: no wnba_pbe_* object exists before the migration',
  not exists (select 1 from pg_class where relname like 'wnba\_pbe%') and not exists (select 1 from pg_proc where proname like 'wnba\_pbe%'),
  (select count(*)::text || ' pre-existing wnba_pbe relations' from pg_class where relname like 'wnba\_pbe%'));

-- ================================================================ first execution
{{MIGRATION}}

create temp table _objs as select
  (select count(*) from pg_class where relname like 'wnba\_pbe%') as rels,
  (select count(*) from pg_proc where proname like 'wnba\_pbe%') as fns,
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname like 'wnba\_pbe%' and not t.tgisinternal) as trgs;

-- ================================================================ second execution (idempotency)
{{MIGRATION}}

insert into _proof select '02', 'second execution succeeds and creates nothing new',
  o.rels = (select count(*) from pg_class where relname like 'wnba\_pbe%')
  and o.fns = (select count(*) from pg_proc where proname like 'wnba\_pbe%')
  and o.trgs = (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname like 'wnba\_pbe%' and not t.tgisinternal),
  format('relations %s, functions %s, triggers %s after both runs', o.rels, o.fns, o.trgs)
from _objs o;

insert into _proof select '03', 'access: RLS on all 5 tables, zero policies, anon/authenticated hold no privilege',
  (select count(*) from pg_class where relname in ('wnba_pbe_model_versions','wnba_pbe_model_promotions','wnba_pbe_prediction_observations','wnba_pbe_locked_predictions','wnba_pbe_grade_revisions') and relrowsecurity) = 5
  and not exists (select 1 from pg_policies where tablename like 'wnba\_pbe%')
  and not exists (
    select 1 from information_schema.role_table_grants
     where table_name like 'wnba\_pbe%' and grantee in ('anon', 'authenticated')
  )
  and not has_table_privilege('anon', 'public.wnba_pbe_locked_predictions', 'select')
  and not has_table_privilege('authenticated', 'public.wnba_pbe_grade_revisions', 'select')
  and not has_table_privilege('service_role', 'public.wnba_pbe_locked_predictions', 'update')
  and not has_table_privilege('service_role', 'public.wnba_pbe_locked_predictions', 'delete'),
  'rls=5/5 · policies=0 · anon/authenticated grants=0 · service_role: select+insert only';

-- ================================================================ fixtures (as the production writer)
create temp table _ids (k text primary key, v uuid);
grant all on _ids to public;

set role service_role;

insert into public.wnba_pbe_model_versions (model_id, model_type, feature_schema, artifact_sha256, feature_spec_sha256, validation_receipt_sha256, training_window, validation_summary, role_at_registration, artifact_uri, registered_at)
values ('pbe-wnba-model-v1', 'logistic_regression_l2_structural_home', 'pbe-wnba-features/1.0.0',
        '180dfcf50ca8fa96c2a71b7ee37abde80aacc5ff5f403783b03b4769436394f3', 'f03358e8ef81e3c1d08c06dd6527f96e9e885bff79aeb24e7eb26e87d910a25d',
        '75cbf12fe3e5281e24401905a55bf92c6655d0c03d758bf5c74b1e699c756f85', '{"seasons":[2019,2026]}', '{"holdout_log_loss":0.611}', 'champion_candidate',
        'model/pbe-wnba-model-v1/artifact.json', '2001-01-01T00:00:00Z'),
       ('pbe-wnba-challenger-proof', 'logistic_regression_l2_structural_home', 'pbe-wnba-features/1.0.0',
        repeat('a', 64), repeat('b', 64), repeat('c', 64), '{}', '{}', 'challenger', null, now());

insert into public.wnba_pbe_model_promotions (model_id, promoted_by, evidence, promoted_at)
values ('pbe-wnba-model-v1', 'proof', '{"receipt":"validation_receipt.json"}', '2001-01-01T00:00:00Z');

reset role;
insert into _proof select '04', 'registry insert stamps the server clock (backdated registered_at/promoted_at ignored)',
  (select registered_at > now() - interval '1 hour' from public.wnba_pbe_model_versions where model_id = 'pbe-wnba-model-v1')
  and (select promoted_at > now() - interval '1 hour' from public.wnba_pbe_model_promotions where model_id = 'pbe-wnba-model-v1')
  and public.wnba_pbe_current_champion() = 'pbe-wnba-model-v1',
  'champion = ' || coalesce(public.wnba_pbe_current_champion(), 'none');

-- ================================================================ pre-lock observation
set role service_role;
do $t$
declare oid uuid;
begin
  insert into public.wnba_pbe_prediction_observations
    (run_id, game_id, season, season_type, scheduled_tip_utc, home_team_id, away_team_id, model_id, generated_at, as_of, call, p_home, pick_team_id, pick_probability, confidence,
     feature_vector, feature_hash, reasoning, data_quality, market, market_devig_probability, pbe_edge, recorded_at)
  values ('proof-run-1', 'proof-game-1', 2026, 2, clock_timestamp() + interval '3 seconds', '9', '17', 'pbe-wnba-model-v1', now(), now(), 'PICK', 0.638, '9', 0.638, 'medium',
     '{"sos_adj_net":4.8}', repeat('d', 64), '{"supporting":["+4.8 net rating"],"opposing":[]}', '{"home_games":30,"away_games":30}', '{"consensus":-135}', 0.554, 0.084, '2001-01-01T00:00:00Z')
  returning observation_id into oid;
  insert into _ids values ('obs1', oid);
  insert into _proof select '05', 'pre-lock observation insert allowed (as service_role; recorded_at forced to server clock)', true,
    'observation ' || oid || ' recorded_at ' || (select recorded_at from public.wnba_pbe_prediction_observations where observation_id = oid);
exception when others then
  insert into _proof values ('05', 'pre-lock observation insert allowed', false, sqlerrm);
end $t$;

do $t$
begin
  begin
    update public.wnba_pbe_prediction_observations set p_home = 0.5 where observation_id = (select v from _ids where k = 'obs1');
    insert into _proof values ('06', 'observation update rejected (append-only)', false, 'update succeeded');
  exception when others then
    insert into _proof values ('06', 'observation update rejected (append-only)', sqlerrm like 'wnba_pbe:%' or sqlstate = '42501', sqlstate || ' ' || sqlerrm);
  end;
end $t$;

-- ================================================================ official lock
do $t$
declare pid uuid; o public.wnba_pbe_prediction_observations%rowtype;
begin
  select * into o from public.wnba_pbe_prediction_observations where observation_id = (select v from _ids where k = 'obs1');
  insert into public.wnba_pbe_locked_predictions
    (game_id, season, season_type, scheduled_tip_utc, home_team_id, away_team_id, neutral_site, call, selected_team_id, selected_side, p_home, win_probability, confidence,
     feature_vector, feature_hash, model_id, artifact_sha256, feature_spec_sha256, reasoning, generated_at, lock_policy, source_observation_id,
     market_at_lock, market_devig_probability, pbe_edge_at_lock, locked_at)
  values (o.game_id, o.season, o.season_type, o.scheduled_tip_utc, o.home_team_id, o.away_team_id, o.neutral_site, o.call, o.pick_team_id, 'home', o.p_home, o.pick_probability, o.confidence,
     o.feature_vector, o.feature_hash, o.model_id, '180dfcf50ca8fa96c2a71b7ee37abde80aacc5ff5f403783b03b4769436394f3', 'f03358e8ef81e3c1d08c06dd6527f96e9e885bff79aeb24e7eb26e87d910a25d',
     o.reasoning, o.generated_at, 'T-15m/v1', o.observation_id, o.market, 0.554, 0.084, '2001-01-01T00:00:00Z')
  returning prediction_id into pid;
  insert into _ids values ('lock1', pid);
  insert into _proof values ('07', 'official lock insert allowed (champion model, matches its observation, locked_at forced)', true, 'prediction ' || pid);
exception when others then
  insert into _proof values ('07', 'official lock insert allowed', false, sqlerrm);
end $t$;

-- non-champion and mismatched locks
do $t$
declare o public.wnba_pbe_prediction_observations%rowtype; oid2 uuid;
begin
  insert into public.wnba_pbe_prediction_observations
    (run_id, game_id, season, season_type, scheduled_tip_utc, home_team_id, away_team_id, model_id, generated_at, as_of, call, p_home, no_call_reason, feature_vector, feature_hash, reasoning, data_quality)
  values ('proof-run-1', 'proof-game-2', 2026, 2, now() + interval '1 day', '5', '6', 'pbe-wnba-challenger-proof', now(), now(), 'NO_CALL', 0.51, 'below_threshold', '{}', repeat('e', 64), '{}', '{}')
  returning observation_id into oid2;
  select * into o from public.wnba_pbe_prediction_observations where observation_id = oid2;
  begin
    insert into public.wnba_pbe_locked_predictions (game_id, season, season_type, scheduled_tip_utc, home_team_id, away_team_id, neutral_site, call, no_call_reason, p_home, feature_vector, feature_hash, model_id, artifact_sha256, feature_spec_sha256, reasoning, generated_at, lock_policy, source_observation_id)
    values (o.game_id, 2026, 2, o.scheduled_tip_utc, '5', '6', false, 'NO_CALL', 'below_threshold', 0.51, '{}', o.feature_hash, 'pbe-wnba-challenger-proof', repeat('a', 64), repeat('b', 64), '{}', o.generated_at, 'T-15m/v1', oid2);
    insert into _proof values ('08', 'lock from a non-champion model rejected', false, 'insert succeeded');
  exception when others then
    insert into _proof values ('08', 'lock from a non-champion model rejected', sqlerrm like 'wnba_pbe: official locks come only from the current champion%', sqlerrm);
  end;
  select * into o from public.wnba_pbe_prediction_observations where observation_id = (select v from _ids where k = 'obs1');
  begin
    insert into public.wnba_pbe_locked_predictions (contract, game_id, season, season_type, scheduled_tip_utc, home_team_id, away_team_id, neutral_site, call, selected_team_id, selected_side, p_home, win_probability, confidence, feature_vector, feature_hash, model_id, artifact_sha256, feature_spec_sha256, reasoning, generated_at, lock_policy, source_observation_id)
    values ('game_winner_proof_variant', o.game_id, 2026, 2, o.scheduled_tip_utc, '9', '17', false, 'PICK', '9', 'home', 0.70, 0.70, 'high', o.feature_vector, o.feature_hash, o.model_id, '180dfcf50ca8fa96c2a71b7ee37abde80aacc5ff5f403783b03b4769436394f3', 'f03358e8ef81e3c1d08c06dd6527f96e9e885bff79aeb24e7eb26e87d910a25d', o.reasoning, o.generated_at, 'T-15m/v1', o.observation_id);
    insert into _proof values ('09', 'lock whose probability differs from its source observation rejected', false, 'insert succeeded');
  exception when others then
    insert into _proof values ('09', 'lock whose probability differs from its source observation rejected', sqlerrm like 'wnba_pbe: lock for game % does not match its source observation', sqlerrm);
  end;
end $t$;

-- ================================================================ locked immutability
create temp table _lock_before as select * from public.wnba_pbe_locked_predictions where prediction_id = (select v from _ids where k = 'lock1');
grant all on _lock_before to public;

do $t$
declare pid uuid := (select v from _ids where k = 'lock1');
begin
  begin
    update public.wnba_pbe_locked_predictions set selected_team_id = '17', selected_side = 'away' where prediction_id = pid;
    insert into _proof values ('10', 'locked selection update rejected', false, 'update succeeded');
  exception when others then insert into _proof values ('10', 'locked selection update rejected', sqlerrm like 'wnba_pbe:%' or sqlstate = '42501', sqlstate || ' ' || sqlerrm); end;
  begin
    update public.wnba_pbe_locked_predictions set win_probability = 0.9, p_home = 0.9 where prediction_id = pid;
    insert into _proof values ('11', 'locked probability update rejected', false, 'update succeeded');
  exception when others then insert into _proof values ('11', 'locked probability update rejected', sqlerrm like 'wnba_pbe:%' or sqlstate = '42501', sqlstate || ' ' || sqlerrm); end;
  begin
    update public.wnba_pbe_locked_predictions set reasoning = '{"supporting":["rewritten"]}' where prediction_id = pid;
    insert into _proof values ('12a', 'locked reasoning update rejected', false, 'update succeeded');
  exception when others then insert into _proof values ('12a', 'locked reasoning update rejected', sqlerrm like 'wnba_pbe:%' or sqlstate = '42501', sqlstate || ' ' || sqlerrm); end;
  begin
    update public.wnba_pbe_locked_predictions set model_id = 'pbe-wnba-challenger-proof' where prediction_id = pid;
    insert into _proof values ('12b', 'locked model version update rejected', false, 'update succeeded');
  exception when others then insert into _proof values ('12b', 'locked model version update rejected', sqlerrm like 'wnba_pbe:%' or sqlstate = '42501', sqlstate || ' ' || sqlerrm); end;
  begin
    delete from public.wnba_pbe_locked_predictions where prediction_id = pid;
    insert into _proof values ('13', 'locked deletion rejected', false, 'delete succeeded');
  exception when others then insert into _proof values ('13', 'locked deletion rejected', sqlerrm like 'wnba_pbe:%' or sqlstate = '42501', sqlstate || ' ' || sqlerrm); end;
end $t$;

-- the same attempts as the table owner (not just the least-privileged writer): triggers still refuse
reset role;
do $t$
declare pid uuid := (select v from _ids where k = 'lock1');
begin
  begin
    update public.wnba_pbe_locked_predictions set win_probability = 0.9, p_home = 0.9 where prediction_id = pid;
    insert into _proof values ('14', 'owner-role update and delete of a lock also rejected by trigger', false, 'owner update succeeded');
  exception when others then
    begin
      delete from public.wnba_pbe_locked_predictions where prediction_id = pid;
      insert into _proof values ('14', 'owner-role update and delete of a lock also rejected by trigger', false, 'owner delete succeeded');
    exception when others then
      begin
        truncate public.wnba_pbe_locked_predictions cascade;
        insert into _proof values ('14', 'owner-role update and delete of a lock also rejected by trigger', false, 'owner truncate succeeded');
      exception when others then
        insert into _proof values ('14', 'owner-role update, delete and truncate of a lock rejected by trigger', sqlerrm like 'wnba_pbe:%', sqlerrm);
      end;
    end;
  end;
end $t$;

insert into _proof select '15', 'locked row byte-identical after every rejected mutation',
  (select to_jsonb(l) from public.wnba_pbe_locked_predictions l where prediction_id = (select v from _ids where k = 'lock1')) = (select to_jsonb(b) from _lock_before b), 'to_jsonb equal';

-- ================================================================ duplicate official lock
set role service_role;
do $t$
declare o public.wnba_pbe_prediction_observations%rowtype;
begin
  select * into o from public.wnba_pbe_prediction_observations where observation_id = (select v from _ids where k = 'obs1');
  insert into public.wnba_pbe_locked_predictions (game_id, season, season_type, scheduled_tip_utc, home_team_id, away_team_id, neutral_site, call, selected_team_id, selected_side, p_home, win_probability, confidence, feature_vector, feature_hash, model_id, artifact_sha256, feature_spec_sha256, reasoning, generated_at, lock_policy, source_observation_id)
  values (o.game_id, 2026, 2, o.scheduled_tip_utc, '9', '17', false, 'PICK', '9', 'home', o.p_home, o.pick_probability, o.confidence, o.feature_vector, o.feature_hash, o.model_id, '180dfcf50ca8fa96c2a71b7ee37abde80aacc5ff5f403783b03b4769436394f3', 'f03358e8ef81e3c1d08c06dd6527f96e9e885bff79aeb24e7eb26e87d910a25d', o.reasoning, o.generated_at, 'T-15m/v1', o.observation_id);
  insert into _proof values ('16', 'duplicate official lock for the same game + contract rejected', false, 'second lock succeeded');
exception when others then
  insert into _proof values ('16', 'duplicate official lock for the same game + contract rejected', sqlstate = '23505', sqlstate || ' ' || sqlerrm);
end $t$;

-- ================================================================ grades (after tip)
reset role;
select pg_sleep(greatest(0, extract(epoch from ((select scheduled_tip_utc from _lock_before) - clock_timestamp())) + 0.5));
set role service_role;

do $t$
declare pid uuid := (select v from _ids where k = 'lock1'); g1 uuid;
begin
  begin
    insert into public.wnba_pbe_grade_revisions (prediction_id, revision, result, home_score, away_score, winner_team_id, result_reference, graded_by)
    values (pid, 1, 'loss', 80, 70, '9', '{"provider":"espn","event":"proof-game-1","status":"STATUS_FINAL"}', 'proof-grader');
    insert into _proof values ('17a', 'grade contradicting the score rejected (home 80-70, pick home, result loss)', false, 'insert succeeded');
  exception when others then insert into _proof values ('17a', 'grade contradicting the score rejected', sqlerrm like 'wnba_pbe: result % contradicts the score%', sqlerrm); end;

  insert into public.wnba_pbe_grade_revisions (prediction_id, revision, result, home_score, away_score, winner_team_id, result_reference, graded_by, graded_at)
  values (pid, 1, 'win', 80, 70, '9', '{"provider":"espn","event":"proof-game-1","status":"STATUS_FINAL"}', 'proof-grader', '2001-01-01T00:00:00Z')
  returning grade_id into g1;
  insert into _ids values ('g1', g1);
  insert into _proof values ('17', 'first grade append allowed (revision 1)', true, 'grade ' || g1);
exception when others then
  insert into _proof values ('17', 'first grade append allowed', false, sqlerrm);
end $t$;

reset role;
create temp table _g1_before as select * from public.wnba_pbe_grade_revisions where grade_id = (select v from _ids where k = 'g1');
grant all on _g1_before to public;
set role service_role;

do $t$
declare pid uuid := (select v from _ids where k = 'lock1'); g1 uuid := (select v from _ids where k = 'g1'); g2 uuid;
begin
  begin
    insert into public.wnba_pbe_grade_revisions (prediction_id, revision, result, home_score, away_score, winner_team_id, result_reference, graded_by, supersedes_grade_id)
    values (pid, 2, 'loss', 70, 80, '17', '{}', 'proof-grader', g1);
    insert into _proof values ('18a', 'correction without a reason rejected', false, 'insert succeeded');
  exception when others then insert into _proof values ('18a', 'correction without a reason rejected', sqlstate = '23514', sqlstate || ' ' || sqlerrm); end;
  begin
    insert into public.wnba_pbe_grade_revisions (prediction_id, revision, result, home_score, away_score, winner_team_id, result_reference, graded_by, supersedes_grade_id, correction_reason)
    values (pid, 3, 'loss', 70, 80, '17', '{}', 'proof-grader', g1, 'skipped revision');
    insert into _proof values ('18b', 'out-of-sequence revision rejected', false, 'insert succeeded');
  exception when others then insert into _proof values ('18b', 'out-of-sequence revision rejected', sqlerrm like 'wnba_pbe: revision%', sqlerrm); end;

  insert into public.wnba_pbe_grade_revisions (prediction_id, revision, result, home_score, away_score, winner_team_id, result_reference, graded_by, supersedes_grade_id, correction_reason)
  values (pid, 2, 'loss', 70, 80, '17', '{"provider":"espn","event":"proof-game-1","status":"STATUS_FINAL","note":"provider corrected home/away score"}', 'proof-grader', g1, 'provider score correction')
  returning grade_id into g2;
  insert into _ids values ('g2', g2);
  insert into _proof values ('18', 'correction append allowed (revision 2 supersedes revision 1 with a reason)', true, 'grade ' || g2);
exception when others then
  insert into _proof values ('18', 'correction append allowed', false, sqlerrm);
end $t$;

do $t$
begin
  begin
    update public.wnba_pbe_grade_revisions set result = 'loss' where grade_id = (select v from _ids where k = 'g1');
    insert into _proof values ('19a', 'in-place grade update rejected', false, 'update succeeded');
  exception when others then insert into _proof values ('19a', 'in-place grade update rejected', sqlerrm like 'wnba_pbe:%' or sqlstate = '42501', sqlstate || ' ' || sqlerrm); end;
  begin
    delete from public.wnba_pbe_grade_revisions where grade_id = (select v from _ids where k = 'g1');
    insert into _proof values ('19b', 'grade deletion rejected', false, 'delete succeeded');
  exception when others then insert into _proof values ('19b', 'grade deletion rejected', sqlerrm like 'wnba_pbe:%' or sqlstate = '42501', sqlstate || ' ' || sqlerrm); end;
end $t$;

reset role;
insert into _proof select '19', 'prior grade (revision 1) remains unchanged after the correction',
  (select to_jsonb(g) from public.wnba_pbe_grade_revisions g where grade_id = (select v from _ids where k = 'g1')) = (select to_jsonb(b) from _g1_before b)
  and (select result from public.wnba_pbe_grade_revisions where grade_id = (select v from _ids where k = 'g1')) = 'win',
  'revision 1 still win, byte-identical';
insert into _proof select '20', 'current grade = latest revision (view shows revision 2 loss); 2 revisions auditable',
  (select revision = 2 and result = 'loss' from public.wnba_pbe_current_grades where prediction_id = (select v from _ids where k = 'lock1'))
  and (select count(*) = 2 from public.wnba_pbe_grade_revisions where prediction_id = (select v from _ids where k = 'lock1')),
  'current revision 2 (loss) · history 2 rows';

-- ================================================================ anonymous access
do $t$
begin
  set local role anon;
  begin
    perform count(*) from public.wnba_pbe_locked_predictions;
    insert into _proof values ('21', 'anon cannot read the locked ledger or grades', false, 'anon select succeeded');
  exception when insufficient_privilege then
    begin
      perform count(*) from public.wnba_pbe_current_grades;
      insert into _proof values ('21', 'anon cannot read the locked ledger or grades', false, 'anon read the grade view');
    exception when insufficient_privilege then
      insert into _proof values ('21', 'anon cannot read the locked ledger or the grade view (permission denied)', true, sqlerrm);
    end;
  end;
end $t$;
reset role;

-- ================================================================ unrelated schemas untouched
update _fp set after_fp = pg_temp._fingerprint();
insert into _proof select '22', 'unrelated schemas untouched: catalog fingerprint of every non-wnba_pbe object identical before/after',
  before_fp = after_fp and before_rel_count = (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname not like 'pg\_temp%' and n.nspname not like 'pg\_toast%' and c.relname not like 'wnba\_pbe%'),
  'before ' || before_fp || ' · after ' || after_fp || ' · non-wnba_pbe relations ' || before_rel_count || ' → ' || (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname not like 'pg\_temp%' and n.nspname not like 'pg\_toast%' and c.relname not like 'wnba\_pbe%')
from _fp;

insert into _proof select '00', 'environment', true, version() || ' · db ' || current_database() || ' · user ' || session_user;
