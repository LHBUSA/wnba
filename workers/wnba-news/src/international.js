// International desk — deterministic PropBetEdge stories from wnba-international structured data.
//
// Material events only: a medal game (final or bronze) that has gone final within the last 12 hours. One story per
// game (id = hash of the game id): a later box-score correction revises it; a game that finished earlier is never
// promoted into a "new" story after the fact. Copy is built only from the normalized game, box score and the
// WNBA crosswalk; every number is in `facts`, so the publication gate and reconcile checks apply unchanged.

import { finalize, hashId } from './articles.js';
import { dLong, listJoin, poss } from './prose.js';

export const INTL_VERSION = 'wnba-international-desk/1.0.0';
export const INTL_STORY_WINDOW_MS = 12 * 3600e3;
const GAME_LENGTH_MS = 2.5 * 3600e3;
const MEDAL = { FINAL: { gold: 'gold', loser: 'silver' }, BRONZE: { gold: 'bronze', loser: null } };

const f1 = (v) => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '') : null);
const line = (p) => `${p.pts} points, ${p.reb} rebounds and ${p.ast} assists in ${p.min} minutes`;

/** Medal games finished within the window, newest first. `now` is injected for tests. */
export function materialInternationalGames(overview, now = Date.now()) {
  const games = [...(overview?.bracket?.rounds || []).flatMap((r) => r.games), overview?.bracket?.bronze_game].filter(Boolean);
  return games
    .filter((g) => MEDAL[g.round] && g.status === 'final' && g.winner)
    .filter((g) => { const end = Date.parse(g.scheduled_at) + GAME_LENGTH_MS; return now - end <= INTL_STORY_WINDOW_MS && now >= Date.parse(g.scheduled_at); })
    .sort((a, b) => Date.parse(b.scheduled_at) - Date.parse(a.scheduled_at));
}

export async function internationalArticles({ intlGet, now = Date.now(), competitions = ['world-cup-2026'] }) {
  if (!intlGet) return [];
  const out = [];
  for (const slug of competitions) {
    const ov = await intlGet(`/v1/international/competitions/${slug}`).catch(() => null);
    if (!ov?.competition || !ov.bracket) continue;
    for (const g of materialInternationalGames(ov, now)) {
      const detail = await intlGet(`/v1/international/games/${g.provider_ids.espn}`).catch(() => null);
      if (!detail?.boxscore?.teams?.length || detail.game?.status !== 'final') continue;
      out.push(await storyFor(ov.competition, detail, ov.bracket));
    }
  }
  return out;
}

