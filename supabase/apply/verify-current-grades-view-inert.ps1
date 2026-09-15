# Read-only-in-effect production check on tkmlnhmylqnttmnsnief: service_role holds a residual INSERT grant on the
# view public.wnba_pbe_current_grades (Supabase default privileges; the v1 migration did not revoke it). Prove the
# grant is inert: an insert through the view as service_role must fail because a DISTINCT ON view is not updatable.
# The statement runs inside a transaction whose final statement raises, so nothing can persist.
$ErrorActionPreference = "Stop"
$Ref = "tkmlnhmylqnttmnsnief"
$sig = @'
using System; using System.Runtime.InteropServices;
public class CredManWnbaView {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  public static string Read(string target) { IntPtr p; if (!CredRead(target, 1, 0, out p)) return null; var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL)); var b = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, b, 0, b.Length); CredFree(p); return System.Text.Encoding.UTF8.GetString(b); }
}
'@
if (-not ([System.Management.Automation.PSTypeName]'CredManWnbaView').Type) { Add-Type -TypeDefinition $sig }
$tok = [CredManWnbaView]::Read("Supabase CLI:supabase")
if ($tok.StartsWith("go-keyring-base64:")) { $tok = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($tok.Substring(18))) }
$headers = @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" }
$uri = "https://api.supabase.com/v1/projects/$Ref/database/query"
$sql = @"
begin;
create temp table _v (outcome text);
grant all on _v to public;
do `$t`$
begin
  set local role service_role;
  begin
    insert into public.wnba_pbe_current_grades (prediction_id, revision, result, result_reference, graded_by)
    values (gen_random_uuid(), 1, 'win', '{}', 'view-insert-probe');
    insert into _v values ('INSERT SUCCEEDED');
  exception when others then
    insert into _v values (sqlstate || ' ' || sqlerrm);
  end;
end `$t`$;
reset role;
do `$d`$ begin raise exception 'WNBA_VIEW_PROBE %', (select json_build_object('outcome', outcome, 'grade_rows', (select count(*) from public.wnba_pbe_grade_revisions), 'has_instead_rules_or_triggers', exists (select 1 from pg_rewrite r join pg_class c on c.oid = r.ev_class where c.relname = 'wnba_pbe_current_grades' and r.rulename <> '_RETURN') or exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = 'wnba_pbe_current_grades')) from _v); end `$d`$;
rollback;
"@
$raw = $null
try { $null = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body (@{ query = $sql } | ConvertTo-Json -Compress); throw "probe did not abort" } catch { $raw = $_.ErrorDetails.Message; if (-not $raw) { throw } }
$message = $raw
try { $e = $raw | ConvertFrom-Json; if ($e.message) { $message = [string]$e.message } } catch {}
$m = [regex]::Match($message, 'WNBA_VIEW_PROBE (\{.*\})', 'Singleline')
if (-not $m.Success) { Write-Host $raw; exit 1 }
$c = $m.Groups[1].Value
$r = $null
for ($i = 0; $i -le 3 -and $null -eq $r; $i++) {
  try { $r = $c | ConvertFrom-Json -ErrorAction Stop } catch {
    if ($c -notmatch '\\"') { Write-Host "unparseable probe result: $c"; exit 1 }
    $c = ('"' + $c + '"') | ConvertFrom-Json -ErrorAction Stop
  }
}
Write-Host ("outcome: {0}`ngrade rows after rollback-scoped probe: {1}`ninstead rules/triggers on view: {2}" -f $r.outcome, $r.grade_rows, $r.has_instead_rules_or_triggers)
$after = (Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body (@{ query = "select count(*)::int as n from public.wnba_pbe_grade_revisions" } | ConvertTo-Json -Compress))[0].n
Write-Host "grade rows (independent query): $after"
if ($r.outcome -like 'INSERT SUCCEEDED*' -or $r.has_instead_rules_or_triggers -or $after -ne 0) { exit 1 }
