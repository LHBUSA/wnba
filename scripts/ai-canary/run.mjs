#!/usr/bin/env node
// WNBA offline AI canary — Sol (A-slot) vs Astra (B-slot) on frozen REAL production drafts. NEVER publishes.
//
//   node scripts/ai-canary/run.mjs --dry --drafts <drafts.json>            no API, no key: echo transport (pipeline check)
//   node scripts/ai-canary/run.mjs --drafts <drafts.json>                  real run (OPENAI_API_KEY from the environment)
//   node scripts/ai-canary/run.mjs --slugs <slug,slug> [--base <news url>] freeze drafts from the public, read-only
//                                                                          GET /v1/articles/:slug, then run
//   node scripts/ai-canary/run.mjs --freeze-only --slugs <...>             only write the frozen drafts file
// Options: --models gpt-5.6-sol,gpt-6-astra  --out <dir>  --seed <s> (reproducible A/B order; default = random)
//
// Output (default docs/evidence/ai-canary/<YYYY-MM-DD>[-dry]/): blind-review.md (VERSION A / VERSION B), raw/*.json
// (blinded), drafts.frozen.json, SEALED-model-key.json + SEALED-metrics.json (open only after scoring).
// The only network calls are: GET <base>/v1/articles/:slug (read-only, public) when --slugs is used, and — outside
// --dry — POST https://api.openai.com/v1/responses (store:false). The key is read from the environment into memory and
// is never printed, logged or written.
import fs from 'node:fs';
import path from 'node:path';
import { runCanary, DEFAULT_MODELS } from './harness.mjs';

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const BASE = String(arg('base', 'https://wnba-news.sales-fd3.workers.dev')).replace(/\/$/, '');
const DRY = flag('dry');
const models = String(arg('models', DEFAULT_MODELS.join(','))).split(',').map((x) => x.trim()).filter(Boolean);
const day = new Date().toISOString().slice(0, 10);
const out = path.resolve(arg('out', `docs/evidence/ai-canary/${day}${DRY ? '-dry' : ''}`));

async function freeze(slugs) {
  const drafts = [];
  for (const s of slugs) {
    const res = await fetch(`${BASE}/v1/articles/${encodeURIComponent(s)}`, { method: 'GET', headers: { accept: 'application/json' } });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok || !body.data?.article) { console.error(`skip ${s}: http ${res.status}`); continue; }
    drafts.push(body.data.article);
  }
  return drafts;
}

async function main() {
  let drafts;
  if (arg('drafts')) drafts = JSON.parse(fs.readFileSync(arg('drafts'), 'utf8'));
  else if (arg('slugs')) drafts = await freeze(String(arg('slugs')).split(',').map((x) => x.trim()).filter(Boolean));
  else throw new Error('pass --drafts <file.json> or --slugs <slug,...>');
  if (!Array.isArray(drafts)) drafts = drafts.drafts || [drafts];
  if (flag('freeze-only')) {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'drafts.frozen.json'), JSON.stringify(drafts, null, 2) + '\n');
    console.log(`froze ${drafts.length} drafts -> ${path.join(out, 'drafts.frozen.json')}`);
    return;
  }
  const env = { OPENAI_API_KEY: DRY ? undefined : process.env.OPENAI_API_KEY, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => /^WNBA_(AI|EDITORIAL)_/.test(k))) };
  const seed = arg('seed', null);
  const r = await runCanary({ drafts, models, dry: DRY, env, out, seed, log: (m) => console.log(m) });
  console.log(`\n${DRY ? 'DRY RUN (no API calls)' : 'LIVE RUN'} · ${r.results.length} drafts · output ${r.dir}`);
  console.log('Score blind-review.md BEFORE opening SEALED-model-key.json / SEALED-metrics.json.');
}

main().catch((e) => { console.error(String(e?.message || e).replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-…')); process.exit(1); });
