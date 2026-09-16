# Apply the proven Women's Basketball History foundation to Supabase tkmlnhmylqnttmnsnief,
# then verify it in production. Safe to rerun from a clean working copy: both migrations are idempotent.
#
#   powershell -ExecutionPolicy Bypass -File supabase/apply/apply-wbh-history-foundation-v1.ps1
#
# The migration sources were proven 37/37 against the target with zero wbh_* objects left after rollback.
# This runner pins the reviewed Git blobs from commit 15f76b8b3aa6e18fc1d5a622c2eb4b4df228b29a,
# refuses modified migration files, applies provenance then core, and verifies the live catalog afterward.
$ErrorActionPreference = "Stop"
$Ref = "tkmlnhmylqnttmnsnief"
$ReviewedCommit = "15f76b8b3aa6e18fc1d5a622c2eb4b4df228b29a"
$ProvPath = "supabase/migrations/20260916100000_wbh_provenance_v1.sql"
$CorePath = "supabase/migrations/20260916100100_wbh_core_v1.sql"
$ProvBlob = "c593911f6585ec536e228499b769d8fc0a366998"
$CoreBlob = "7b47fc7fac6cbf8195b537f0253888c51fd82203"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

Push-Location $root
try {
  $dirty = @(git status --porcelain -- $ProvPath $CorePath)
  if ($LASTEXITCODE -ne 0) { throw "git status failed" }
  if ($dirty.Count -gt 0) { throw "WBH migration files have local modifications; refusing to apply" }

  $provHead = (git rev-parse "HEAD:$ProvPath").Trim()
  $coreHead = (git rev-parse "HEAD:$CorePath").Trim()
  if ($provHead -ne $ProvBlob) { throw "provenance migration blob $provHead != reviewed $ProvBlob" }
  if ($coreHead -ne $CoreBlob) { throw "core migration blob $coreHead != reviewed $CoreBlob" }

  $provSql = [string][IO.File]::ReadAllText((Join-Path $root $ProvPath), [Text.Encoding]::UTF8)
  $coreSql = [string][IO.File]::ReadAllText((Join-Path $root $CorePath), [Text.Encoding]::UTF8)
  if (-not $provSql.Contains("commit;")) { throw "provenance migration missing COMMIT" }
  if (-not $coreSql.Contains("commit;")) { throw "core migration missing COMMIT" }

  $sig = @'
using System; using System.Runtime.InteropServices;
public class CredManWbhApply {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  public static string Read(string target) { IntPtr p; if (!CredRead(target, 1, 0, out p)) return null; var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL)); var b = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, b, 0, b.Length); CredFree(p); return System.Text.Encoding.UTF8.GetString(b); }
}
'@
  if (-not ([System.Management.Automation.PSTypeName]'CredManWbhApply').Type) { Add-Type -TypeDefinition $sig }
  $tok = [CredManWbhApply]::Read("Supabase CLI:supabase")
  if (-not $tok) { throw "Supabase CLI token not found in Credential Manager" }
  if ($tok.StartsWith("go-keyring-base64:")) { $tok = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($tok.Substring(18))) }
  $headers = @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" }
  $uri = "https://api.supabase.com/v1/projects/$Ref/database/query"

  function Q([string]$sql) {
    if ([string]::IsNullOrWhiteSpace($sql)) { throw "refusing empty SQL" }
    $json = @{ query = [string]$sql } | ConvertTo-Json -Compress
    $roundTrip = $json | ConvertFrom-Json
    if ($roundTrip.query -isnot [string]) { throw "query JSON did not serialize as a string" }
    $body = [Text.Encoding]::UTF8.GetBytes($json)
    Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body
  }

  $pre = Q @"
select
  version() as version,
  now() as db_now,
  (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'wbh\_%') as wbh_tables,
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'wbh\_%') as wbh_functions,
  (select count(*)::int from pg_class where relname like 'wnba\_pbe%') as pbe_relations
