// International desk — deterministic PropBetEdge game stories from wnba-international structured data.
//
// wnba-international-desk/2.0.0:
//   * Material events: knockout games (qualification round, quarterfinal, semifinal, bronze, final) that went final
//     within the last 12 hours. One story per game (id = hash of the game id): later data revises it; a game that
//     finished earlier is never promoted into a "new" story after the fact. A backfill pass may REGENERATE a story
//     that already exists (same id, slug and origin), never create one.
//   * The article is written by game-story.js from the game record, linescores, box score, play-by-play (when the
//     provider publishes it), the competition schedule and earlier box scores — see that module for the fact contract.
//   * Participation is read from the box score itself (ESPN's FIBA feed omits minutes), so a current WNBA player who
//     played is never reported as absent.
//   * Betting relevance is not decided here: finalize() applies the shared PropBetEdge Intelligence decision. This
//     desk supplies no betting copy — the WNBA connection, when there is one, is part of the article.
//   * Provenance: `published_at` is the moment the source record was observed (never an estimated game end), and the
//     generation cutoff is taken after every input has been gathered.

import { finalize, hashId } from './articles.js';
import { buildGameFacts, writeGameStory, depthFailures, wordCount, GAME_STORY_VERSION, participated } from './game-story.js';

export const INTL_VERSION = 'wnba-international-desk/2.0.0';
export const INTL_STORY_WINDOW_MS = 12 * 3600e3;
const GAME_LENGTH_MS = 2.5 * 3600e3;
export const MATERIAL_ROUNDS = new Set(['FINAL', 'BRONZE', 'SF', 'QF', 'QQF']);

/** Knockout games finished within the window, newest first. `now` is injected for tests. */
export function materialInternationalGames(overview, now = Date.now()) {
  const games = [...(overview?.bracket?.rounds || []).flatMap((r) => r.games), overview?.bracket?.bronze_game].filter(Boolean);
  const seen = new Set();
  return games
    .filter((g) => { const k = g.game_id || g.provider_ids?.espn; if (seen.has(k)) return false; seen.add(k); return true; })
    .filter((g) => MATERIAL_ROUNDS.has(g.round) && g.status === 'final' && g.winner)
    .filter((g) => { const end = Date.parse(g.scheduled_at) + GAME_LENGTH_MS; return now - end <= INTL_STORY_WINDOW_MS && now >= Date.parse(g.scheduled_at); })
    .sort((a, b) => Date.parse(b.scheduled_at) - Date.parse(a.scheduled_at));
}

/** The story id for a game — stable across regenerations. */
export const intlStoryId = (espnId) => hashId(['intl-result', `g-${String(espnId).replace(/^g-/, '')}`]);

/**
 * @param intlGet  (path) => data
 * @param now      run instant (window test)
 * @param backfill optional Set of ESPN game ids whose EXISTING stories should be regenerated regardless of the window
 * @param clock    () => ISO — the generation cutoff, read after inputs are gathered (injectable for tests)
 */
export async function internationalArticles({ intlGet, now = Date.now(), competitions = ['world-cup-2026'], backfill = null, clock = () => new Date().toISOString() }) {
  if (!intlGet) return [];
  const out = [];
  for (const slug of competitions) {
    const ov = await intlGet(`/v1/international/competitions/${slug}`).catch(() => null);
    if (!ov?.competition || !ov.bracket) continue;
    const fresh = materialInternationalGames(ov, now);
    const all = [...(ov.bracket.rounds || []).flatMap((r) => r.games), ov.bracket.bronze_game].filter(Boolean);
    const extra = backfill ? all.filter((g) => backfill.has(String(g.provider_ids?.espn)) && g.status === 'final' && !fresh.includes(g)) : [];
    const targets = [...fresh, ...extra];
    if (!targets.length) continue;
    const schedule = (await intlGet(`/v1/international/competitions/${slug}/schedule`).catch(() => null))?.games || [];
    for (const g of targets) {
      const espn = g.provider_ids?.espn;
      const detail = await intlGet(`/v1/international/games/${espn}`).catch(() => null);
      if (!detail?.game || detail.game.status !== 'final') continue;
      if (detail.plays_available && !(detail.plays || []).length) detail.plays = (await intlGet(`/v1/international/games/${espn}/playbyplay`).catch(() => null))?.plays || [];
      else if (detail.plays_available) {
        // The detail route caps plays; the play-by-play route carries the whole game.
        const full = (await intlGet(`/v1/international/games/${espn}/playbyplay`).catch(() => null))?.plays;
        if (full?.length > (detail.plays || []).length) detail.plays = full;
      }
      const priorDetails = {};
      const teams = [detail.game.home_team_id, detail.game.away_team_id];
      for (const x of schedule.filter((s) => s.status === 'final' && Date.parse(s.scheduled_at) < Date.parse(detail.game.scheduled_at) && teams.some((t) => [s.home_team_id, s.away_team_id].includes(t)))) {
        const d = await intlGet(`/v1/international/games/${x.provider_ids?.espn}`).catch(() => null);
        if (d?.boxscore) priorDetails[x.provider_ids.espn] = d;
      }
      const cutoff = clock();
      const story = await storyFor({ competition: ov.competition, detail, schedule, priorDetails, medals: ov.bracket.medals, cutoff, backfill: extra.includes(g) });
      if (story) out.push(story);
    }
  }
  return out;
}

