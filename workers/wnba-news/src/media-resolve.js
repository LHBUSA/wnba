// Pure media resolution helpers (no manifest import), shared by media.js and the tests.

/** An approved newsroom photo subject from the manifest's player map, or null. */
export function subjectFrom(PLAYERS, pid) {
  const e = pid !== null && pid !== undefined ? PLAYERS[String(pid)] : null;
  if (!e || !e.slots?.wide?.length) return null;
  return {
    player_id: String(pid),
    name: e.name,
    team_id: String(e.team_id),
    team_abbr: e.team_abbr,
    wide: e.slots.wide,
    half: e.slots.half || [],
    og: e.slots.og?.[0]?.src || null,
    square: `/media/players/${pid}/square.webp`,
    credit: { author: e.artist || null, license: e.license, license_url: e.license_url || null, source_page: e.source_page_url, text: e.attribution }
  };
}


/**
 * International story media. Priority:
 *   A/B  an approved Wikimedia Commons photograph of a player the article features, resolved by ESPN athlete id (the
 *        same person across WNBA and FIBA records) in the article's editorial order — winner's featured players first;
 *        never a player who does not appear in the story;
 *   C    the deterministic PropBetEdge International scoreboard: public-domain national flags, team names, the score,
 *        round/medal and competition, rendered by the site (story-media.js) and the share-card renderer;
 * Both carry `visual`, so cards, heroes and share images show the same game identity.
 */
export function internationalMediaFrom(PLAYERS, a) {
  const ctx = a.context?.international || a.intl || null;
  if (!ctx?.winner || !ctx?.loser) return null;
  const side = (t) => ({ name: t.name, code: t.code || null, flag: t.flag || null, color: t.color || null, score: t.score ?? null });
  const visual = {
    kind: 'intl_scoreboard',
    competition: ctx.competition?.short_name || ctx.competition?.name || null,
    competition_name: ctx.competition?.name || null,
    round: ctx.round?.name || null,
    medal: ctx.medal || null,
    status: 'Final',
    teams: [side(ctx.winner), side(ctx.loser)]
  };
  const pick = (ctx.featured || []).map((p) => ({ p, s: subjectFrom(PLAYERS, p.espn_id) })).find((x) => x.s);
  if (pick) return { layout: 'intl_photo', subjects: [{ ...pick.s, national_team: pick.p.team }], teams: [], visual, caption: `Pictured: ${pick.s.name}`, og: pick.s.og, resolved: 'approved_subject_photo' };
  return { layout: 'intl_game', subjects: [], teams: [], visual, caption: null, og: null, resolved: 'deterministic_scoreboard' };
}


const SINGLE = new Set(['injury', 'transaction', 'performance', 'result', 'props', 'brief']);
const MATCHUP = new Set(['preview', 'market']);
const DESK_VISUAL = { injury: 'Injury Desk', transaction: 'Roster Moves', performance: 'Game Recap', result: 'Game Recap', preview: 'Matchup Preview', trend: 'Team Trends', props: 'Prop Watch', market: 'Market Watch', brief: 'News Brief', international: 'International' };
const idsOf = (xs) => xs.filter((x) => x !== null && x !== undefined && x !== '').map(String);

/**
 * Newsroom story media for every desk. Priority, per story type:
 *   1. an approved photograph of the story's own subject (single-subject desks), or one approved photo per team for a
 *      matchup — never a stand-in;
 *   2. an approved team composition (the story's team marks and colours);
 *   3. the deterministic PropBetEdge WNBA story visual (desk label + brand), for league-wide stories with no team.
 * International games use internationalMediaFrom. No standalone story resolves to a blank hero.
 */
export function newsroomMediaFrom(PLAYERS, a) {
  if (a.kind === 'international') {
    const m = internationalMediaFrom(PLAYERS, a);
    if (m) return m;
  }
  const subject = (pid) => subjectFrom(PLAYERS, pid);
  const ents = (a.entities || []).filter(Boolean);
  const teamIds = ents.filter((e) => e.type === 'team').map((e) => e.id);
  const brand = () => ({ layout: 'brand', subjects: [], teams: [], caption: null, og: null, visual: { kind: 'brand', desk: DESK_VISUAL[a.kind] || 'WNBA Newsroom' }, resolved: 'deterministic_story_visual' });
  if (SINGLE.has(a.kind)) {
    const s = subject(a.lead_player_id);
    if (s) return { layout: 'single', subjects: [s], teams: idsOf([s.team_id]), caption: `Pictured: ${s.name}`, og: s.og, resolved: 'approved_subject_photo' };
    const teams = idsOf([a.lead_team_id, ...teamIds]).slice(0, 1);
    return teams.length ? { layout: 'team', subjects: [], teams, caption: null, og: null, resolved: 'team_composition' } : brand();
  }
  if (MATCHUP.has(a.kind)) {
    const g = a.context?.game || a.context?.next_game || null;
    const away = String(a.matchup?.away_team_id ?? g?.away?.team_id ?? teamIds[0] ?? '');
    const home = String(a.matchup?.home_team_id ?? g?.home?.team_id ?? teamIds[1] ?? '');
    const pick = (tid) => ents.filter((e) => e.type === 'player').map((e) => subject(e.id)).find((s) => s && s.team_id === tid) || null;
    const A = away ? pick(away) : null;
    const H = home ? pick(home) : null;
    if (A && H) return { layout: 'matchup', subjects: [A, H], teams: [away, home], caption: `Pictured: ${A.name} (${A.team_abbr}) and ${H.name} (${H.team_abbr})`, og: H.og, resolved: 'approved_subject_photos' };
    const teams = idsOf([away, home]);
    return teams.length ? { layout: 'team_matchup', subjects: [], teams, caption: null, og: null, resolved: 'team_composition' } : brand();
  }
  const teams = idsOf([a.lead_team_id, ...teamIds]).slice(0, 1);
  return teams.length ? { layout: 'team', subjects: [], teams, caption: null, og: null, resolved: 'team_composition' } : brand();
}
