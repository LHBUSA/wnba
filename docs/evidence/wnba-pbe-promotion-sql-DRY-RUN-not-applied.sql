-- PROMOTE pbe-wnba-model-v1 to champion on tkmlnhmylqnttmnsnief. Generated 2026-09-15T21:32:53.597Z.
-- Approval: PROOF ONLY 2026-09-15 - NOT APPROVED, NOT APPLIED
begin;
do $$ begin
  if not exists (select 1 from public.wnba_pbe_model_versions where model_id = 'pbe-wnba-model-v1' and artifact_sha256 = '180dfcf50ca8fa96c2a71b7ee37abde80aacc5ff5f403783b03b4769436394f3') then
    raise exception 'model is not registered with the expected artifact hash';
  end if;
end $$;
insert into public.wnba_pbe_model_promotions (model_id, promoted_by, evidence, supersedes_model_id)
values ('pbe-wnba-model-v1', 'PROOF ONLY 2026-09-15 - NOT APPROVED, NOT APPLIED', '{"basis":"owner-approved promotion of a registered champion_candidate","artifact_sha256":"180dfcf50ca8fa96c2a71b7ee37abde80aacc5ff5f403783b03b4769436394f3","feature_spec_sha256":"83c36ef3394d48ef6fbb8af7dc9a7d586475efe8fd3f12ecf25076ad83c48752","validation_receipt_sha256":"bd13420633d2a73a3c50f19f5a9b7785084963222f9925db269ce09e76d325c5","eligibility_contract":{"id":"pbe-wnba-eligibility/1","sha256":"a6704a0ba7bf5abd038013b19927e577baaefe4b20d7caf1bc8d2033e9227270","rule":{"measure":"min_current_season_final_games","definition":"m = min(home_n_current, away_n_current): each team''s final, box-complete, current-season (season type 2 or 3) games visible under the frozen as-of rule (started before the prediction instant and on an earlier ET calendar date).","no_call_below":3,"reason":"INSUFFICIENT_TEAM_HISTORY","consistency":"Equals artifact.json params.min_current_games = 3 and feature_spec.json eligibility.min_current_games = 3 (fixed before holdout). The runtime refuses to start if they ever differ."}},"lock_policy_note":"Promotion does not arm the runner and does not make T-15m permanent."}'::jsonb, public.wnba_pbe_current_champion());
select public.wnba_pbe_current_champion() as champion;
commit;
