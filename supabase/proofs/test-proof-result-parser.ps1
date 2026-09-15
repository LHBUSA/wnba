# Regression test for ConvertFrom-WnbaProofError (ProofResult.ps1). Offline: reads fixtures only.
#
#   pwsh -NoProfile -File supabase/proofs/test-proof-result-parser.ps1
#
# Exits non-zero on any failure.
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ProofResult.ps1")
$fx = Join-Path $PSScriptRoot "fixtures"
$expected = Get-Content (Join-Path $fx "expected-results.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$failures = 0

function Assert-Results($name, $parsed) {
  if (-not $parsed) { Write-Host "FAIL $name : parser returned nothing"; $script:failures++; return }
  $r = $parsed.Results
  $ok = $r.Count -eq 29 -and $r.Count -eq $expected.Count
  for ($i = 0; $ok -and $i -lt $expected.Count; $i++) {
    $ok = $r[$i].step -eq $expected[$i].step -and $r[$i].pass -eq $expected[$i].pass -and $r[$i].check -eq $expected[$i].check -and $r[$i].detail -eq $expected[$i].detail
  }
  $fp = $r | Where-Object { $_.step -eq '22' }
  $ok = $ok -and $fp.detail -like '*50e13b2b9ca0d2e4977cff9c0e181637 · after 50e13b2b9ca0d2e4977cff9c0e181637*→ 335'
  $ok = $ok -and ($r | Where-Object { $_.step -eq '16' }).detail -like '*"wnba_pbe_lock_one_per_game"'
  $ok = $ok -and ($r | Where-Object { $_.step -eq '00' }).detail -like '*wnba\_pbe% `[escaped`]'
  if ($ok) { Write-Host "PASS $name ($($r.Count) rows, quotes/backslashes/unicode intact)" } else { Write-Host "FAIL $name"; $script:failures++ }
}

# 1. The Supabase Management API JSON error envelope (the shape that broke the old -replace unescaping).
$envelope = Get-Content (Join-Path $fx "supabase-error-envelope.json") -Raw -Encoding UTF8
Assert-Results "supabase json error envelope" (ConvertFrom-WnbaProofError -Raw $envelope)

# 2. Plain-text PostgreSQL message (no envelope).
Assert-Results "plain-text error message" (ConvertFrom-WnbaProofError -Raw (Get-Content (Join-Path $fx "plain-text-error.txt") -Raw -Encoding UTF8))

# 3. Trailing server context containing ']' after the array.
Assert-Results "envelope with bracketed trailing context" (ConvertFrom-WnbaProofError -Raw (Get-Content (Join-Path $fx "envelope-trailing-bracket-context.json") -Raw -Encoding UTF8))

# 4. An error that never reached the result statement must return nothing (runner then exits 1).
$none = ConvertFrom-WnbaProofError -Raw (Get-Content (Join-Path $fx "envelope-without-result.json") -Raw -Encoding UTF8)
if ($null -eq $none) { Write-Host "PASS error without proof result returns null" } else { Write-Host "FAIL error without proof result"; $failures++ }

# 5. Double-escaped envelope: the shape that produced the reported production error.
$double = Get-Content (Join-Path $fx "supabase-error-envelope-double-escaped.json") -Raw -Encoding UTF8
Assert-Results "double-escaped supabase envelope" (ConvertFrom-WnbaProofError -Raw $double)

# 6. Pin the regression: on the double-escaped body, both the old manual unescaping and a decode-envelope-once
#    parser fail with exactly the reported error, so neither may come back.
$reported = "*Invalid property identifier character: \. Path '``[0``]', line 1, position 2*"
$old = [regex]::Match($double, 'WNBA_PBE_PROOF_RESULT (\[.*\])')
$oldErr = $null
try { $null = ($old.Groups[1].Value -replace '\\"', '"' -replace '\\\\', '\') | ConvertFrom-Json -ErrorAction Stop } catch { $oldErr = $_.Exception.Message }
if ($oldErr -like $reported) { Write-Host "PASS old manual unescaping reproduces the reported error" } else { Write-Host "FAIL old parser did not reproduce the reported error: $oldErr"; $failures++ }
$once = [regex]::Match((($double | ConvertFrom-Json).message), 'WNBA_PBE_PROOF_RESULT (\[.*\])', 'Singleline')
$onceErr = $null
try { $null = $once.Groups[1].Value | ConvertFrom-Json -ErrorAction Stop } catch { $onceErr = $_.Exception.Message }
if ($onceErr -like $reported) { Write-Host "PASS decode-envelope-once alone also reproduces it (extra string-literal decode layer required)" } else { Write-Host "FAIL decode-once did not reproduce: $onceErr"; $failures++ }

if ($failures) { Write-Host "$failures failure(s)"; exit 1 }
Write-Host "parser tests: all passed"
