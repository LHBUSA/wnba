# WinBA 1.0.0 rollback artifact (durable)

The exact `winba:v1:latest` board served before WinBA 1.0.1 was promoted, preserved byte-for-byte. The repo is
public, so the board is **not** committed; it lives in the private production KV namespace, and only its
fingerprint is recorded here.

| Field | Value |
|---|---|
| Location | Cloudflare KV `WNBA_KV` (id `c3249a8e3552438da38c6cad0d54e172`), key `ops:rollback:winba:v1:1.0.0:09c97653e5c33121` (key metadata repeats this fingerprint) |
| sha256 | `09c97653e5c33121f3234f2f132c64dae276b6f4e3a8164558ab499c8ba14b0f` |
| Bytes | 125,533 |
| Version | `winba/1.0.0` |
| Rows | 238 |
| generated_at | `2026-09-25T04:26:27.869Z` |
| Archive signature | `350:401857218` |
| Source | `winba:v1:latest` read on 2026-09-26 while wnba-ingest **1.3.0 (b0713fbb)** was live, immediately before 1.4.0 (35e2c449) was deployed |
| Local copy | `D:\Workers\deploy\wnba-rollback-20260926\winba_v1_latest_1.0.0.json` (same sha256; not authoritative) |

No key in the running code enumerates the `ops:` prefix, so the artifact is inert to production.

## Verify (read-only, safe any time)

```powershell
node scripts/ops/winba-rollback.mjs
```

Fetches the artifact read-only, checks sha256 / bytes / version / rows / generated_at / signature, then serves it
through the real wnba-api handler (`/v1/stats/winba`) with an in-memory KV. Expected: `VERIFIED` then `PASS dry-run
restore ... production writes: 0`.

## Restore (only on an owner decision to roll WinBA back to 1.0.0)

`node scripts/ops/winba-rollback.mjs --commands` prints the exact sequence:

1. `cd workers/wnba-ingest && npx wrangler rollback b0713fbb-7781-4a0c-8e0f-dd92396e2aec` (1.3.0 never forces a
   WinBA rebuild, so the board must be restored explicitly).
2. `npx wrangler kv key get "ops:rollback:winba:v1:1.0.0:09c97653e5c33121" --binding WNBA_KV --remote > winba-1.0.0.json`
3. `node ../../scripts/ops/winba-rollback.mjs --verify-file winba-1.0.0.json` — must print `VERIFIED`.
4. `npx wrangler kv key put "winba:v1:latest" --path winba-1.0.0.json --binding WNBA_KV --remote`
5. Verify live: `/v1/stats/winba` reports `winba/1.0.0` with 238 rows.
