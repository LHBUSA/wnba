#!/usr/bin/env node
// PBE WNBA model — raw ESPN harvest (resumable, polite, fail-loud).
//
//   node scripts/model/harvest.mjs scoreboards 1997 2026
//   node scripts/model/harvest.mjs summaries 1997 2026
//
// Writes gzip'd envelopes { source_url, captured_at, status, payload } to
// $WNBA_MODEL_DATA (default D:/Workers/wnba-model-data)/raw/. Raw payloads never
// enter Git. A cached file is never re-fetched unless --refresh-open is passed
// for events that were not final when captured.

import { mkdir, readFile, writeFile, readdir, access } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';

const ROOT = process.env.WNBA_MODEL_DATA || 'D:/Workers/wnba-model-data';
const SITE = 'https://site.web.api.espn.com/apis/site/v2/sports/basketball/wnba';
const CONCURRENCY = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function exists(p) { try { await access(p); return true; } catch { return false; } }

export async function readEnvelope(p) {
  return JSON.parse(gunzipSync(await readFile(p)).toString('utf8'));
}

async function fetchJson(url) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'PropBetEdge-WNBA-model-harvest/1.0', accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (res.status === 404) return { status: 404, payload: null };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      return { status: res.status, payload };
    } catch (e) {
      lastErr = e;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw new Error(`fetch failed after retries: ${url}: ${lastErr?.message}`);
}

async function pool(items, fn) {
  let i = 0; let done = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
      done++;
      if (done % 200 === 0) console.log(`  ${done}/${items.length}`);
    }
  });
  await Promise.all(workers);
}

// The ranged form (dates=YYYYMMDD-YYYYMMDD) answers HTTP 400 for historical
// WNBA seasons; the whole-year form (dates=YYYY) returns every event of the
// calendar year. Completeness is spot-checked per day in audit.mjs.
async function scoreboards(y0, y1) {
  const dir = path.join(ROOT, 'raw', 'scoreboard');
  await mkdir(dir, { recursive: true });
  const jobs = [];
  for (let y = y0; y <= y1; y++) jobs.push(y);
  await pool(jobs, async (y) => {
    const file = path.join(dir, `${y}.json.gz`);
    if (y < 2026 && await exists(file)) return;
    const url = `${SITE}/scoreboard?dates=${y}&limit=1000`;
    const { status, payload } = await fetchJson(url);
    if (status !== 200 || !Array.isArray(payload?.events)) throw new Error(`malformed scoreboard ${url} (${status})`);
    await writeFile(file, gzipSync(JSON.stringify({ source_url: url, captured_at: new Date().toISOString(), status, payload })));
  });
}

async function listEvents(y0, y1) {
  const dir = path.join(ROOT, 'raw', 'scoreboard');
  const files = (await readdir(dir)).filter((f) => {
    const y = Number(f.slice(0, 4));
    return /^\d{4}\.json\.gz$/.test(f) && y >= y0 && y <= y1;
  });
  const events = new Map();
  for (const f of files) {
    const env = await readEnvelope(path.join(dir, f));
    for (const e of env.payload?.events || []) events.set(e.id, e);
  }
  return [...events.values()];
}

async function summaries(y0, y1, { refreshOpen = false } = {}) {
  const dir = path.join(ROOT, 'raw', 'summary');
  await mkdir(dir, { recursive: true });
  const events = (await listEvents(y0, y1)).filter((e) => (e?.season?.type === 2 || e?.season?.type === 3) && e?.status?.type?.name === 'STATUS_FINAL');
  console.log(`summaries: ${events.length} completed events in ${y0}-${y1}`);
  let fetched = 0;
  await pool(events, async (e) => {
    const file = path.join(dir, `${e.id}.json.gz`);
    if (await exists(file) && !refreshOpen) return;
    const url = `${SITE}/summary?event=${e.id}`;
    const { status, payload } = await fetchJson(url);
    if (status === 200 && !payload?.header) throw new Error(`malformed summary ${url}`);
    await writeFile(file, gzipSync(JSON.stringify({ source_url: url, captured_at: new Date().toISOString(), status, payload })));
    fetched++;
  });
  console.log(`summaries fetched ${fetched}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  const [cmd, a = '1997', b = '2026'] = process.argv.slice(2);
  const y0 = Number(a); const y1 = Number(b);
  if (cmd === 'scoreboards') await scoreboards(y0, y1);
  else if (cmd === 'summaries') await summaries(y0, y1, { refreshOpen: process.argv.includes('--refresh-open') });
  else { console.error('usage: harvest.mjs scoreboards|summaries <y0> <y1>'); process.exit(2); }
}
