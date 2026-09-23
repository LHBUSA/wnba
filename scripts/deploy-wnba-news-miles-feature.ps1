$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Write-Host 'PropBetEdge WNBA - direct Cloudflare deploy + Olivia Miles game analysis' -ForegroundColor Cyan

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

function Get-NewsArticleWithRetry {
  param(
    [Parameter(Mandatory = $true)][string]$Lookup,
    [int]$Attempts = 15,
    [int]$DelaySeconds = 5
  )
  $uri = "$base/v1/articles/$Lookup?verify=$stamp"
  for ($i = 1; $i -le $Attempts; $i++) {
    try {
      $res = Invoke-RestMethod -Method Get -Uri $uri -Headers @{ 'Cache-Control' = 'no-cache' }
      if ($res.ok -and $res.data.article) { return $res }
    } catch {
      $status = $null
      try { $status = [int]$_.Exception.Response.StatusCode } catch {}
      if ($status -and $status -ne 404) { throw }
      if ($i -eq $Attempts) { throw }
    }
    Write-Host "Waiting for Workers KV propagation ($i/$Attempts)..." -ForegroundColor DarkYellow
    Start-Sleep -Seconds $DelaySeconds
  }
  throw "Article lookup '$Lookup' did not become visible after $($Attempts * $DelaySeconds) seconds."
}

$health = Invoke-RestMethod -Method Get -Uri "$base/health?verify=$stamp" -Headers @{ 'Cache-Control' = 'no-cache' }
if (-not $health.ok) { throw 'wnba-news /health is not ok after deploy.' }
if ($health.service -ne 'wnba-news') { throw "Unexpected service: $($health.service)" }

Write-Host 'Publishing Olivia Miles natural game analysis from live source records...' -ForegroundColor Cyan
$run = Invoke-RestMethod -Method Post -Uri "$base/run?commission=miles-winba-absence-stress-test&commission_force=1&verify=$stamp" -Headers $headers
if (-not $run.ok) { throw 'Commission trigger returned ok=false.' }

$commission = $run.result.commissioned
if (-not $commission) { throw 'Commission response is missing.' }
if ($commission.status -notin @('published', 'already_published', 'regenerated')) {
  $detail = $commission | ConvertTo-Json -Depth 8 -Compress
  throw "Commission refused publication: $detail"
}

$id = $commission.id
$slug = $commission.slug
if (-not $slug -and $commission.article) { $slug = $commission.article.slug }
if (-not $id) { throw 'Published commission did not return an article id.' }
if (-not $slug) { throw 'Published commission did not return a slug.' }

# Workers KV is eventually consistent across edge locations. Verify the article
# by direct id first, then wait for the slug/index lookup to become visible.
$article = Get-NewsArticleWithRetry -Lookup $id
$slugArticle = Get-NewsArticleWithRetry -Lookup $slug
if ($slugArticle.data.article.id -ne $article.data.article.id) {
  throw "Slug and id resolved to different articles. id=$id slug=$slug"
}
if ($article.data.article.commission.key -ne 'miles-winba-absence-stress-test') {
  throw 'Resolved article is not the Olivia Miles game-analysis commission.'
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
if ($article.data.article.headline -notmatch '^Without Olivia Miles') {
  throw "Refusing success: headline is not the natural game-analysis version: $($article.data.article.headline)"
}
if ($article.data.article.category -ne 'Game Analysis' -or $article.data.article.series -ne 'Game Analysis') {
  throw 'Refusing success: article is not presented as Game Analysis.'
}
if ($article.data.article.commission.presentation -ne 'natural_news') {
  throw 'Refusing success: article does not carry natural_news presentation.'
}
$readerCopy = @($article.data.article.headline, $article.data.article.deck) + @($article.data.article.body)
$readerText = $readerCopy -join ' '
if ($readerText -match 'stress test|case study|validation|counterfactual|causal estimate|canonical metric') {
  throw 'Refusing success: reader-facing copy still contains lab-report framing.'
}

Write-Host 'Running full commissioned-feature live canary...' -ForegroundColor Cyan
node scripts/canary-commission.mjs
if ($LASTEXITCODE -ne 0) { throw 'Live commissioned-feature canary failed.' }

Write-Host ("PUBLISHED - https://wnba.propbetedge.ai/news/{0}" -f $slug) -ForegroundColor Green
Write-Host "wnba-news deployed and verified from main $local" -ForegroundColor Green
