#!/usr/bin/env node
// Emit (never execute) the SQL that REGISTERS pbe-wnba-model-v1 in wnba_pbe_model_versions on tkmln as a
// champion_candidate. It never inserts a promotion: wnba_pbe_current_champion() stays unchanged, so no official
// lock can be accepted. Promotion is a separate, later owner decision (scripts/model/promotion-sql.mjs).
//
//   node scripts/model/registration-sql.mjs --registered-by "<owner approval reference>" > registration.sql
//
// Every hash is recomputed from the committed file bytes and must equal manifest.json, or the script refuses.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..');
const DIR = path.join(ROOT, 'model', 'pbe-wnba-model-v1');
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const registeredBy = arg('registered-by');
if (!registeredBy) { console.error('usage: --registered-by "<owner approval reference>"'); process.exit(2); }

const bytes = (f) => fs.readFileSync(path.join(DIR, f));
const sha = (f) => createHash('sha256').update(bytes(f)).digest('hex');
const manifest = JSON.parse(bytes('manifest.json'));
const artifact = JSON.parse(bytes('artifact.json'));
const receipt = JSON.parse(bytes('validation_receipt.json'));
for (const f of ['artifact.json', 'feature_spec.json', 'validation_receipt.json']) {
  if (sha(f) !== manifest.files[f]) { console.error(`${f}: sha256 ${sha(f)} != manifest ${manifest.files[f]}; refusing`); process.exit(1); }
}
if (receipt.artifact_sha256 !== manifest.files['artifact.json'] || receipt.feature_spec_sha256 !== manifest.files['feature_spec.json']) {
  console.error('validation receipt hashes do not match the manifest; refusing'); process.exit(1);
}

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const jsonb = (o) => `${lit(JSON.stringify(o))}::jsonb`;
const hold = receipt.holdout?.logistic_chosen?.pooled || {};
const val = receipt.validation?.logistic_chosen?.pooled || {};
const summary = {
  receipt_id: receipt.receipt_id,
  validation: { seasons: receipt.protocol?.validation_seasons, n: val.n, log_loss: val.log_loss, brier: val.brier, accuracy: val.accuracy, roc_auc: val.roc_auc, ece: val.ece },
  holdout: { seasons: receipt.protocol?.holdout_seasons, n: hold.n, log_loss: hold.log_loss, brier: hold.brier, accuracy: hold.accuracy, roc_auc: hold.roc_auc, ece: hold.ece, calibration_slope: hold.calibration_slope },
  market_benchmark_2026: 'de-vigged market log loss 0.579 vs PBE 0.591 (n=277); PBE Edge is disagreement, not proven value',
  leakage_audit_pass: receipt.leakage_audit?.pass === true
};

process.stdout.write(`-- Register (NOT promote) ${artifact.model_id} on tkmlnhmylqnttmnsnief. Generated ${new Date().toISOString()}.
-- Approval: ${registeredBy.replace(/\s+/g, ' ')}
-- The row is immutable once inserted (triggers). No wnba_pbe_model_promotions row is written.
begin;
insert into public.wnba_pbe_model_versions
  (model_id, model_type, feature_schema, artifact_sha256, feature_spec_sha256, validation_receipt_sha256, training_window, validation_summary, role_at_registration, artifact_uri)
values
  (${lit(artifact.model_id)}, ${lit(artifact.model_type)}, ${lit(artifact.feature_schema)},
   ${lit(manifest.files['artifact.json'])}, ${lit(manifest.files['feature_spec.json'])}, ${lit(manifest.files['validation_receipt.json'])},
   ${jsonb(manifest.training_window)}, ${jsonb({ ...summary, registered_by: registeredBy, promotion: 'NOT PROMOTED at registration' })}, 'champion_candidate', 'LHBUSA/wnba:model/pbe-wnba-model-v1/artifact.json');
commit;
`);
