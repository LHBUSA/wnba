# READ-ONLY state of the WNBA PBE ledger on tkmlnhmylqnttmnsnief (inside BEGIN READ ONLY ... ROLLBACK).
#   pwsh -NoProfile -File supabase/apply/read-wnba-pbe-state.ps1
$ErrorActionPreference = "Stop"
$Ref = "tkmlnhmylqnttmnsnief"
$sig = @'
using System; using System.Runtime.InteropServices;
public class CredManWnbaRead {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  public static string Read(string target) { IntPtr p; if (!CredRead(target, 1, 0, out p)) return null; var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL)); var b = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, b, 0, b.Length); CredFree(p); return System.Text.Encoding.UTF8.GetString(b); }
}
'@
if (-not ([System.Management.Automation.PSTypeName]'CredManWnbaRead').Type) { Add-Type -TypeDefinition $sig }
$tok = [CredManWnbaRead]::Read("Supabase CLI:supabase")
if ($tok.StartsWith("go-keyring-base64:")) { $tok = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($tok.Substring(18))) }
$q = @"
begin read only;
select json_build_object(
  'checked_at', now(),
  'model_versions', (select json_agg(json_build_object('model_id', model_id, 'role', role_at_registration, 'artifact_sha256', artifact_sha256, 'registered_at', registered_at)) from public.wnba_pbe_model_versions),
  'promotions', (select count(*) from public.wnba_pbe_model_promotions),
  'current_champion', public.wnba_pbe_current_champion(),
  'observations', (select count(*) from public.wnba_pbe_prediction_observations),
  'locked_predictions', (select count(*) from public.wnba_pbe_locked_predictions),
  'grade_revisions', (select count(*) from public.wnba_pbe_grade_revisions)
) as state;
"@
$r = Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" } -Body (@{ query = $q } | ConvertTo-Json -Compress)
$state = $r[0].state
if ($state -is [string]) { $state = $state | ConvertFrom-Json }
$state | ConvertTo-Json -Depth 5
