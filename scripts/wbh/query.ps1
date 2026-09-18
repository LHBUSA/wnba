# READ-ONLY ad-hoc query runner for the WBH database on tkmlnhmylqnttmnsnief.
#
#   pwsh -NoProfile -File scripts/wbh/query.ps1 -Sql "select count(*) from public.wbh_games"
#   pwsh -NoProfile -File scripts/wbh/query.ps1 -File path/to/query.sql
#
# The statement is wrapped in BEGIN READ ONLY so nothing can be written through this path, whatever
# the query says. Writes go through reviewed migrations and the apply runners, never through here.
param(
  [string]$Sql,
  [string]$File,
  [int]$Depth = 12
)
$ErrorActionPreference = "Stop"
$Ref = "tkmlnhmylqnttmnsnief"

if ($File) { $Sql = [IO.File]::ReadAllText((Resolve-Path $File), [Text.Encoding]::UTF8) }
if (-not $Sql) { throw "pass -Sql or -File" }

$sig = @'
using System; using System.Runtime.InteropServices;
public class CredManWbhQuery {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  public static string Read(string target) { IntPtr p; if (!CredRead(target, 1, 0, out p)) return null; var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL)); var b = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, b, 0, b.Length); CredFree(p); return System.Text.Encoding.UTF8.GetString(b); }
}
'@
if (-not ([System.Management.Automation.PSTypeName]'CredManWbhQuery').Type) { Add-Type -TypeDefinition $sig }
$tok = [CredManWbhQuery]::Read("Supabase CLI:supabase")
if (-not $tok) { throw "no Supabase token in Credential Manager" }
if ($tok.StartsWith("go-keyring-base64:")) { $tok = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($tok.Substring(18))) }

$q = "begin read only;`n$Sql"
$r = Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" `
  -Headers @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" } `
  -Body (@{ query = $q } | ConvertTo-Json -Compress)
$r | ConvertTo-Json -Depth $Depth
