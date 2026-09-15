# REGISTER (owner-approved 2026-09-15, do NOT promote) pbe-wnba-model-v1 in wnba_pbe_model_versions on tkmln.
#
#   pwsh -NoProfile -File supabase/apply/register-wnba-model-v1.ps1
#
# SQL comes from scripts/model/registration-sql.mjs (hashes recomputed from file bytes; no promotion statement).
# Verifies: exactly one model_versions row with the manifest hashes, ZERO promotion rows, current champion NULL,
# non-WNBA catalog fingerprint unchanged. Writes docs/evidence/wnba-pbe-model-v1-registration-tkmln.json.
$ErrorActionPreference = "Stop"
$Ref = "tkmlnhmylqnttmnsnief"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$approval = "owner approval 2026-09-15: register pbe-wnba-model-v1, do not promote"
$sql = (node (Join-Path $root "scripts/model/registration-sql.mjs") --registered-by $approval) -join "`n"
if ($LASTEXITCODE -ne 0) { throw "registration-sql.mjs refused" }
if ($sql -match "(?i)insert\s+into\s+public\.wnba_pbe_model_promotions") { throw "registration SQL inserts a promotion; refusing" }
$manifest = Get-Content (Join-Path $root "model/pbe-wnba-model-v1/manifest.json") -Raw | ConvertFrom-Json

$core = Get-Content (Join-Path $root "supabase/proofs/wnba_pbe_ledger_v1_proof.core.sql") -Raw -Encoding UTF8
$fpSql = [regex]::Match($core, '(?s)as \$fp\$(.*?)\$fp\$;').Groups[1].Value.Trim()

$sig = @'
using System; using System.Runtime.InteropServices;
public class CredManWnbaRegister {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  public static string Read(string target) { IntPtr p; if (!CredRead(target, 1, 0, out p)) return null; var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL)); var b = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, b, 0, b.Length); CredFree(p); return System.Text.Encoding.UTF8.GetString(b); }
}
'@
if (-not ([System.Management.Automation.PSTypeName]'CredManWnbaRegister').Type) { Add-Type -TypeDefinition $sig }
$tok = [CredManWnbaRegister]::Read("Supabase CLI:supabase")
if ($tok.StartsWith("go-keyring-base64:")) { $tok = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($tok.Substring(18))) }
$headers = @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" }
$uri = "https://api.supabase.com/v1/projects/$Ref/database/query"
function Q([string]$q) { Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body (@{ query = $q } | ConvertTo-Json -Compress) }

$state = "select (select count(*)::int from public.wnba_pbe_model_versions) as versions, (select count(*)::int from public.wnba_pbe_model_promotions) as promotions, public.wnba_pbe_current_champion() as champion"
$pre = (Q $state)[0]
if ($pre.versions -ne 0 -or $pre.promotions -ne 0) { throw "precondition: registry not empty (versions $($pre.versions), promotions $($pre.promotions))" }
$fpBefore = (Q "select ($fpSql) as fp")[0].fp

$null = Q $sql

$post = (Q $state)[0]
$row = (Q "select model_id, model_type, feature_schema, artifact_sha256, feature_spec_sha256, validation_receipt_sha256, role_at_registration, registered_at, training_window, validation_summary from public.wnba_pbe_model_versions where model_id = 'pbe-wnba-model-v1'")[0]
$fpAfter = (Q "select ($fpSql) as fp")[0].fp
$checks = [ordered]@{
  one_version_row = $post.versions -eq 1
  hashes_match_manifest = ($row.artifact_sha256 -eq $manifest.files.'artifact.json') -and ($row.feature_spec_sha256 -eq $manifest.files.'feature_spec.json') -and ($row.validation_receipt_sha256 -eq $manifest.files.'validation_receipt.json')
  role_champion_candidate = $row.role_at_registration -eq 'champion_candidate'
  zero_promotions = $post.promotions -eq 0
  current_champion_null = [string]::IsNullOrEmpty([string]$post.champion)
  non_wnba_fingerprint_unchanged = $fpBefore -eq $fpAfter
}
$checks.GetEnumerator() | ForEach-Object { "{0,-5} {1}" -f $(if ($_.Value) { 'PASS' } else { 'FAIL' }), $_.Key } | Write-Host
$failed = @($checks.GetEnumerator() | Where-Object { -not $_.Value }).Count
$receipt = [ordered]@{ ref = $Ref; approval = $approval; registered = $row; state_before = $pre; state_after = $post; fingerprint_before = $fpBefore; fingerprint_after = $fpAfter; checks = $checks; failed = $failed }
$receipt | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $root "docs/evidence/wnba-pbe-model-v1-registration-tkmln.json") -Encoding UTF8
Write-Host ("REGISTERED {0} at {1} · {2}/{3} checks · promotions {4} · champion '{5}'" -f $row.model_id, $row.registered_at, ($checks.Count - $failed), $checks.Count, $post.promotions, $post.champion)
if ($failed) { exit 1 }
