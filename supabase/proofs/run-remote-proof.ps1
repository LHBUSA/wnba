# Run the WNBA PBE ledger rollback proof against Supabase tkmlnhmylqnttmnsnief. NEVER applies anything.
#
#   pwsh -NoProfile -File supabase/proofs/run-remote-proof.ps1
#
# The SQL sent is supabase/proofs/proof.remote.sql (built fresh from the migration + proof body). Its final
# statement raises WNBA_PBE_PROOF_RESULT <json>, which aborts the transaction on the server, so no object or
# row can persist no matter how the endpoint treats the trailing ROLLBACK. The script then confirms from a
# separate read-only query that zero wnba_pbe_* relations exist.
$ErrorActionPreference = "Stop"
$Ref = "tkmlnhmylqnttmnsnief"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

node (Join-Path $PSScriptRoot "build-proof.mjs") remote | Out-Null
$sql = Get-Content (Join-Path $PSScriptRoot "proof.remote.sql") -Raw -Encoding UTF8
if ($sql -notmatch "raise exception 'WNBA_PBE_PROOF_RESULT") { throw "proof.remote.sql is missing its abort statement; refusing to send" }
if ($sql -match "(?im)^\s*commit\s*;") { throw "proof.remote.sql contains COMMIT; refusing to send" }

$sig = @'
using System; using System.Runtime.InteropServices;
public class CredManWnbaProof {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  public static string Read(string target) { IntPtr p; if (!CredRead(target, 1, 0, out p)) return null; var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL)); var b = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, b, 0, b.Length); CredFree(p); return System.Text.Encoding.UTF8.GetString(b); }
}
'@
if (-not ([System.Management.Automation.PSTypeName]'CredManWnbaProof').Type) { Add-Type -TypeDefinition $sig }
$tok = [CredManWnbaProof]::Read("Supabase CLI:supabase")
if (-not $tok) { throw "Supabase CLI token not found in Credential Manager" }
if ($tok.StartsWith("go-keyring-base64:")) { $tok = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($tok.Substring(18))) }
$headers = @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" }
$uri = "https://api.supabase.com/v1/projects/$Ref/database/query"

$raw = $null
try {
  $r = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body (@{ query = $sql } | ConvertTo-Json -Compress)
  throw "proof query returned without aborting — result unexpected: $($r | ConvertTo-Json -Depth 4 -Compress)"
} catch {
  $raw = $_.ErrorDetails.Message
  if (-not $raw) { throw }
}
$m = [regex]::Match($raw, 'WNBA_PBE_PROOF_RESULT (\[.*\])')
if (-not $m.Success) { Write-Host "Proof did not reach its result statement. Server said:"; Write-Host $raw; exit 1 }
$json = $m.Groups[1].Value -replace '\\"', '"' -replace '\\\\', '\'
$results = $json | ConvertFrom-Json
$results | Format-Table step, pass, check, detail -AutoSize -Wrap

$after = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body (@{ query = "select count(*)::int as wnba_pbe_relations from pg_class where relname like 'wnba\_pbe%'" } | ConvertTo-Json -Compress)
$passed = @($results | Where-Object { $_.pass }).Count
Write-Host ("PROOF {0}/{1} passed · wnba_pbe relations on {2} after rollback: {3}" -f $passed, $results.Count, $Ref, $after[0].wnba_pbe_relations)
$receipt = [ordered]@{ ref = $Ref; at = (Get-Date).ToUniversalTime().ToString("o"); passed = $passed; total = $results.Count; relations_after = $after[0].wnba_pbe_relations; results = $results }
$receipt | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $root "docs/evidence/wnba-pbe-ledger-v1-proof-tkmln.json") -Encoding UTF8
if ($passed -ne $results.Count -or $after[0].wnba_pbe_relations -ne 0) { exit 1 }
