$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Write-Host 'PropBetEdge WNBA - direct Cloudflare deploy + Olivia Miles completed-loss feature' -ForegroundColor Cyan

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
  throw "Missing $tokenFile. It is required to trigger the commissioned feature after deploy."
}
$adminToken = (Get-Content $tokenFile -Raw).Trim()
if (-not $adminToken) { throw '.admin-token is empty.' }

Write-Host 'Running commissioned-feature regression tests...' -ForegroundColor Cyan
node --test tests/commission.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Commission tests failed. Refusing production deploy.' }

Write-Host 'Syncing local admin token to the wnba-news Cloudflare secret...' -ForegroundColor Cyan
Push-Location (Join-Path $repo 'workers/wnba-news')
try {
  $adminToken | npx wrangler@latest secret put ADMIN_TOKEN
  if ($LASTEXITCODE -ne 0) { throw 'Failed to sync ADMIN_TOKEN to wnba-news.' }

  Write-Host "Deploying pushed main $local to wnba-news with Wrangler..." -ForegroundColor Green
  npx wrangler@latest deploy
  if ($LASTEXITCODE -ne 0) { throw 'wnba-news deploy failed.' }
} finally {
  Pop-Location
}

Start-Sleep -Seconds 3

$base = 'https://wnba-news.sales-fd3.workers.dev'
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$headers = @{ Authorization = "Bearer $adminToken"; 'Cache-Control' = 'no-cache' }

$health = Invoke-RestMethod -Method Get -Uri "$base/health?verify=$stamp" -Headers @{ 'Cache-Control' = 'no-cache' }
if (-not $health.ok) { throw 'wnba-news /health is not ok after deploy.' }
if ($health.service -ne 'wnba-news') { throw "Unexpected service: $($health.service)" }

Write-Host 'Running Olivia Miles completed-game WinBA stress-test commission against live source records...' -ForegroundColor Cyan
$run = Invoke-RestMethod -Method Post -Uri "$base/run?commission=miles-winba-absence-stress-test&commission_force=1&verify=$stamp" -Headers $headers
if (-not $run.ok) { throw 'Commission trigger returned ok=false.' }

$commission = $run.result.commissioned
if (-not $commission) { throw 'Commission response is missing.' }
if ($commission.status -notin @('published', 'already_published', 'regenerated')) {
  $detail = $commission | ConvertTo-Json -Depth 8 -Compress
  throw "Commission refused publication: $detail"
}

$slug = $commission.slug
if (-not $slug -and $commission.article) { $slug = $commission.article.slug }
if (-not $slug) { throw 'Published commission did not return a slug.' }

$article = Invoke-RestMethod -Method Get -Uri "$base/v1/articles/$slug?verify=$stamp" -Headers @{ 'Cache-Control' = 'no-cache' }
if (-not $article.ok) { throw 'Published article did not resolve from wnba-news.' }
if ($article.data.article.commission.key -ne 'miles-winba-absence-stress-test') {
  throw 'Resolved article is not the Olivia Miles stress-test commission.'
}
if ($article.data.article.winba_reference.rank -ne 1) {
  throw "Refusing success: published WinBA reference rank is $($article.data.article.winba_reference.rank), expected 1."
}
if ($article.data.article.context.game.halftime.margin -ge 0) {
  throw 'Refusing success: stored halftime context does not show Minnesota trailing.'
}
if ($article.data.article.context.game.final.margin -ge 0) {
  throw 'Refusing success: stored final context does not show a Minnesota loss.'
}
if ($article.data.article.context.game.final.subject_team_score -ne 77 -or $article.data.article.context.game.final.opponent_score -ne 96) {
  throw "Refusing success: unexpected final score. Minnesota=$($article.data.article.context.game.final.subject_team_score) Opponent=$($article.data.article.context.game.final.opponent_score)"
}
if ($article.data.article.headline -notmatch 'Lost 96') {
  throw 'Refusing success: published headline is not the completed-loss feature.'
}

Write-Host 'Running full commissioned-feature live canary...' -ForegroundColor Cyan
node scripts/canary-commission.mjs
if ($LASTEXITCODE -ne 0) { throw 'Live commissioned-feature canary failed.' }

Write-Host ("PUBLISHED - https://wnba.propbetedge.ai/news/{0}" -f $slug) -ForegroundColor Green
Write-Host "wnba-news deployed and verified from main $local" -ForegroundColor Green
