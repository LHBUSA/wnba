import fs from 'node:fs';
import crypto from 'node:crypto';
const SP = process.argv[2];
const { freezeWinbaMonthly } = await import('file:///C:/projects/wnba/workers/wnba-news/src/winba-index.js');
const { winbaTeamDepthData, winbaIndexLeaderboard, winbaTeamDepth } = await import('file:///C:/projects/wnba/src/views/winba-leaderboard.js');

const dr = JSON.parse(fs.readFileSync(`${SP}/dr-full.json`, 'utf8')).data;
const photos = JSON.parse(fs.readFileSync('C:/projects/wnba/data/player-photos.json', 'utf8')).players;
const media = JSON.parse(fs.readFileSync('C:/projects/wnba/data/newsroom-media.json', 'utf8')).players;
const approved = new Map(photos.filter((p) => p.status === 'approved').map((p) => [String(p.espn_athlete_id), p]));
const roster = new Set(JSON.parse(fs.readFileSync(`${SP}/players.json`, 'utf8')).data.players.map((p) => String(p.athlete_id)));

// Rebuild a frozen board from a dry-run period, exactly as the generator would.
const asSnapshot = (p) => ({
  version: 'winba/1.0.0', season: dr.season, generated_at: p.as_of,
  as_of: p.as_of, qualified_count: p.qualified_count, provisional_count: p.provisional_count,
  games_used: p.games_used,
  rows: p.top.map((r) => ({
    athlete_id: r.athlete_id, name: r.name, team_id: r.team_id, score: r.score, rank: r.rank, qualified: true,
    sample: { games: r.games, wins: r.wins, minutes: r.minutes },
    averages: { min: r.min, pts: r.pts, reb: r.reb, ast: r.ast },
    components: { production_percentile: r.production_percentile, win_rate: r.win_rate, winning_output_share: r.winning_output_share, court_share: r.court_share }
  }))
});
const playerById = new Map(photos.map((p) => [String(p.espn_athlete_id), { name: p.display_name, position: p.position, experience_years: null }]));
const teamById = new Map();
const hash = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);

const out = {};
for (const p of dr.periods) {
  const snap = asSnapshot(p);
  const freezes = [1, 2, 3].map(() => freezeWinbaMonthly(snap, { period: p.period, playerById, teamById, at: '2026-11-02T10:00:00.000Z', top: 25 }));
  const keys = freezes.map((f) => hash((f.rows || []).map((r) => [r.rank, r.player_id, r.score, r.team_id, r.components])));
  const f = freezes[0];
  const rows = f?.rows || [];
  const top3 = rows.slice(0, 3);
  const top10 = rows.slice(0, 10);
  const art = { kind: 'winba_index', period: p.period, period_label: p.period, winba_board: f, winba_board_media: rows.map((r) => ({ player_id: r.player_id, rank: r.rank, image: approved.has(r.player_id) && (media[r.player_id]?.slots?.podium || []).length ? { square: `/media/players/${r.player_id}/square.webp`, podium: media[r.player_id].slots.podium[0].src, portrait: media[r.player_id].slots.podium.at(-1).src } : null })) };
  out[p.period] = {
    games_used: p.games_used, players_scored: p.players_scored, qualified: p.qualified_count,
    rows: rows.length,
    deterministic: new Set(keys).size === 1, hash: keys[0],
    identity_unresolved: rows.filter((r) => !r.player_name || !/^\d+$/.test(r.player_id)).map((r) => r.player_id),
    off_roster_in_top25: rows.filter((r) => !roster.has(r.player_id)).map((r) => `#${r.rank} ${r.player_name}`),
    podium_approved: top3.map((r) => approved.has(r.player_id) && (media[r.player_id]?.slots?.podium || []).length > 0),
    podium_ready: top3.every((r) => approved.has(r.player_id) && (media[r.player_id]?.slots?.podium || []).length > 0),
    top10_photos: top10.filter((r) => approved.has(r.player_id)).length,
    top25_photos: rows.filter((r) => approved.has(r.player_id)).length,
    top25_fallback: rows.filter((r) => !approved.has(r.player_id)).length,
    components_complete: rows.every((r) => ['production_percentile', 'win_rate', 'winning_output_share', 'court_share'].every((k) => Number.isFinite(Number(r.components?.[k])))),
    stats_complete: rows.every((r) => ['pts', 'reb', 'ast', 'min'].every((k) => Number.isFinite(Number(r.averages?.[k])))),
    minutes_present: rows.every((r) => Number.isFinite(Number(r.minutes))),
    ranks_sequential: rows.every((r, i) => r.rank === i + 1),
    scores_descend: rows.every((r, i) => i === 0 || rows[i - 1].score >= r.score),
    team_depth: winbaTeamDepthData(art).map((t) => `${t.players.length}·${t.team_name || t.team_id}`),
    renders_board: String(winbaIndexLeaderboard(art)).includes('wb-board'),
    renders_depth: String(winbaTeamDepth(art)).includes('wb-depth-card') || winbaTeamDepthData(art).length === 0,
    top3: top3.map((r) => `#${r.rank} ${r.player_name} ${Math.round(r.score)} (${r.team_id})`)
  };
}
fs.writeFileSync(`${SP}/readiness.json`, JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) {
  console.log(`=== ${k}`);
  console.log(`  games ${v.games_used} | scored ${v.players_scored} | qualified ${v.qualified} | board rows ${v.rows}`);
  console.log(`  deterministic ${v.deterministic} hash ${v.hash} | ranks seq ${v.ranks_sequential} | scores descend ${v.scores_descend}`);
  console.log(`  identity unresolved ${JSON.stringify(v.identity_unresolved)} | off-roster kept: ${JSON.stringify(v.off_roster_in_top25)}`);
  console.log(`  components complete ${v.components_complete} | stats complete ${v.stats_complete} | minutes ${v.minutes_present}`);
  console.log(`  podium ready ${v.podium_ready} ${JSON.stringify(v.podium_approved)} | top10 photos ${v.top10_photos}/10 | top25 photos ${v.top25_photos}/${v.rows} (fallback ${v.top25_fallback})`);
  console.log(`  renders board ${v.renders_board} | renders depth ${v.renders_depth}`);
  console.log(`  depth: ${v.team_depth.join(', ')}`);
  console.log(`  top3: ${v.top3.join(' | ')}`);
}
