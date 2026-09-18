# Prove-then-apply runner for a single additive WBH data migration on tkmlnhmylqnttmnsnief.
#
#   pwsh -NoProfile -File supabase/apply/apply-wbh-migration.ps1 -Migration supabase/migrations/<file>.sql
#   pwsh -NoProfile -File supabase/apply/apply-wbh-migration.ps1 -Migration <file> -Apply
#
# Default is PROOF ONLY: the migration body runs inside a transaction that always rolls back, because
# the last statement raises an exception carrying the verification JSON. Nothing can persist from a
# proof run whatever the client does.
#
# -Apply runs the same committed file for real, then re-reads the verification query and writes an
# evidence receipt to docs/evidence/. It refuses to apply a file with uncommitted local edits, so what
# is applied is always what was reviewed.
param(
  [Parameter(Mandatory = $true)][string]$Migration,
  [string]$Verify,
  [switch]$Apply,
  [string]$EvidenceName
)
$ErrorActionPreference = "Stop"
$Ref = "tkmlnhmylqnttmnsnief"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Push-Location $root
try {
  if (-not (Test-Path $Migration)) { throw "migration not found: $Migration" }
  $migName = Split-Path $Migration -Leaf

  # the verification query: defaults to the 2024 WNBA edition shape
  if (-not $Verify) {
    $Verify = @"
select json_build_object(
  'regular_games', (select count(*) from public.wbh_games where edition_id='wnba_2024' and game_type='regular'),
  'postseason_games', (select count(*) from public.wbh_games where edition_id='wnba_2024' and season_phase in ('playoffs','final')),
  'cup_games', (select count(*) from public.wbh_games where edition_id='wnba_2024' and game_type='in_season_cup'),
  'cup_counts_for_standings', (select coalesce(bool_or(counts_for_standings),false) from public.wbh_games where edition_id='wnba_2024' and game_type='in_season_cup'),
  'games_with_two_teams', (select count(*) from (select g.game_id from public.wbh_games g join public.wbh_game_teams t using(game_id) where g.edition_id='wnba_2024' group by g.game_id having count(*)=2) s),
  'total_games', (select count(*) from public.wbh_games where edition_id='wnba_2024'),
  'regular_games_with_both_scores', (select count(*) from (select g.game_id from public.wbh_games g join public.wbh_game_teams t using(game_id) where g.edition_id='wnba_2024' and g.game_type='regular' and t.points is not null group by g.game_id having count(*)=2) s),
  'clubs_at_40', (select count(*) from public.wbh_team_editions te where te.edition_id='wnba_2024' and (select count(*) from public.wbh_games g join public.wbh_game_teams gt using(game_id) where g.edition_id='wnba_2024' and g.game_type='regular' and gt.team_edition_id=te.team_edition_id)=40),
  'player_game_stats', (select count(*) from public.wbh_player_game_stats),
  'espn_rights_state', (select rights_state from public.wbh_sources where source_id='espn'),
  'pbe_ledger_relations', (select count(*) from pg_class where relname like 'wnba\_pbe%')
) as verification;
"@
  }

  $sql = [IO.File]::ReadAllText((Join-Path $root $Migration), [Text.Encoding]::UTF8)
  if (-not $sql.Contains("commit;")) { throw "migration has no COMMIT; refusing" }

  $sig = @'
using System; using System.Runtime.InteropServices;
public class CredManWbhApplyMig {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  public static string Read(string target) { IntPtr p; if (!CredRead(target, 1, 0, out p)) return null; var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL)); var b = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, b, 0, b.Length); CredFree(p); return System.Text.Encoding.UTF8.GetString(b); }
}
'@
  if (-not ([System.Management.Automation.PSTypeName]'CredManWbhApplyMig').Type) { Add-Type -TypeDefinition $sig }
  $tok = [CredManWbhApplyMig]::Read("Supabase CLI:supabase")
  if (-not $tok) { throw "no Supabase token in Credential Manager" }
  if ($tok.StartsWith("go-keyring-base64:")) { $tok = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($tok.Substring(18))) }
  $hdr = @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" }
  $uri = "https://api.supabase.com/v1/projects/$Ref/database/query"

  if (-not $Apply) {
    # strip the migration's own transaction control, then force a rollback by raising
    $body = ($sql -split "`n" | Where-Object { $_ -notmatch '^\s*(begin|commit)\s*;\s*$' }) -join "`n"
    $verifyExpr = ($Verify -replace '(?s)\s*as\s+verification\s*;\s*$', '')
    $proof = "begin;`n$body`ndo `$done`$ begin raise exception 'WBH_MIGRATION_PROOF %', ($verifyExpr)::text; end `$done`$;`nrollback;"
    Write-Output "PROOF (rollback) :: $migName"
    try {
      Invoke-RestMethod -Method Post -Uri $uri -Headers $hdr -Body (@{ query = $proof } | ConvertTo-Json -Compress) | Out-Null
      throw "proof did not raise; the transaction guard is missing"
    } catch {
      $msg = $_.ErrorDetails.Message
      if (-not $msg) { $msg = $_.Exception.Message }
      if ($msg -match 'WBH_MIGRATION_PROOF\s+(\{.*\})') {
        $json = $Matches[1] -replace '\\n',' ' -replace '\\"','"'
        Write-Output "PROOF PASSED - migration ran and rolled back. Verification inside the transaction:"
        Write-Output $json
      } else {
        Write-Output "PROOF FAILED:"
        Write-Output $msg
        exit 1
      }
    }
    Write-Output ""
    Write-Output "Nothing was persisted. Re-run with -Apply to commit."
    return
  }

  $dirty = @(git status --porcelain -- $Migration)
  if ($dirty.Count -gt 0) { throw "migration has uncommitted local edits; commit it before applying" }
  $blob = (git rev-parse "HEAD:$Migration").Trim()

  Write-Output "APPLY :: $migName (blob $blob)"
  Invoke-RestMethod -Method Post -Uri $uri -Headers $hdr -Body (@{ query = $sql } | ConvertTo-Json -Compress) | Out-Null
  $after = Invoke-RestMethod -Method Post -Uri $uri -Headers $hdr -Body (@{ query = "begin read only;`n$Verify" } | ConvertTo-Json -Compress)
  $v = $after[0].verification
  if ($v -is [string]) { $v = $v | ConvertFrom-Json }

  $receipt = [ordered]@{
    ref = $Ref
    migration = $migName
    reviewed_blob = $blob
    applied_at_utc = (Get-Date).ToUniversalTime().ToString("o")
    verification = $v
  }
  if (-not $EvidenceName) { $EvidenceName = ($migName -replace '\.sql$', '') + "-apply-tkmln.json" }
  $out = Join-Path $root "docs/evidence/$EvidenceName"
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -Path $out -Encoding UTF8
  Write-Output "applied. receipt: $out"
  $v | ConvertTo-Json -Depth 8
} finally { Pop-Location }
