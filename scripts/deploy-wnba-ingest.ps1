$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Write-Host 'PropBetEdge WNBA - direct Cloudflare deploy: wnba-ingest' -ForegroundColor Cyan

$branch = (git branch --show-current).Trim()
if ($branch -ne 'main') {
  throw "Refusing to deploy from '$branch'. Checkout main first."
}

git fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'git fetch origin main failed.' }

$local = (git rev-parse HEAD).Trim()
$remote = (git rev-parse origin/main).Trim()
if ($local -ne $remote) {
  throw "Local main is not origin/main. Local=$local Remote=$remote. Run: git pull origin main"
}

$dirty = git status --porcelain
if ($dirty) {
  throw 'Working tree is not clean. Commit or stash local changes before production deploy.'
}

$tokenFile = Join-Path $repo '.admin-token'
if (-not (Test-Path $tokenFile)) {
  throw "Missing $tokenFile. It is required for the post-deploy PBE canary."
}
$adminToken = (Get-Content $tokenFile -Raw).Trim()
if (-not $adminToken) { throw '.admin-token is empty.' }

# Expected release markers come from the source being deployed, never from a hand-edited copy in this script.
$ingestSrc = Get-Content (Join-Path $repo 'workers/wnba-ingest/src/index.js') -Raw
$expectedVersion = [regex]::Match($ingestSrc, "const VERSION = '([^']+)'").Groups[1].Value
$expectedRelease = [regex]::Match($ingestSrc, "const PBE_RELEASE = '([^']+)'").Groups[1].Value
if (-not $expectedVersion -or -not $expectedRelease) { throw 'Could not read VERSION / PBE_RELEASE from workers/wnba-ingest/src/index.js.' }

Write-Host 'Running PBE runner/runtime + playoffs tests...' -ForegroundColor Cyan
node --test tests/pbe-runner.test.mjs tests/pbe-runtime.test.mjs tests/playoffs-normalize.test.mjs tests/playoffs-ingest.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Ingest tests failed. Refusing production deploy.' }

Write-Host "Deploying pushed main $local with Wrangler..." -ForegroundColor Green
Push-Location (Join-Path $repo 'workers/wnba-ingest')
try {
  npx wrangler@latest deploy
  if ($LASTEXITCODE -ne 0) { throw 'wnba-ingest deploy failed.' }
} finally {
  Pop-Location
}

Start-Sleep -Seconds 3

$base = 'https://wnba-ingest.sales-fd3.workers.dev'
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

$health = Invoke-RestMethod -Method Get -Uri "$base/health?verify=$stamp" -Headers @{ 'Cache-Control' = 'no-cache' }
if (-not $health.ok) { throw 'wnba-ingest /health is not ok.' }
if ($health.version -ne $expectedVersion) { throw "Unexpected deployed version: $($health.version) (expected $expectedVersion)" }
if ($health.scheduler -ne 'cloudflare-cron') { throw "Unexpected scheduler: $($health.scheduler)" }
if ($health.pbe_mode -ne 'armed') { throw "PBE is not armed in production: $($health.pbe_mode)" }
if ($health.pbe_release -ne $expectedRelease) { throw "Unexpected PBE release marker: $($health.pbe_release) (expected $expectedRelease)" }

Write-Host 'Running direct PBE canary on deployed Worker...' -ForegroundColor Cyan
$headers = @{ Authorization = "Bearer $adminToken"; 'Cache-Control' = 'no-cache' }
$run = Invoke-RestMethod -Method Post -Uri "$base/run/pbe?verify=$stamp" -Headers $headers
if (-not $run.ok) { throw 'POST /run/pbe returned ok=false.' }
if (-not $run.result.pbe.ok) { throw "PBE task failed: $($run.result.pbe.error)" }

$status = Invoke-RestMethod -Method Get -Uri "$base/status?verify=$stamp" -Headers @{ 'Cache-Control' = 'no-cache' }
if (-not $status.ok) { throw 'wnba-ingest /status is not ok.' }
if (-not $status.status.pbe) { throw 'PBE status is missing after canary.' }
if (-not $status.status.pbe.ok) { throw "PBE status reports failure: $($status.status.pbe.error)" }

Write-Host 'Running direct playoffs canary on deployed Worker...' -ForegroundColor Cyan
$po = Invoke-RestMethod -Method Post -Uri "$base/run/playoffs?verify=$stamp" -Headers $headers
if (-not $po.ok) { throw 'POST /run/playoffs returned ok=false.' }
if (-not $po.result.playoffs.ok) { throw "Playoffs task failed: $($po.result.playoffs.error)" }
Write-Host ("PLAYOFFS PASS - season {0}; status={1}; games={2}; series={3}; days={4}; missing={5}" -f $po.result.playoffs.season, $po.result.playoffs.status, $po.result.playoffs.games, $po.result.playoffs.series, $po.result.playoffs.days, $po.result.playoffs.missing_events) -ForegroundColor Green

$pbe = $status.status.pbe
Write-Host ("PBE PASS - version {0}; upcoming={1}; scored={2}; locks={3}; grades={4}; at={5}" -f $health.version, $pbe.upcoming, $pbe.scored, $pbe.locks, $pbe.grades, $pbe.at) -ForegroundColor Green
Write-Host "Direct Cloudflare deploy verified from main $local" -ForegroundColor Green
