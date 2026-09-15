# APPLY (owner-approved 2026-09-15) supabase/migrations/20260915210000_wnba_pbe_current_grades_revoke_insert.sql
# to tkmlnhmylqnttmnsnief and prove: service_role keeps SELECT on wnba_pbe_current_grades, loses INSERT, no other
# grant on any object changes, and the non-WNBA catalog fingerprint is unchanged.
#
#   pwsh -NoProfile -File supabase/apply/apply-wnba-pbe-view-grant-revoke.ps1
$ErrorActionPreference = "Stop"
$Ref = "tkmlnhmylqnttmnsnief"
$ReviewedSha = "155624d81e79bd17ba07e7a7e011554fc6639b3fb059cdb16673cb424fa57cf2"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$path = Join-Path $root "supabase/migrations/20260915210000_wnba_pbe_current_grades_revoke_insert.sql"
$bytes = [IO.File]::ReadAllBytes($path)
$sha = ([Security.Cryptography.SHA256]::Create().ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join ""
if ($sha -ne $ReviewedSha) { throw "migration sha256 $sha != reviewed $ReviewedSha; refusing" }
$sql = [Text.Encoding]::UTF8.GetString($bytes)

$core = Get-Content (Join-Path $root "supabase/proofs/wnba_pbe_ledger_v1_proof.core.sql") -Raw -Encoding UTF8
$fpSql = [regex]::Match($core, '(?s)as \$fp\$(.*?)\$fp\$;').Groups[1].Value.Trim()
if (-not $fpSql) { throw "fingerprint query not found" }

$sig = @'
using System; using System.Runtime.InteropServices;
public class CredManWnbaRevoke {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  public static string Read(string target) { IntPtr p; if (!CredRead(target, 1, 0, out p)) return null; var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL)); var b = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, b, 0, b.Length); CredFree(p); return System.Text.Encoding.UTF8.GetString(b); }
}
'@
if (-not ([System.Management.Automation.PSTypeName]'CredManWnbaRevoke').Type) { Add-Type -TypeDefinition $sig }
$tok = [CredManWnbaRevoke]::Read("Supabase CLI:supabase")
if (-not $tok) { throw "Supabase CLI token not found" }
if ($tok.StartsWith("go-keyring-base64:")) { $tok = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($tok.Substring(18))) }
$headers = @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" }
$uri = "https://api.supabase.com/v1/projects/$Ref/database/query"
function Q([string]$q) { Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body (@{ query = $q } | ConvertTo-Json -Compress) }

# Every grant on every wnba_pbe relation, for every grantee (not just the three API roles).
$grantSql = @"
select coalesce(json_agg(g order by g), '[]'::json) as grants from (
  select c.relname || ':' || coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC') || ':' || a.privilege_type as g
  from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  where n.nspname = 'public' and c.relname like 'wnba\_pbe%' and c.relkind in ('r', 'v')
) s
"@
function Grants { $r = (Q $grantSql)[0].grants; if ($r -is [string]) { $r = $r | ConvertFrom-Json }; @($r) }

$before = Grants
$fpBefore = (Q "select ($fpSql) as fp")[0].fp
if ($before -notcontains 'wnba_pbe_current_grades:service_role:INSERT') { throw "precondition: service_role INSERT on the view is not present; nothing to revoke" }

$applyStarted = (Get-Date).ToUniversalTime().ToString("o")
$null = Q $sql
$appliedAt = (Q "select now() as t")[0].t

$after = Grants
$fpAfter = (Q "select ($fpSql) as fp")[0].fp
$removed = @($before | Where-Object { $after -notcontains $_ })
$added = @($after | Where-Object { $before -notcontains $_ })

$checks = [ordered]@{
  service_role_select_on_view_remains = $after -contains 'wnba_pbe_current_grades:service_role:SELECT'
  service_role_insert_on_view_gone = $after -notcontains 'wnba_pbe_current_grades:service_role:INSERT'
  exactly_one_grant_removed = ($removed.Count -eq 1) -and ($removed[0] -eq 'wnba_pbe_current_grades:service_role:INSERT')
  no_grant_added = $added.Count -eq 0
  non_wnba_fingerprint_unchanged = $fpBefore -eq $fpAfter
}
$checks.GetEnumerator() | ForEach-Object { "{0,-5} {1}" -f $(if ($_.Value) { 'PASS' } else { 'FAIL' }), $_.Key } | Write-Host
$failed = @($checks.GetEnumerator() | Where-Object { -not $_.Value }).Count
$receipt = [ordered]@{ ref = $Ref; migration = "supabase/migrations/20260915210000_wnba_pbe_current_grades_revoke_insert.sql"; migration_sha256 = $sha; applied_at_db = $appliedAt; apply_client_started = $applyStarted; grants_before = $before; grants_after = $after; removed = $removed; added = $added; fingerprint_before = $fpBefore; fingerprint_after = $fpAfter; checks = $checks; failed = $failed }
$receipt | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $root "docs/evidence/wnba-pbe-view-grant-revoke-tkmln.json") -Encoding UTF8
Write-Host ("APPLIED {0} · {1}/{2} checks · grants {3} -> {4} · fingerprint {5} -> {6}" -f $appliedAt, ($checks.Count - $failed), $checks.Count, $before.Count, $after.Count, $fpBefore, $fpAfter)
if ($failed) { exit 1 }