"@
$pre = $pre[0]
Write-Host ("PRE  wbh tables={0} functions={1} pbe={2}" -f $pre.wbh_tables, $pre.wbh_functions, $pre.pbe_relations)

  # Only the clean state, the known provenance-only state, or the already-complete state is acceptable.
  $knownState = (($pre.wbh_tables -eq 0 -and $pre.wbh_functions -eq 0) -or
                 ($pre.wbh_tables -eq 6 -and $pre.wbh_functions -ge 10) -or
                 ($pre.wbh_tables -eq 38 -and $pre.wbh_functions -eq 15))
  if (-not $knownState) {
    throw "unexpected pre-existing WBH state ($($pre.wbh_tables) tables, $($pre.wbh_functions) functions); refusing to guess"
  }
  if ([int]$pre.pbe_relations -ne 22) { throw "frozen WNBA PBE relation count changed from expected 22" }

  # Apply both reviewed migrations. They are explicitly idempotent; rerunning provenance is safe if a prior
  # attempt completed it before core was applied.
  Write-Host "Applying WBH provenance..."
  $null = Q $provSql
  Write-Host "Applying WBH canonical core..."
  $null = Q $coreSql

  $post = Q @"
select json_build_object(
  'db_now', now(),
  'tables', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'wbh\_%'),
  'views', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v' and c.relname like 'wbh\_%'),
  'functions', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'wbh\_%'),
  'policies', (select count(*) from pg_policies where tablename like 'wbh\_%'),
  'anon_auth_grants', (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name like 'wbh\_%' and grantee in ('anon','authenticated','PUBLIC')),
  'anon_auth_fn_exec', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join (values ('anon'),('authenticated')) r(role) where n.nspname='public' and p.proname like 'wbh\_%' and has_function_privilege(r.role, p.oid, 'execute')),
  'sources', (select count(*) from public.wbh_sources),
  'espn_state', (select rights_state from public.wbh_sources where source_id='espn'),
  'wikidata_state', (select rights_state from public.wbh_sources where source_id='wikidata'),
  'synthetic_flag', (select is_synthetic from public.wbh_sources where source_id='synthetic_fixture'),
  'games_view_security_invoker', (select coalesce(c.reloptions::text like '%security_invoker=true%', false) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='wbh_games_public'),
  'persons_view_security_invoker', (select coalesce(c.reloptions::text like '%security_invoker=true%', false) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='wbh_persons_public'),
  'pbe_relations', (select count(*) from pg_class where relname like 'wnba\_pbe%'),
  'canonical_games', (select count(*) from public.wbh_games),
  'canonical_persons', (select count(*) from public.wbh_persons)
) as inv
"@
  $inv = $post[0].inv
  if ($inv -is [string]) { $inv = $inv | ConvertFrom-Json }

  $checks = [ordered]@{
    tables_38 = ([int]$inv.tables -eq 38)
    views_2 = ([int]$inv.views -eq 2)
    functions_15 = ([int]$inv.functions -eq 15)
    zero_policies = ([int]$inv.policies -eq 0)
    zero_anon_authenticated_table_grants = ([int]$inv.anon_auth_grants -eq 0)
    zero_anon_authenticated_function_execute = ([int]$inv.anon_auth_fn_exec -eq 0)
    source_registry_10 = ([int]$inv.sources -eq 10)
    espn_prohibited = ($inv.espn_state -eq 'prohibited')
    wikidata_approved = ($inv.wikidata_state -eq 'approved_commercial')
    synthetic_fixture_hidden = ([bool]$inv.synthetic_flag)
    games_view_security_invoker = ([bool]$inv.games_view_security_invoker)
    persons_view_security_invoker = ([bool]$inv.persons_view_security_invoker)
    pbe_relations_unchanged = ([int]$inv.pbe_relations -eq 22)
    history_starts_empty_games = ([int]$inv.canonical_games -eq 0)
    history_starts_empty_persons = ([int]$inv.canonical_persons -eq 0)
  }

  $checks.GetEnumerator() | ForEach-Object { Write-Host ("{0,-5} {1}" -f $(if ($_.Value) { 'PASS' } else { 'FAIL' }), $_.Key) }
  $failed = @($checks.GetEnumerator() | Where-Object { -not $_.Value }).Count

  $receipt = [ordered]@{
    ref = $Ref
    reviewed_commit = $ReviewedCommit
    applied_at_db = $inv.db_now
    pre = $pre
    inventory = $inv
    checks = $checks
    failed = $failed
  }
  $receiptPath = Join-Path $root "docs/evidence/wbh-history-foundation-v1-apply-tkmln.json"
  $receipt | ConvertTo-Json -Depth 8 | Set-Content $receiptPath -Encoding UTF8

  Write-Host ("WBH APPLY VERIFY {0}/{1} passed - tables={2} functions={3} pbe={4}" -f ($checks.Count-$failed), $checks.Count, $inv.tables, $inv.functions, $inv.pbe_relations)
  Write-Host "Receipt: $receiptPath"
  if ($failed) { exit 1 }
}
finally {
  Pop-Location
}
