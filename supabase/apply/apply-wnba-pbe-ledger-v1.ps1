# APPLY (owner-approved 2026-09-15) supabase/migrations/20260915200000_wnba_pbe_ledger_v1.sql to tkmlnhmylqnttmnsnief,
# then verify production read-only.
#
#   pwsh -NoProfile -File supabase/apply/apply-wnba-pbe-ledger-v1.ps1
#
# Guards: target ref is fixed; the migration bytes must hash to the reviewed sha256; the target must hold zero
# wnba_pbe_* relations first. The migration file is sent verbatim (its own BEGIN/COMMIT). Verification uses the
# exact catalog fingerprint query from the rollback proof, taken immediately before and after the apply.
# Writes docs/evidence/wnba-pbe-ledger-v1-apply-tkmln.json. Exits non-zero on any failed check.
$ErrorActionPreference = "Stop"
$Ref = "tkmlnhmylqnttmnsnief"
$ReviewedSha = "8a31662d8176daddad77dd9df6ebc4fed4210acf99cc267d60569d7f4e7abbd8"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$migrationPath = Join-Path $root "supabase/migrations/20260915200000_wnba_pbe_ledger_v1.sql"

$bytes = [IO.File]::ReadAllBytes($migrationPath)
$sha = ([Security.Cryptography.SHA256]::Create().ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join ""
if ($sha -ne $ReviewedSha) { throw "migration sha256 $sha != reviewed $ReviewedSha; refusing to apply" }
$migrationSql = [Text.Encoding]::UTF8.GetString($bytes)

$core = Get-Content (Join-Path $root "supabase/proofs/wnba_pbe_ledger_v1_proof.core.sql") -Raw -Encoding UTF8
$fpm = [regex]::Match($core, '(?s)as \$fp\$(.*?)\$fp\$;')
if (-not $fpm.Success) { throw "fingerprint query not found in proof core" }
$fingerprintSql = $fpm.Groups[1].Value.Trim() -replace 'select md5\(string_agg', 'select md5(string_agg'

$sig = @'
using System; using System.Runtime.InteropServices;
public class CredManWnbaApply {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  public static string Read(string target) { IntPtr p; if (!CredRead(target, 1, 0, out p)) return null; var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL)); var b = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, b, 0, b.Length); CredFree(p); return System.Text.Encoding.UTF8.GetString(b); }
}
'@
if (-not ([System.Management.Automation.PSTypeName]'CredManWnbaApply').Type) { Add-Type -TypeDefinition $sig }
$tok = [CredManWnbaApply]::Read("Supabase CLI:supabase")
if (-not $tok) { throw "Supabase CLI token not found in Credential Manager" }
if ($tok.StartsWith("go-keyring-base64:")) { $tok = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($tok.Substring(18))) }
$headers = @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" }
$uri = "https://api.supabase.com/v1/projects/$Ref/database/query"
function Q([string]$sql) { Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body (@{ query = $sql } | ConvertTo-Json -Compress) }

# ---------------------------------------------------------------- preflight
$pre = Q "select (select count(*)::int from pg_class where relname like 'wnba\_pbe%') as wnba_pbe_relations, (select count(*)::int from pg_proc where proname like 'wnba\_pbe%') as wnba_pbe_functions, version() as version, now() as db_now"
if ($pre[0].wnba_pbe_relations -ne 0 -or $pre[0].wnba_pbe_functions -ne 0) { throw "target already holds wnba_pbe objects ($($pre[0].wnba_pbe_relations) relations, $($pre[0].wnba_pbe_functions) functions); refusing to apply" }
$fpBefore = (Q "select ($fingerprintSql) as fp")[0].fp
Write-Host "preflight OK · $($pre[0].version) · fingerprint before $fpBefore"

# ---------------------------------------------------------------- apply (verbatim)
$applyStarted = (Get-Date).ToUniversalTime().ToString("o")
$null = Q $migrationSql
$applied = (Q "select now() as db_now")[0].db_now
Write-Host "APPLIED at $applied (client started $applyStarted)"

# ---------------------------------------------------------------- verify
$checks = [ordered]@{}
$fpAfter = (Q "select ($fingerprintSql) as fp")[0].fp

