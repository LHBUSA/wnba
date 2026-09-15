#!/usr/bin/env node
// Emit (never execute) the SQL that PROMOTES an already-registered model to champion on tkmln.
// A separate owner decision from registration. Refuses unless every precondition file exists and matches:
//   - manifest hashes recomputed from file bytes
//   - a FROZEN eligibility contract for this model (model/<id>/eligibility/eligibility_contract.json, status FROZEN)
//     whose evidence hash matches the committed study receipt
//   - an explicit --approved-by reference
//
//   node scripts/model/promotion-sql.mjs --approved-by "<owner approval reference>" > promotion.sql
//
// After promotion, wnba_pbe_current_champion() returns the model and official locks become possible; arming the
// runner (PBE_MODE=armed) is yet another separate decision.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..');
const DIR = path.join(ROOT, 'model', 'pbe-wnba-model-v1');
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const approvedBy = arg('approved-by');
const fail = (m) => { console.error(`refusing: ${m}`); process.exit(1); };
if (!approvedBy) fail('usage: --approved-by "<owner approval reference>"');

const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
for (const f of ['artifact.json', 'feature_spec.json', 'validation_receipt.json']) {
  if (sha(path.join(DIR, f)) !== manifest.files[f]) fail(`${f} does not match manifest`);
}
const contractPath = path.join(DIR, 'eligibility', 'eligibility_contract.json');
if (!fs.existsSync(contractPath)) fail('no FROZEN eligibility contract (model/pbe-wnba-model-v1/eligibility/eligibility_contract.json). Owner decision #4: eligibility must be frozen before promotion.');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
if (contract.status !== 'FROZEN') fail(`eligibility contract status is ${contract.status}, not FROZEN`);
if (contract.applies_to_model !== manifest.model_id) fail('eligibility contract is for a different model');
const receiptPath = path.join(DIR, 'eligibility', 'eligibility_study_receipt.json');
if (!fs.existsSync(receiptPath) || sha(receiptPath) !== contract.evidence?.receipt_sha256) fail('eligibility evidence hash does not match the committed study receipt');

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const evidence = {
  basis: 'owner-approved promotion of a registered champion_candidate',
  artifact_sha256: manifest.files['artifact.json'],
  feature_spec_sha256: manifest.files['feature_spec.json'],
  validation_receipt_sha256: manifest.files['validation_receipt.json'],
  eligibility_contract: { id: contract.contract_id, sha256: sha(contractPath), rule: contract.rule },
  lock_policy_note: 'Promotion does not arm the runner and does not make T-15m permanent.'
};
process.stdout.write(`-- PROMOTE ${manifest.model_id} to champion on tkmlnhmylqnttmnsnief. Generated ${new Date().toISOString()}.
-- Approval: ${approvedBy.replace(/\s+/g, ' ')}
begin;
do $$ begin
  if not exists (select 1 from public.wnba_pbe_model_versions where model_id = ${lit(manifest.model_id)} and artifact_sha256 = ${lit(manifest.files['artifact.json'])}) then
    raise exception 'model is not registered with the expected artifact hash';
  end if;
end $$;
insert into public.wnba_pbe_model_promotions (model_id, promoted_by, evidence, supersedes_model_id)
values (${lit(manifest.model_id)}, ${lit(approvedBy)}, ${lit(JSON.stringify(evidence))}::jsonb, public.wnba_pbe_current_champion());
select public.wnba_pbe_current_champion() as champion;
commit;
`);
