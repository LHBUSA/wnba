# Run the Women's Basketball History rollback proof against Supabase tkmlnhmylqnttmnsnief.
# NEVER applies anything: the generated SQL raises WBH_PROOF_RESULT before ROLLBACK, forcing the
# server transaction to abort even if a client mishandles trailing statements.
$ErrorActionPreference = 'Stop'
$Ref = 'tkmlnhmylqnttmnsnief'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

node (Join-Path $PSScriptRoot 'build-wbh-proof.mjs') remote | Out-Null
$sqlPath = Join-Path $PSScriptRoot 'wbh.proof.remote.sql'
$sql = Get-Content $sqlPath -Raw -Encoding UTF8
if ($sql -notmatch "raise exception 'WBH_PROOF_RESULT") { throw 'wbh.proof.remote.sql is missing its abort statement; refusing to send' }
if ($sql -match '(?im)^\s*commit\s*;') { throw 'wbh.proof.remote.sql contains COMMIT; refusing to send' }

$sig = @'
using System; using System.Runtime.InteropServices;
public class CredManWbhProof {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  public static string Read(string target) { IntPtr p; if (!CredRead(target, 1, 0, out p)) return null; var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL)); var b = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, b, 0, b.Length); CredFree(p); return System.Text.Encoding.UTF8.GetString(b); }
}
'@
if (-not ([System.Management.Automation.PSTypeName]'CredManWbhProof').Type) { Add-Type -TypeDefinition $sig }
$tok = [CredManWbhProof]::Read('Supabase CLI:supabase')
if (-not $tok) { throw 'Supabase CLI token not found in Credential Manager. Run supabase login first.' }
if ($tok.StartsWith('go-keyring-base64:')) { $tok = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($tok.Substring(18))) }
$headers = @{ Authorization = "Bearer $tok"; 'Content-Type' = 'application/json' }
$uri = "https://api.supabase.com/v1/projects/$Ref/database/query"

function New-SupabaseQueryPayload {
  param([Parameter(Mandatory = $true)][string]$Sql)
  $payload = ConvertTo-Json -InputObject ([pscustomobject]@{ query = [string]$Sql }) -Depth 3 -Compress
  # Fail locally if PowerShell ever serializes query as anything except a JSON string.
  $roundTrip = $payload | ConvertFrom-Json -ErrorAction Stop
  if ($roundTrip.query -isnot [string]) {
    throw "Supabase payload guard failed: query serialized as $($roundTrip.query.GetType().FullName), expected System.String"
  }
  return $payload
}

function Invoke-SupabaseQuery {
  param([Parameter(Mandatory = $true)][string]$Sql)
  $payload = New-SupabaseQueryPayload -Sql $Sql
  # Windows PowerShell 5.1 can coerce JSON request bodies in surprising ways. Sending explicit UTF-8
  # bytes prevents the Management API's `query` field from arriving as an object.
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/json' -Body $bytes
}

$raw = $null
try {
  $r = Invoke-SupabaseQuery -Sql ([string]$sql)
  throw "proof query returned without aborting - unexpected: $($r | ConvertTo-Json -Depth 4 -Compress)"
} catch {
  $raw = $_.ErrorDetails.Message
  if (-not $raw) { throw }
}

function ConvertFrom-WbhArray([string]$candidate) {
  $c = $candidate
  while ($true) {
    try {
      $parsed = $c | ConvertFrom-Json -ErrorAction Stop
      if ($parsed -is [string]) { return $null }
      return , @($parsed)
    } catch {
      $cut = $c.LastIndexOf(']', [Math]::Max(0, $c.Length - 2))
      if ($cut -lt 1) { return $null }
      $c = $c.Substring(0, $cut + 1)
    }
  }
}

$message = $raw
try {
  $err = $raw | ConvertFrom-Json -ErrorAction Stop
  if ($err -and $err.PSObject.Properties['message'] -and $err.message) { $message = [string]$err.message }
} catch {}
$m = [regex]::Match($message, 'WBH_PROOF_RESULT (\[.*\])', [System.Text.RegularExpressions.RegexOptions]::Singleline)
if (-not $m.Success) { Write-Host 'Proof did not reach its result statement. Server said:'; Write-Host $raw; exit 1 }
$candidate = $m.Groups[1].Value
$results = $null
for ($layer=0; $layer -le 3 -and $null -eq $results; $layer++) {
  $results = ConvertFrom-WbhArray $candidate
  if ($null -ne $results) { break }
  if ($candidate -notmatch '\\"') { break }
  try { $candidate = ('"' + $candidate + '"') | ConvertFrom-Json -ErrorAction Stop } catch { break }
}
if ($null -eq $results) { throw 'WBH_PROOF_RESULT was present but could not be decoded.' }

$results | Format-Table step, pass, check, detail -AutoSize -Wrap
$afterSql = "select (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'wbh\\_%') as wbh_relations, (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'wbh\\_%') as wbh_functions"
$after = Invoke-SupabaseQuery -Sql $afterSql
$passed = @($results | Where-Object { $_.pass }).Count
Write-Host ("PROOF {0}/{1} passed - wbh relations after rollback: {2}; functions: {3}" -f $passed, $results.Count, $after[0].wbh_relations, $after[0].wbh_functions)

$receipt = [ordered]@{ ref=$Ref; at=(Get-Date).ToUniversalTime().ToString('o'); passed=$passed; total=$results.Count; relations_after=$after[0].wbh_relations; functions_after=$after[0].wbh_functions; results=$results }
$receiptPath = Join-Path $root 'docs/evidence/wbh-history-foundation-v1-proof-tkmln.json'
$receipt | ConvertTo-Json -Depth 8 | Set-Content $receiptPath -Encoding UTF8
Write-Host "Receipt: $receiptPath"
if ($passed -ne $results.Count -or $after[0].wbh_relations -ne 0 -or $after[0].wbh_functions -ne 0) { exit 1 }
