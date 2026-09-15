#!/usr/bin/env node
// Verify pbe-wnba-model-v1 is exactly what its manifest says.
//   node scripts/model/verify-artifact.mjs      (exit 1 on any mismatch)

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const DIR = new URL('../../model/pbe-wnba-model-v1/', import.meta.url);
const sha256 = (s) => createHash('sha256').update(String(s).replace(/\r\n/g, '\n')).digest('hex');

export async function verifyArtifact() {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', DIR), 'utf8'));
  const results = {};
  for (const [file, expected] of Object.entries(manifest.files)) {
    const actual = sha256(await readFile(new URL(file, DIR), 'utf8'));
    results[file] = { expected, actual, ok: actual === expected };
  }
  const artifact = JSON.parse(await readFile(new URL('artifact.json', DIR), 'utf8'));
  const spec = JSON.parse(await readFile(new URL('feature_spec.json', DIR), 'utf8'));
  const receipt = JSON.parse(await readFile(new URL('validation_receipt.json', DIR), 'utf8'));
  const cross = {
    spec_order_matches_artifact: JSON.stringify(spec.features.map((f) => f.name)) === JSON.stringify(artifact.feature_order),
    receipt_artifact_hash: receipt.artifact_sha256 === manifest.files['artifact.json'],
    receipt_spec_hash: receipt.feature_spec_sha256 === manifest.files['feature_spec.json'],
    params_match: JSON.stringify(spec.params) === JSON.stringify(artifact.params),
    coefficient_count: artifact.coefficients.length === artifact.standardized_features.length && artifact.standardization.mean.length === artifact.coefficients.length
  };
  const ok = Object.values(results).every((r) => r.ok) && Object.values(cross).every(Boolean);
  return { ok, model_id: manifest.model_id, results, cross };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/model/verify-artifact.mjs')) {
  const r = await verifyArtifact();
  console.log(JSON.stringify(r, null, 1));
  if (!r.ok) process.exit(1);
}
