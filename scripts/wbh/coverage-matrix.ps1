# READ-ONLY live coverage matrix for the Women's Basketball History database on tkmlnhmylqnttmnsnief.
#
#   pwsh -NoProfile -File scripts/wbh/coverage-matrix.ps1
#
# Runs inside BEGIN READ ONLY ... ROLLBACK and writes:
#   docs/evidence/wbh-coverage-matrix-<utc date>.json   machine-generated, committed as evidence
#
# Everything reported here comes from the database. Planning documents are history; this is truth.
# Field-specific completeness is deliberate: a season can have complete results, partial box scores
# and zero play-by-play, and that is a useful season, not a failed one.
$ErrorActionPreference = "Stop"
$Ref = "tkmlnhmylqnttmnsnief"

$sig = @'
using System; using System.Runtime.InteropServices;
public class CredManWbhCoverage {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  public static string Read(string target) { IntPtr p; if (!CredRead(target, 1, 0, out p)) return null; var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL)); var b = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, b, 0, b.Length); CredFree(p); return System.Text.Encoding.UTF8.GetString(b); }
}
'@
if (-not ([System.Management.Automation.PSTypeName]'CredManWbhCoverage').Type) { Add-Type -TypeDefinition $sig }
$tok = [CredManWbhCoverage]::Read("Supabase CLI:supabase")
if (-not $tok) { throw "no Supabase token in Credential Manager" }
if ($tok.StartsWith("go-keyring-base64:")) { $tok = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($tok.Substring(18))) }

$q = @"
begin read only;
with ed as (
  select e.edition_id, e.season_year, e.season_label, e.completeness, e.team_count
    from public.wbh_competition_editions e
    join public.wbh_competitions c on c.competition_id = e.competition_id
   where c.competition_id = 'wnba' or c.display_name ilike '%WNBA%'
),
g as (
  select g.*, ed.season_year
    from public.wbh_games g join ed on ed.edition_id = g.edition_id
),
per_season as (
  select ed.season_year,
         ed.edition_id,
         ed.completeness as edition_completeness,
         ed.team_count,
         (select count(*) from g where g.edition_id = ed.edition_id) as games_total,
         (select count(*) from g where g.edition_id = ed.edition_id and g.counts_for_standings) as games_standings,
         (select count(*) from g where g.edition_id = ed.edition_id and g.game_type = 'regular') as games_regular,
         (select count(*) from g where g.edition_id = ed.edition_id and g.season_phase in ('playoffs','final')) as games_postseason,
         (select count(*) from g where g.edition_id = ed.edition_id and g.game_type = 'final') as games_finals,
         (select count(*) from g where g.edition_id = ed.edition_id and g.game_type = 'in_season_cup') as games_cup,
         (select count(*) from g where g.edition_id = ed.edition_id and g.status = 'final') as games_status_final,
         (select count(*) from g where g.edition_id = ed.edition_id and g.venue_id is not null) as games_with_venue,
         (select count(*) from g where g.edition_id = ed.edition_id and g.attendance_known) as games_with_attendance,
         (select count(*) from g gg where gg.edition_id = ed.edition_id
            and (select count(*) from public.wbh_game_teams t where t.game_id = gg.game_id) = 2) as games_with_two_teams,
         (select count(*) from g gg where gg.edition_id = ed.edition_id
            and (select count(*) from public.wbh_game_teams t where t.game_id = gg.game_id and t.points is not null) = 2) as games_with_both_scores,
         (select count(*) from public.wbh_game_teams t join g on g.game_id = t.game_id where g.edition_id = ed.edition_id) as team_game_rows,
         (select count(*) from public.wbh_team_game_stats s join g on g.game_id = s.game_id where g.edition_id = ed.edition_id) as team_stat_rows,
         (select count(*) from public.wbh_player_game_stats s join g on g.game_id = s.game_id where g.edition_id = ed.edition_id) as player_stat_rows,
         (select count(distinct s.person_id) from public.wbh_player_game_stats s join g on g.game_id = s.game_id where g.edition_id = ed.edition_id) as distinct_players,
         (select count(distinct s.game_id) from public.wbh_player_game_stats s join g on g.game_id = s.game_id where g.edition_id = ed.edition_id) as games_with_player_box,
         (select count(*) from public.wbh_play_events p join g on g.game_id = p.game_id where g.edition_id = ed.edition_id) as play_events,
         (select count(distinct p.game_id) from public.wbh_play_events p join g on g.game_id = p.game_id where g.edition_id = ed.edition_id) as games_with_pbp,
         (select count(*) from public.wbh_game_officials o join g on g.game_id = o.game_id where g.edition_id = ed.edition_id) as official_rows,
         (select count(*) from public.wbh_team_editions te where te.edition_id = ed.edition_id) as team_editions,
         (select count(*) from public.wbh_roster_stints rs join public.wbh_team_editions te on te.team_edition_id = rs.team_edition_id
           where te.edition_id = ed.edition_id) as roster_stints,
         (select count(*) from public.wbh_award_recipients a where a.edition_id = ed.edition_id) as award_recipients,
         (select count(*) from public.wbh_draft_picks d where d.draft_year = ed.season_year) as draft_picks,
         (select coalesce(json_agg(distinct s.src), '[]'::json) from (
            select r.source_id as src from g gg
              join public.wbh_ingestion_runs r on r.run_id = gg.ingestion_run_id
             where gg.edition_id = ed.edition_id) s) as game_sources
    from ed
)
select json_build_object(
  'generated_at', now(),
  'project', 'tkmlnhmylqnttmnsnief',
  'seasons', (select coalesce(json_agg(row_to_json(per_season) order by per_season.season_year), '[]'::json) from per_season),
  'editions_registered', (select count(*) from ed),
  'totals', json_build_object(
     'games', (select count(*) from public.wbh_games),
     'game_team_rows', (select count(*) from public.wbh_game_teams),
     'player_game_stats', (select count(*) from public.wbh_player_game_stats),
     'team_game_stats', (select count(*) from public.wbh_team_game_stats),
     'play_events', (select count(*) from public.wbh_play_events),
     'persons', (select count(*) from public.wbh_persons),
     'roster_stints', (select count(*) from public.wbh_roster_stints),
     'derived_datasets', (select count(*) from public.wbh_derived_datasets)),
  'identity', json_build_object(
     'entity_source_ids_linked', (select count(*) from public.wbh_entity_source_ids where status = 'linked'),
     'entity_source_ids_candidate', (select count(*) from public.wbh_entity_source_ids where status = 'candidate'),
     'entity_source_ids_rejected', (select count(*) from public.wbh_entity_source_ids where status = 'rejected'),
     'identity_candidates_open', (select count(*) from public.wbh_identity_candidates where status = 'candidate'),
     'identity_conflicts', (select count(*) from public.wbh_identity_candidates where status = 'conflict')),
  'sources', (select coalesce(json_agg(json_build_object('source_id', source_id, 'rights_state', rights_state) order by source_id), '[]'::json)
                from public.wbh_sources),
  'ingestion_runs', (select coalesce(json_agg(json_build_object('source_id', source_id, 'mode', mode, 'status', status, 'runs', n) order by source_id, mode, status), '[]'::json)
                       from (select source_id, mode, status, count(*) as n from public.wbh_ingestion_runs group by 1,2,3) r)
) as matrix;
"@