/** Build one game story. Exported for tests and the regeneration audit. */
export async function storyFor({ competition, detail, schedule = [], priorDetails = {}, medals = null, cutoff, backfill = false }) {
  const built = buildGameFacts({ competition, detail, schedule, priorDetails, cutoff, medals });
  if (built.error) return null;
  const f = built.facts;
  const g = detail.game;
  const story = writeGameStory(f);
  const espn = String(g.provider_ids?.espn || g.game_id).replace(/^g-/, '');
  const wnbaPlayers = (f.wnba || []).filter((p) => p.wnba?.player_id);
  const observed = f.provenance.source_observed_at || cutoff;

  const a = finalize({
    id: await intlStoryId(espn),
    kind: 'international',
    category: 'International',
    structure: 0,
    headline: story.headline,
    deck: story.deck,
    body: story.body,
    sections: story.sections,
    method: [
      `Built by PropBetEdge from the ${competition.name} game record${f.quarters ? ', quarter scores' : ''}, box score${f.pbp ? `, ${f.provenance.plays_used} play-by-play events` : ''} and the competition schedule (ESPN public data, not an official FIBA feed), normalized by the PropBetEdge international data service.`,
      `Derived figures — margins, separators, runs, lead changes and earlier-game averages — are computed deterministically from those records. Participation is read from the box score; ${f.minutes_published ? 'minutes are as published' : 'this box score publishes no minutes, so none are stated'}.${f.pbp ? '' : ' No play-by-play was published for this game when the story was generated, so the game flow is told from quarter scores.'}`,
      'One story per knockout game; later box-score or play-by-play updates revise it in place.'
    ],
    bettor: [],
    against: [],
    unknown: [],
    markets: [],
    market_angle: { text: [], market: null, game_id: null },
    lead_team_id: null,
    lead_player_id: null,
    primary_subject: f.winner.name,
    // The source clock is when the record was observed — never an estimated end of game.
    published_at: observed,
    provenance: { source_event_at: f.provenance.source_event_at, source_observed_at: observed, generated_at: cutoff, generator: GAME_STORY_VERSION },
    context: {
      international: {
        competition: { slug: competition.slug, name: competition.name, short_name: competition.short_name || null },
        game_id: espn,
        round: { code: g.round, name: g.round_name },
        story_class: f.story_class,
        winner: { name: f.winner.name, slug: f.winner.slug, code: f.winner.code, flag: f.winner.flag, color: f.winner.color, score: f.winner.score },
        loser: { name: f.loser.name, slug: f.loser.slug, code: f.loser.code, flag: f.loser.flag, color: f.loser.color, score: f.loser.score },
        medal: f.medal?.winner || null,
        // Players the article features, in editorial order, for the media resolver (approved photo of a real subject).
        featured: [...(f.lines?.winner || []).slice(0, 4), ...(f.lines?.loser || []).slice(0, 2)].filter((p) => story.body.some((t) => t.includes(p.name))).map((p) => ({ espn_id: p.espn_id, name: p.name, team: p.team }))
      },
      depth: { words: wordCount(story.body), coverage: story.coverage, story_class: f.story_class },
      regeneration: backfill ? 'editorial_upgrade' : null
    },
    entities: [
      // A `player` entity is emitted only for a current WNBA roster player who appeared — the shared relevance decision
      // reads these, so participation (not minutes) decides whether a WNBA connection exists.
      ...wnbaPlayers.map((p) => ({ type: 'player', id: p.wnba.player_id, name: p.name })),
      { type: 'intl_game', id: espn, name: `${g.away_team.name} vs ${g.home_team.name}` },
      { type: 'intl_team', id: f.winner.slug, name: f.winner.name },
      { type: 'intl_team', id: f.loser.slug, name: f.loser.name }
    ],
    facts: { game: f, box_lines: f.box_lines, headline_stat: f.headline_stat, wnba_player_count: wnbaPlayers.length },
    evidence: [
      { kind: 'record', source: `${competition.name} game record, quarter scores and box score (ESPN public data)`, url: `https://wnba.propbetedge.ai/international/games/${espn}`, event_at: g.scheduled_at, captured_at: observed, record: { final: { [f.winner.name]: f.winner.score, [f.loser.name]: f.loser.score }, round: g.round_name } },
      ...(f.pbp ? [{ kind: 'record', source: `${competition.name} play-by-play (${f.provenance.plays_used} events)`, url: `https://wnba.propbetedge.ai/international/games/${espn}`, captured_at: observed, record: { lead_changes: f.pbp.lead_changes, ties: f.pbp.ties } }] : []),
      ...(f.path?.winner?.games?.length ? [{ kind: 'record', source: `${competition.name} schedule and results`, url: `https://wnba.propbetedge.ai/international/${competition.slug}/games`, captured_at: observed, record: { games_before: f.path.winner.games.length + f.path.loser.games.length } }] : []),
      { kind: 'record', source: 'PropBetEdge international ↔ WNBA crosswalk (identical ESPN athlete IDs)', url: `https://wnba.propbetedge.ai/international/${competition.slug}/players`, captured_at: observed, record: { wnba_players_appeared: wnbaPlayers.length } }
    ],
    input_hash: [INTL_VERSION, GAME_STORY_VERSION, espn, f.winner.score, f.loser.score, f.provenance.plays_used, ...(detail.boxscore?.teams || []).map((t) => `${t.team.team_id}:${t.totals.fgm}/${t.totals.fga}:${t.players.filter(participated).map((p) => `${p.player_id}=${p.pts}`).join(',')}`), f.champion ? `${f.champion.gold}>${f.champion.silver}` : ''].join('|')
  });
  a.depth_failures = depthFailures({ facts: f, coverage: story.coverage, body: story.body, sections: story.sections });
  if (a.depth_failures.length) { a.status = 'held'; a.gate.ok = false; a.gate.failures.push(...a.depth_failures); }
  return a;
}
