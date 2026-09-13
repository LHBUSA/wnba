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