$r = Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" `
  -Headers @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" } `
  -Body (@{ query = $q } | ConvertTo-Json -Compress)

$matrix = $r[0].matrix
if ($matrix -is [string]) { $matrix = $matrix | ConvertFrom-Json }

$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd")
$out = Join-Path $root "docs/evidence/wbh-coverage-matrix-$stamp.json"
$matrix | ConvertTo-Json -Depth 8 | Set-Content -Path $out -Encoding UTF8
Write-Output "wrote $out"

Write-Output ""
Write-Output "season | reg | post | finals | cup | 2-team | scores | teamstat | playerstat | players | pbp | offi | venue | att | rosters | awards | draft"
foreach ($s in $matrix.seasons) {
  Write-Output ("{0} | {1} | {2} | {3} | {4} | {5} | {6} | {7} | {8} | {9} | {10} | {11} | {12} | {13} | {14} | {15} | {16}" -f `
    $s.season_year, $s.games_regular, $s.games_postseason, $s.games_finals, $s.games_cup, $s.games_with_two_teams, `
    $s.games_with_both_scores, $s.team_stat_rows, $s.player_stat_rows, $s.distinct_players, $s.games_with_pbp, `
    $s.official_rows, $s.games_with_venue, $s.games_with_attendance, $s.roster_stints, $s.award_recipients, $s.draft_picks)
}
Write-Output ""
Write-Output ("totals: games {0}, player_game_stats {1}, persons {2}, roster_stints {3}" -f `
  $matrix.totals.games, $matrix.totals.player_game_stats, $matrix.totals.persons, $matrix.totals.roster_stints)