async function storyFor(comp, detail, bracket) {
  const g = detail.game;
  const home = g.winner === g.home_team_id;
  const winner = home ? g.home_team : g.away_team;
  const loser = home ? g.away_team : g.home_team;
  const ws = home ? g.home_score : g.away_score;
  const ls = home ? g.away_score : g.home_score;
  const medal = MEDAL[g.round];
  const box = (t) => detail.boxscore.teams.find((x) => x.team.team_id === t.team_id);
  const top = (t) => [...(box(t)?.players || [])].filter((p) => Number.isFinite(p.pts)).sort((a, b) => b.pts - a.pts || (b.reb || 0) - (a.reb || 0));
  const wTop = top(winner);
  const lTop = top(loser);
  const wnbaPlayers = detail.boxscore.teams.flatMap((t) => t.players.filter((p) => p.wnba && Number.isFinite(p.min) && p.min > 0).map((p) => ({ ...p, team: t.team })));
  const wnbaWinners = wnbaPlayers.filter((p) => p.team.team_id === winner.team_id).sort((a, b) => b.pts - a.pts);
  const lead = wnbaWinners[0] || null;
  const medalText = medal.gold === 'gold' ? 'gold' : 'bronze';

  const headline = medal.gold === 'gold'
    ? `${winner.name} beat ${loser.name} ${ws}–${ls} to win gold at the ${comp.name}`
    : `${winner.name} beat ${loser.name} ${ws}–${ls} to take bronze at the ${comp.name}`;
  const deck = `${wTop[0].name} led ${winner.name} with ${wTop[0].pts} points; ${wnbaPlayers.length ? `${wnbaPlayers.length} WNBA players appeared in the ${g.round_name.toLowerCase()}.` : `${lTop[0].name} scored ${lTop[0].pts} for ${loser.name}.`}`;

  const body = [];
  const sections = [];
  const section = (title, paras) => { const ps = paras.filter(Boolean); if (!ps.length) return; sections.push({ title, first: body.length, count: ps.length }); body.push(...ps); };
  section('The result', [
    `${winner.name} won the ${g.round_name.toLowerCase()} of the ${comp.name} ${ws}–${ls} over ${loser.name}${g.venue?.name ? ` at ${g.venue.name}${g.venue.city ? ` in ${g.venue.city}` : ''}` : ''} on ${dLong(g.scheduled_at)}, taking ${medalText}${medal.loser ? ` and leaving ${loser.name} with ${medal.loser}` : ''}.`,
    bracket?.medals?.gold && bracket?.medals?.silver && bracket?.medals?.bronze ? `The final medal order: gold ${bracket.medals.gold.name}, silver ${bracket.medals.silver.name}, bronze ${bracket.medals.bronze.name}.` : null
  ]);
  section('Who delivered', [
    `${wTop[0].name} led ${winner.name} with ${line(wTop[0])}${wTop[1] ? `, and ${wTop[1].name} added ${wTop[1].pts} points` : ''}.`,
    `For ${loser.name}, ${lTop[0].name} finished with ${line(lTop[0])}${lTop[1] ? ` and ${lTop[1].name} scored ${lTop[1].pts}` : ''}.`
  ]);
  section('WNBA players in the game', wnbaPlayers.length ? [
    `${wnbaPlayers.length === 1 ? 'One WNBA player' : `${wnbaPlayers.length} WNBA players`} logged minutes: ${listJoin(wnbaPlayers.sort((a, b) => b.pts - a.pts).map((p) => `${p.name} (${p.team.country_code}, ${p.wnba.wnba_team?.name || 'WNBA'}) ${p.pts} points in ${p.min} minutes`))}.`,
    `Each is linked to her PropBetEdge WNBA profile by an identical ESPN athlete ID, and her full international game log sits on the international player page.`
  ] : [`No player on a current WNBA roster logged minutes in this game.`]);
  section('Box score context', [
    `${winner.name} shot ${box(winner).totals.fgm} of ${box(winner).totals.fga} from the field and ${box(winner).totals.fg3m} of ${box(winner).totals.fg3a} from three, with ${box(winner).totals.reb} rebounds and ${box(winner).totals.tov} turnovers; ${loser.name} shot ${box(loser).totals.fgm} of ${box(loser).totals.fga} and ${box(loser).totals.fg3m} of ${box(loser).totals.fg3a} from three, with ${box(loser).totals.reb} rebounds and ${box(loser).totals.tov} turnovers.`
  ]);

  const facts = {
    international: { competition_id: comp.competition_id, game_id: g.game_id, round: g.round, scores: { winner: ws, loser: ls }, medals: bracket?.medals ? { gold: bracket.medals.gold?.name || null, silver: bracket.medals.silver?.name || null, bronze: bracket.medals.bronze?.name || null } : null },
    box: detail.boxscore.teams.map((t) => ({ team: t.team.name, totals: t.totals, players: t.players.map((p) => ({ name: p.name, min: p.min, pts: p.pts, reb: p.reb, ast: p.ast })) })),
    wnba_players: wnbaPlayers.map((p) => ({ name: p.name, min: p.min, pts: p.pts, wnba_team: p.wnba.wnba_team?.name || null })),
    wnba_player_count: wnbaPlayers.length,
    wnba_minutes_total: wnbaPlayers.reduce((s, p) => s + p.min, 0)
  };
  const input_hash = [INTL_VERSION, g.game_id, ws, ls, ...detail.boxscore.teams.map((t) => `${t.team.team_id}:${t.totals.fgm}/${t.totals.fga}:${t.players.map((p) => `${p.player_id}=${p.pts}`).join(',')}`)].join('|');
  const minutes = wnbaPlayers.reduce((s, p) => s + p.min, 0);

  return finalize({
    id: await hashId(['intl-result', g.game_id]),
    kind: 'international',
    category: 'International',
    structure: 0,
    headline,
    deck,
    body,
    sections,
    method: [
      `Built by PropBetEdge from the ${comp.name} game record and box score (ESPN public data, not an official FIBA feed), normalized by the PropBetEdge international data service. One story per medal game; later box-score corrections revise it in place.`
    ],
    bettor: [wnbaPlayers.length
      ? `For WNBA bettors this is workload and form context, not a market signal: the ${wnbaPlayers.length} WNBA players here logged ${minutes} combined minutes in a medal game before rejoining their clubs.`
      : `For WNBA bettors this result is international context only: no current WNBA player logged minutes, so nothing here bears on a WNBA line or prop.`],
    against: ['National-team roles, minutes and systems differ from WNBA roles, so an international line is not a projection for a WNBA game.'],
    unknown: [wnbaPlayers.length ? `When each WNBA player in this game rejoins her club, and whether the tournament workload shows up in her next WNBA minutes.` : 'Whether any player in this game joins a WNBA roster later.'],
    markets: ['player_workload'],
    market_angle: { text: [], market: null, game_id: null },
    lead_team_id: null,
    lead_player_id: lead ? lead.wnba.wnba_player_id : null,
    primary_subject: winner.name,
    published_at: new Date(Date.parse(g.scheduled_at) + GAME_LENGTH_MS).toISOString(),
    context: { international: { competition: { slug: comp.slug, name: comp.name }, game_id: g.provider_ids?.espn, winner: { name: winner.name, slug: winner.slug }, loser: { name: loser.name, slug: loser.slug } } },
    entities: [
      ...wnbaPlayers.map((p) => ({ type: 'player', id: p.wnba.wnba_player_id, name: p.name })),
      { type: 'intl_game', id: String(g.provider_ids?.espn), name: `${g.away_team.name} vs ${g.home_team.name}` },
      { type: 'intl_team', id: winner.slug, name: winner.name },
      { type: 'intl_team', id: loser.slug, name: loser.name }
    ],
    facts,
    evidence: [
      { kind: 'record', source: `${comp.name} game record and box score (ESPN public data)`, url: `https://wnba.propbetedge.ai/international/games/${g.provider_ids?.espn}`, captured_at: detail.fetched_at || null, record: { final: { [winner.name]: ws, [loser.name]: ls }, round: g.round_name } },
      { kind: 'record', source: 'PropBetEdge international ↔ WNBA crosswalk (identical ESPN athlete IDs)', url: `https://wnba.propbetedge.ai/international/${comp.slug}`, record: { wnba_players: wnbaPlayers.length } }
    ],
    input_hash
  });
}
