param(
  [switch]$SkipFetch
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Write-Host 'PropBetEdge WNBA - international history production deploy' -ForegroundColor Cyan

$branch = (git branch --show-current).Trim()
if ($branch -ne 'main') {
  throw "Refusing to deploy from '$branch'. Checkout main first."
}

if (-not $SkipFetch) {
  git fetch origin main
  if ($LASTEXITCODE -ne 0) { throw 'git fetch origin main failed.' }
}

$local = (git rev-parse HEAD).Trim()
$remote = (git rev-parse origin/main).Trim()
if ($local -ne $remote) {
  throw "Local main is not origin/main. Local=$local Remote=$remote. Run: git pull origin main"
}

$dirty = git status --porcelain
if ($dirty) {
  throw 'Working tree is not clean. Commit/stash local changes before production deploy.'
}

Write-Host "Deploying pushed main $local" -ForegroundColor Green

Push-Location (Join-Path $repo 'workers/wnba-international')
try {
  npx wrangler@latest deploy
  if ($LASTEXITCODE -ne 0) { throw 'wnba-international deploy failed.' }
} finally {
  Pop-Location
}

Push-Location (Join-Path $repo 'workers/wnba-web')
try {
  npx wrangler@latest deploy
  if ($LASTEXITCODE -ne 0) { throw 'wnba-web deploy failed.' }
} finally {
  Pop-Location
}

Write-Host 'Workers deployed. Verifying public production...' -ForegroundColor Cyan
Start-Sleep -Seconds 3

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$headers = @{ 'Cache-Control' = 'no-cache' }
$pageUrl = "https://wnba.propbetedge.ai/international/olympics-2024?verify=$stamp"
$page = Invoke-WebRequest -UseBasicParsing -Headers $headers -Uri $pageUrl
$html = $page.Content

$checks = @(
  @{ Name = 'archive body'; Pass = $html -match 'Gold medal game' -and $html -match 'United States' },
  @{ Name = 'indexable robots'; Pass = $html -match 'name="robots" content="index, follow' },
  @{ Name = 'completed-event schema'; Pass = $html -match 'EventCompleted' },
  @{ Name = 'old placeholder removed'; Pass = $html -notmatch 'Structured coverage for this competition is not available yet' -and $html -notmatch 'coverage coming' },
  @{ Name = 'historical publishing worker'; Pass = [string]$page.Headers['x-pbe-render'] -match 'intl-history' }
)

$failed = @($checks | Where-Object { -not $_.Pass })
foreach ($check in $checks) {
  $mark = if ($check.Pass) { 'PASS' } else { 'FAIL' }
  Write-Host ("{0}: {1}" -f $mark, $check.Name) -ForegroundColor $(if ($check.Pass) { 'Green' } else { 'Red' })
}

$sitemap = (Invoke-WebRequest -UseBasicParsing -Headers $headers -Uri "https://wnba.propbetedge.ai/sitemap.xml?verify=$stamp").Content
$archiveSlugs = @('olympics-2024', 'eurobasket-2025', 'americup-2025', 'asia-cup-2025', 'afrobasket-2025')
foreach ($slug in $archiveSlugs) {
  $ok = $sitemap -match [regex]::Escape("https://wnba.propbetedge.ai/international/$slug")
  Write-Host ("{0}: sitemap {1}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $slug) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
  if (-not $ok) { $failed += @{ Name = "sitemap $slug"; Pass = $false } }
}

if ($failed.Count) {
  throw "Production verification failed: $($failed.Count) check(s). Do not call the rollout complete."
}

Write-Host "PRODUCTION PASS - historical international archive is live from main $local" -ForegroundColor Green
