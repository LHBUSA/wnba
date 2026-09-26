#!/usr/bin/env node
// WinBA 1.0.0 rollback artifact: verify + restore DRY RUN. Never writes production.
//
//   node scripts/ops/winba-rollback.mjs            # dry run (default): fetch artifact read-only, verify, serve it in memory
//   node scripts/ops/winba-rollback.mjs --commands # print the exact restore commands (does not execute them)
//
// The artifact is the exact winba:v1:latest captured before wnba-ingest 1.4.0 (winba/1.0.1) was deployed, stored
// byte-for-byte in the production KV namespace (WNBA_KV, private) under ARTIFACT_KEY. The repo is public, so the
// board itself is not committed; only its fingerprint (below) is.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ARTIFACT = Object.freeze({
  key: 'ops:rollback:winba:v1:1.0.0:09c97653e5c33121',
  sha256: '09c97653e5c33121f3234f2f132c64dae276b6f4e3a8164558ab499c8ba14b0f',
  bytes: 125533,
  version: 'winba/1.0.0',
  rows: 238,
  generated_at: '2026-09-25T04:26:27.869Z',
  archive_signature: '350:401857218',
  captured_from: 'winba:v1:latest, live before wnba-ingest 1.4.0 (35e2c449) replaced 1.3.0 (b0713fbb) on 2026-09-26',
})

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const INGEST = join(ROOT, 'workers', 'wnba-ingest')

/** Verify raw artifact bytes against the recorded fingerprint. Pure; used by the tests too. */
export function verifyArtifact(buf, fp = ARTIFACT) {
  const errors = []
  const sha = createHash('sha256').update(buf).digest('hex')
  if (sha !== fp.sha256) errors.push(`sha256 ${sha} != ${fp.sha256}`)
  if (buf.length !== fp.bytes) errors.push(`bytes ${buf.length} != ${fp.bytes}`)
  let board = null
  try { board = JSON.parse(buf.toString('utf8')) } catch (e) { errors.push(`not JSON: ${e.message}`) }
  if (board) {
    if (board.version !== fp.version) errors.push(`version ${board.version} != ${fp.version}`)
    if (!Array.isArray(board.rows) || board.rows.length !== fp.rows) errors.push(`rows ${board.rows?.length} != ${fp.rows}`)
    if (board.generated_at !== fp.generated_at) errors.push(`generated_at ${board.generated_at} != ${fp.generated_at}`)
    if (board.archive_signature !== fp.archive_signature) errors.push(`archive_signature ${board.archive_signature} != ${fp.archive_signature}`)
  }
  return { ok: errors.length === 0, sha, errors, board }
}

/** Serve the artifact through the real wnba-api fetch handler with an in-memory KV (writes stay in memory). */
export async function serveInMemory(board) {
  const store = new Map([['winba:v1:latest', JSON.stringify(board)]])
  const writes = []
  const kv = {
    async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v },
    async put(k, v) { writes.push(k); store.set(k, typeof v === 'string' ? v : JSON.stringify(v)) },
    async delete(k) { writes.push(`delete:${k}`); store.delete(k) },
    async list() { return { keys: [], list_complete: true } },
  }
  const { default: api } = await import(pathToFileURL(join(ROOT, 'workers', 'wnba-api', 'src', 'index.js')).href)
  const res = await api.fetch(new Request('https://wnba-api.test/v1/stats/winba'), { WNBA_KV: kv }, { waitUntil() {}, passThroughOnException() {} })
  const body = await res.json().catch(() => null)
  return { status: res.status, body, writes }
}

export function restoreCommands(fp = ARTIFACT) {
  return [
    '# 1. Roll the ingest code back first (1.3.0 never forces a WinBA rebuild, so the board must be restored by hand):',
    '#    cd workers/wnba-ingest && npx wrangler rollback b0713fbb-7781-4a0c-8e0f-dd92396e2aec',
    '# 2. Put the exact 1.0.0 board back:',
    `cd workers/wnba-ingest && npx wrangler kv key get "${fp.key}" --binding WNBA_KV --remote > winba-1.0.0.json`,
    'node ../../scripts/ops/winba-rollback.mjs --verify-file winba-1.0.0.json   # must print VERIFIED before the put',
    'npx wrangler kv key put "winba:v1:latest" --path winba-1.0.0.json --binding WNBA_KV --remote',
    '# 3. Verify live: curl -s https://wnba-api.sales-fd3.workers.dev/v1/stats/winba | node -e "...version === winba/1.0.0, 238 rows"',
  ]
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--commands')) { console.log(restoreCommands().join('\n')); return }
  let buf
  const vf = args.indexOf('--verify-file')
  if (vf >= 0) buf = readFileSync(args[vf + 1])
  else {
    // read-only fetch of the artifact from production KV (stdout = the exact stored bytes)
    buf = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', 'kv', 'key', 'get', ARTIFACT.key, '--binding', 'WNBA_KV', '--remote'], { cwd: INGEST, stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 })
  }
  const v = verifyArtifact(buf)
  console.log(`${v.ok ? 'VERIFIED' : 'FAILED'} artifact ${ARTIFACT.key}: sha256 ${v.sha} · ${buf.length} bytes · ${v.board?.version} · ${v.board?.rows?.length} rows · generated ${v.board?.generated_at}`)
  if (!v.ok) { for (const e of v.errors) console.log(`  - ${e}`); process.exitCode = 1; return }
  if (vf >= 0) return
  const s = await serveInMemory(v.board)
  const data = s.body?.data ?? s.body
  const rows = data?.rows?.length ?? data?.players?.length
  const ok = s.status === 200 && (data?.version === ARTIFACT.version || JSON.stringify(s.body).includes(ARTIFACT.version)) && rows === ARTIFACT.rows
  console.log(`${ok ? 'PASS' : 'FAIL'} dry-run restore: wnba-api /v1/stats/winba served the artifact in memory -> HTTP ${s.status}, ${rows} rows, version ${data?.version}; in-memory writes: ${s.writes.length}; production writes: 0`)
  if (!ok) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(e => { console.error(e); process.exitCode = 1 })