$inventory = Q @"
select json_build_object(
  'tables', (select json_agg(json_build_object('name', c.relname, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity) order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'wnba\_pbe%' and c.relkind = 'r'),
  'views', (select json_agg(json_build_object('name', c.relname, 'reloptions', c.reloptions) order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'wnba\_pbe%' and c.relkind = 'v'),
  'indexes', (select json_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'wnba\_pbe%' and c.relkind = 'i'),
  'functions', (select json_agg(json_build_object('name', p.proname, 'security_definer', p.prosecdef, 'config', p.proconfig, 'acl', p.proacl::text) order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'wnba\_pbe%'),
  'triggers', (select json_agg(json_build_object('table', c.relname, 'name', t.tgname, 'enabled', t.tgenabled, 'def', pg_get_triggerdef(t.oid)) order by c.relname, t.tgname) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname like 'wnba\_pbe%' and not t.tgisinternal),
  'constraints', (select json_agg(json_build_object('table', conrelid::regclass::text, 'name', conname, 'type', contype) order by conrelid::regclass::text, conname) from pg_constraint where conrelid::regclass::text like '%wnba\_pbe%'),
  'policies', (select count(*) from pg_policies where tablename like 'wnba\_pbe%'),
  'table_grants', (select json_agg(json_build_object('grantee', grantee, 'table', table_name, 'privilege', privilege_type) order by grantee, table_name, privilege_type) from information_schema.role_table_grants where table_name like 'wnba\_pbe%' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
  'privilege_matrix', (select json_agg(json_build_object('role', r, 'object', o, 'select', has_table_privilege(r, o, 'select'), 'insert', has_table_privilege(r, o, 'insert'), 'update', has_table_privilege(r, o, 'update'), 'delete', has_table_privilege(r, o, 'delete'), 'truncate', has_table_privilege(r, o, 'truncate'), 'references', has_table_privilege(r, o, 'references'), 'trigger', has_table_privilege(r, o, 'trigger')) order by r, o)
     from unnest(array['anon', 'authenticated', 'service_role']) r,
          unnest(array['public.wnba_pbe_model_versions', 'public.wnba_pbe_model_promotions', 'public.wnba_pbe_prediction_observations', 'public.wnba_pbe_locked_predictions', 'public.wnba_pbe_grade_revisions', 'public.wnba_pbe_current_grades']) o),
  'function_execute', (select json_agg(json_build_object('role', r, 'function', f, 'execute', has_function_privilege(r, f, 'execute')) order by r, f)
     from unnest(array['anon', 'authenticated', 'service_role']) r,
          unnest(array['public.wnba_pbe_current_champion()']) f),
  'row_counts', json_build_object(
     'model_versions', (select count(*) from public.wnba_pbe_model_versions),
     'model_promotions', (select count(*) from public.wnba_pbe_model_promotions),
     'observations', (select count(*) from public.wnba_pbe_prediction_observations),
     'locked_predictions', (select count(*) from public.wnba_pbe_locked_predictions),
     'grade_revisions', (select count(*) from public.wnba_pbe_grade_revisions))
) as inv
"@
$inv = $inventory[0].inv
if ($inv -is [string]) { $inv = $inv | ConvertFrom-Json }

$expectTables = @('wnba_pbe_grade_revisions', 'wnba_pbe_locked_predictions', 'wnba_pbe_model_promotions', 'wnba_pbe_model_versions', 'wnba_pbe_prediction_observations')
$expectFunctions = @('wnba_pbe_current_champion', 'wnba_pbe_grade_insert', 'wnba_pbe_lock_insert', 'wnba_pbe_observation_insert', 'wnba_pbe_reject_mutation', 'wnba_pbe_reject_truncate', 'wnba_pbe_stamp_insert')
$tables = @($inv.tables); $trg = @($inv.triggers); $pm = @($inv.privilege_matrix)

$checks.tables_exist = (@($tables.name | Sort-Object) -join ',') -eq ($expectTables -join ',')
$checks.view_current_grades_security_invoker = (@($inv.views).Count -eq 1) -and ($inv.views[0].name -eq 'wnba_pbe_current_grades') -and ((@($inv.views[0].reloptions) -join ',') -match 'security_invoker=(true|on)')
$checks.functions_exist = (@(@($inv.functions).name | Sort-Object) -join ',') -eq ($expectFunctions -join ',')
$checks.functions_not_security_definer_and_pinned_search_path = -not (@($inv.functions) | Where-Object { $_.security_definer -or -not ((@($_.config) -join ',') -match 'search_path=') })
$checks.rls_enabled_all_tables = -not ($tables | Where-Object { -not $_.rls })
$checks.zero_policies = [int]$inv.policies -eq 0
$checks.zero_anon_authenticated_grants = -not (@($inv.table_grants) | Where-Object { $_.grantee -in @('anon', 'authenticated', 'PUBLIC') })
$checks.anon_authenticated_no_privilege_matrix = -not ($pm | Where-Object { $_.role -ne 'service_role' -and ($_.select -or $_.insert -or $_.update -or $_.delete -or $_.truncate -or $_.references -or $_.trigger) })
$checks.service_role_select_insert_tables_only = -not ($pm | Where-Object { $_.role -eq 'service_role' -and $_.object -ne 'public.wnba_pbe_current_grades' -and (-not $_.select -or -not $_.insert -or $_.update -or $_.delete -or $_.truncate -or $_.references -or $_.trigger) })
$checks.service_role_view_select_only = -not ($pm | Where-Object { $_.role -eq 'service_role' -and $_.object -eq 'public.wnba_pbe_current_grades' -and (-not $_.select -or $_.insert -or $_.update -or $_.delete -or $_.truncate) })
$checks.champion_fn_execute_service_role_only = -not (@($inv.function_execute) | Where-Object { ($_.role -eq 'service_role') -ne [bool]$_.execute })
foreach ($t in $expectTables) {
  $mine = $trg | Where-Object { $_.table -eq $t -and $_.enabled -eq 'O' }
  $checks["immutable_update_delete_$t"] = [bool]($mine | Where-Object { $_.def -match 'BEFORE DELETE OR UPDATE|BEFORE UPDATE OR DELETE' -and $_.def -match 'wnba_pbe_reject_mutation' })
  $checks["no_truncate_$t"] = [bool]($mine | Where-Object { $_.def -match 'BEFORE TRUNCATE' -and $_.def -match 'wnba_pbe_reject_truncate' })
}
$checks.insert_guards = [bool](($trg | Where-Object { $_.name -eq 'wnba_pbe_observations_insert' }) -and ($trg | Where-Object { $_.name -eq 'wnba_pbe_locked_insert' }) -and ($trg | Where-Object { $_.name -eq 'wnba_pbe_grades_insert' }) -and ($trg | Where-Object { $_.name -eq 'wnba_pbe_model_versions_stamp' }) -and ($trg | Where-Object { $_.name -eq 'wnba_pbe_model_promotions_stamp' }))
$checks.all_15_triggers_enabled = @($trg | Where-Object { $_.enabled -eq 'O' }).Count -eq 15
$checks.one_lock_per_game_unique = [bool](@($inv.constraints) | Where-Object { $_.name -eq 'wnba_pbe_lock_one_per_game' -and $_.type -eq 'u' })
$checks.ledger_empty = ($inv.row_counts.model_versions + $inv.row_counts.model_promotions + $inv.row_counts.observations + $inv.row_counts.locked_predictions + $inv.row_counts.grade_revisions) -eq 0
$checks.non_wnba_fingerprint_unchanged = $fpBefore -eq $fpAfter

$checks.GetEnumerator() | ForEach-Object { "{0,-5} {1}" -f $(if ($_.Value) { 'PASS' } else { 'FAIL' }), $_.Key } | Write-Host
$failed = @($checks.GetEnumerator() | Where-Object { -not $_.Value }).Count

$receipt = [ordered]@{
  ref = $Ref
  migration = "supabase/migrations/20260915200000_wnba_pbe_ledger_v1.sql"
  migration_sha256 = $sha
  reviewed_commit = "70575e5"
  applied_at_db = $applied
  apply_client_started = $applyStarted
  server_version = $pre[0].version
  fingerprint_before = $fpBefore
  fingerprint_after = $fpAfter
  rollback_proof_fingerprint_2026_09_15T19_47Z = "6936461fa9b3d6693c8ed1b96fccdd3f"
  checks = $checks
  failed = $failed
  inventory = $inv
}
$receipt | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $root "docs/evidence/wnba-pbe-ledger-v1-apply-tkmln.json") -Encoding UTF8
Write-Host ("VERIFY {0}/{1} passed · fingerprint {2} -> {3}" -f ($checks.Count - $failed), $checks.Count, $fpBefore, $fpAfter)
if ($failed) { exit 1 }
