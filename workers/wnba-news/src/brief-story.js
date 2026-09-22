// WNBA source-brief story planner — reader-first sports journalism from grounded facts.
//
// Inputs are already verified/linked by briefs-core.js. This module decides how
// those facts become an article. Publisher metadata stays in evidence; the body
// leads with the basketball event and uses source attribution only where needed.

import { dLong, dMonth, tET, f1, nick, poss, wordN, listJoin } from './prose.js';

export const BRIEF_STORY_VERSION = 'wnba-brief-story/1.1.0';

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const score = (s) => String(s || '').replace('-', '–');

function sectioner() {
  const body = [];
  const sections = [];
  const add = (title, key, paras) => {
    const ps = (paras || []).filter(Boolean).map(clean).filter(Boolean);
    if (!ps.length) return;
    sections.push({ title, key, first: body.length, count: ps.length });
    body.push(...ps);
  };
  return { body, sections, add };
}

function reportSentence(source, sourceAt, others = [], noun = 'development') {
  const names = [...new Set([source, ...others.map((x) => x.publisher)].filter(Boolean))];
  if (names.length <= 1) return `${source} reported the ${noun} on ${dLong(sourceAt)}.`;
  if (names.length === 2) return `${source} and ${names[1]} both reported the ${noun} on ${dLong(sourceAt)}.`;
  return `${source} first reported the ${noun} on ${dLong(sourceAt)}; ${listJoin(names.slice(1, 4))} also reported the same development.`;
}

function seasonSentence(pn, tn, s) {
  if (!pn || !s) return null;
  return `${pn} has averaged ${f1(s.pts)} points, ${f1(s.reb)} rebounds and ${f1(s.ast)} assists in ${f1(s.min)} minutes across ${s.games} games${tn ? ` for the ${tn}` : ''} this season.`;
}

function recentSentence(pn, s) {
  if (!pn || !s?.last5) return null;
  const delta = Number.isFinite(s.pts) && Number.isFinite(s.last5.pts) ? s.last5.pts - s.pts : null;
  const comparison = Number.isFinite(delta) && Math.abs(delta) >= 0.1
    ? ` — ${f1(Math.abs(delta))} ${delta >= 0 ? 'above' : 'below'} her season scoring average`
    : '';
  return `Over her last five games, ${pn} is averaging ${f1(s.last5.pts)} points in ${f1(s.last5.min)} minutes${comparison}.`;
}

function roleSentence(pn, tn, v) {
  if (!pn || !tn || !v?.role) return null;
  const r = v.role;
  const rank = r.min_rank === 1 ? 'the most' : `No. ${r.min_rank}`;
  return `Over the ${poss(nick(v.team || { name: tn }))} last ${wordN(r.sample)} completed games, ${pn} averaged ${f1(r.min)} minutes — ${rank} on the team in that window — and ${r.starts ? `started ${wordN(r.starts)} of her ${wordN(r.appearances)} appearances` : `came off the bench in her ${wordN(r.appearances)} appearances`}.`;
}

function standingSentence(tn, st) {
  if (!tn || !st) return null;
  return `The ${tn} are ${st.wins}–${st.losses}${st.seed ? `, No. ${st.seed} in the ${st.conference_name || 'conference'}` : ''}${st.last_ten ? `, with a ${st.last_ten} record over their last 10 games` : ''}.`;
}

function nextGameSentence(tn, ng) {
  if (!tn || !ng) return null;
  return `The ${tn} next play ${ng.home ? `the ${ng.opponent} at home` : `at the ${ng.opponent}`} on ${dLong(ng.start_utc)} at ${tET(ng.start_utc)}${ng.opponent_record ? `; the ${ng.opponent} enter at ${ng.opponent_record.wins}–${ng.opponent_record.losses}` : ''}.`;
}

function recordComparison(headline, playerName) {
  const h = String(headline || '');
  const m = h.match(/\b(?:breaks?|passes?|surpasses?)\s+([A-Z][A-Za-z’'.-]+(?:\s+[A-Z][A-Za-z’'.-]+){1,2})(?:[’']s)\b/);
  const name = m?.[1]?.trim();
  return name && name !== playerName ? name : null;
}

function awardName(headline) {
  const h = String(headline || '');
  const rules = [
    [/rookie of the year/i, 'WNBA Rookie of the Year'],
    [/defensive player of the year/i, 'WNBA Defensive Player of the Year'],
    [/most improved player/i, 'WNBA Most Improved Player'],
    [/sixth (?:player|woman) of the year/i, 'WNBA Sixth Player of the Year'],
    [/coach of the year/i, 'WNBA Coach of the Year'],
    [/most valuable player|\bMVP\b/i, 'WNBA MVP'],
    [/all[- ]wnba/i, 'All-WNBA honors']
  ];
  return rules.find(([re]) => re.test(h))?.[1] || 'WNBA honors';
}

function recordStory({ source, sourceHeadline, sourceAt, others, player, v }) {
  const { body, sections, add } = sectioner();
  const pn = player?.name || 'The player';
  const tn = v.team?.name || null;
  const r = v.record;
  const g = r?.game;
  const prior = recordComparison(sourceHeadline, pn);
  const milestone = r?.kind === 'season-points' ? `${r.claimed} season points` : r?.claim || 'the milestone';

  const headline = r?.kind === 'season-points' && /rookie.*scor|rookie.*point/i.test(sourceHeadline)
    ? `${pn} breaks WNBA rookie scoring record with ${r.claimed}th point`
    : `${pn} reaches ${milestone} in record-setting season`;

  const deck = g
    ? `${pn} scored ${g.pts} points in ${tn ? `${tn}’s ` : ''}${score(g.score)} ${g.result === 'W' ? 'win' : 'game'} ${g.at_vs === 'vs' ? 'against' : 'at'} the ${g.opponent}, reaching ${r.claimed || milestone}${prior ? ` and moving past ${prior}` : ''}.`
    : `${pn} reached ${milestone}${prior ? `, moving past ${prior}` : ''} in the rookie record book.`;

  const lede = g
    ? `${pn} reached ${milestone} on ${dMonth(g.date)}, scoring ${g.pts} points in ${tn ? `${tn}’s ` : ''}${score(g.score)} ${g.result === 'W' ? 'win' : 'game'} ${g.at_vs === 'vs' ? 'against' : 'at'} the ${g.opponent}${prior ? ` and moving past ${prior} for the WNBA rookie scoring mark` : ''}.`
    : `${pn} reached ${milestone}${prior ? ` and moved past ${prior}` : ''} in the WNBA record book.`;

  add('The record night', 'change', [
    lede,
    g ? `She finished with ${g.pts} points${Number.isFinite(g.reb) ? `, ${g.reb} rebounds` : ''}${Number.isFinite(g.ast) ? ` and ${g.ast} assists` : ''} in ${g.min} minutes.` : null
  ]);
  add(`How ${pn.split(' ').at(-1)} got there`, 'records', [
    seasonSentence(pn, tn, v.season),
    recentSentence(pn, v.season),
    r?.kind && r.kind !== 'season-points' && Number.isFinite(r.season_count) && Number.isFinite(r.games)
      ? `Across the full regular-season log, that was ${pn.split(' ').at(-1)}’s ${r.season_count}th ${r.kind} in ${r.games} games. The count places the milestone inside a season-long pattern rather than treating the record night as an isolated box score.`
      : r?.kind === 'season-points' && Number.isFinite(r.games)
        ? `The threshold came within a ${r.games}-game regular-season log, giving the scoring milestone a full-season sample rather than a one-game frame.`
        : null
  ]);
  add(prior ? `The mark ${pn.split(' ').at(-1)} passed` : 'The milestone in context', 'history', [
    reportSentence(source, sourceAt, others, prior ? `record change involving ${pn} and ${prior}` : `record milestone for ${pn}`)
  ]);
  return { headline, deck, body, sections };
}

function injuryStory({ source, sourceAt, others, player, v, type }) {
  const { body, sections, add } = sectioner();
  const pn = player?.name || 'The player';
  const tn = v.team?.name || 'her team';
  const status = v.injury?.status || (type === 'availability' ? 'an updated availability status' : 'an injury update');
  const part = v.injury?.body_part ? ` with a ${String(v.injury.body_part).toLowerCase()} issue` : '';
  const minutes = Number.isFinite(v.role?.min) ? f1(v.role.min) : Number.isFinite(v.season?.min) ? f1(v.season.min) : null;
  const headline = minutes ? `${pn} listed ${String(status).toLowerCase()}; the ${tn} may need to cover ${minutes} minutes` : `${pn} listed ${String(status).toLowerCase()} for the ${tn}`;
  const deck = v.season
    ? `${pn} is averaging ${f1(v.season.pts)} points in ${f1(v.season.min)} minutes this season. If she sits, those minutes have to move elsewhere in the ${tn} rotation.`
    : `${pn} has a new availability update ahead of the ${tn}’s next game.`;

  add(`${pn.split(' ').at(-1)}’s status`, 'change', [
    v.injury
      ? `${pn} is listed ${String(status).toLowerCase()}${part} on ESPN’s WNBA injury feed${v.injury?.source_updated_at ? `, updated ${dLong(v.injury.source_updated_at)}` : ''}.`
      : `${pn} is at the center of a new injury report for the ${tn}, putting her status for the next game in doubt.`,
    reportSentence(source, sourceAt, others, `injury update involving ${pn}`),
    !v.injury
      ? `The next thing to watch is whether ${pn} plays. If she does not, the ${tn} will have to redistribute the minutes that normally come with her role.`
      : null
  ]);
  add('Her role', 'records', [seasonSentence(pn, tn, v.season), roleSentence(pn, tn, v)]);
  add('Who could pick up the minutes', 'why', [
    v.role && minutes ? `${pn} has been playing roughly ${minutes} minutes a night recently. If she is unavailable, that is a meaningful chunk of the rotation for the ${tn} to replace.` : null,
    standingSentence(tn, v.standing)
  ]);
  add('Next game', 'next', [nextGameSentence(tn, v.next_game)]);
  return { headline, deck, body, sections };
}

function transactionStory({ source, sourceAt, others, player, v, type }) {
  const { body, sections, add } = sectioner();
  const pn = player?.name || 'The player';
  const tn = v.team?.name || 'the team';
  const headline = type === 'trade'
    ? `${pn} trade reshapes the ${tn} rotation`
    : type === 'signing'
      ? `${tn} sign ${pn}, adding another option to the rotation`
      : type === 'waiver'
        ? `${tn} waive ${pn}, opening a spot in the rotation`
        : `${tn} make roster move involving ${pn}`;
  const deck = v.season
    ? `${pn} is averaging ${f1(v.season.pts)} points in ${f1(v.season.min)} minutes per game, giving the ${tn} a clear recent baseline for the move.`
    : `${pn} is part of a new ${tn} roster move. Her actual role will become clearer once the next rotation takes the floor.`;

  add('The move', 'change', [
    v.transaction
      ? `ESPN’s WNBA transactions log records the move on ${dMonth(v.transaction.date)}: ${String(v.transaction.description).replace(/\.$/, '')}.`
      : `${pn} is part of a reported roster move involving the ${tn}. The next question is simply where she fits in the rotation.`,
    reportSentence(source, sourceAt, others, `roster move involving ${pn}`),
    !v.transaction && !v.season
      ? `The move is official in the reporting, but the basketball role is still open. Minutes, lineup position and usage will become clearer once ${pn} enters the ${tn} rotation.`
      : null
  ]);
  add('Where she fits', 'records', [seasonSentence(pn, tn, v.season), recentSentence(pn, v.season), roleSentence(pn, tn, v)]);
  add(`The ${nick(v.team || { name: tn })} context`, 'team', [
    standingSentence(tn, v.standing),
    v.role ? `${pn} has had a real recent workload, so this move is likely to be felt in the rotation rather than only at the end of the bench.` : null
  ]);
  add('Next game', 'next', [
    nextGameSentence(tn, v.next_game),
    v.next_game ? `That game should give the first useful look at ${pn}’s place in the ${nick(v.team || { name: tn })} rotation.` : null
  ]);
  return { headline, deck, body, sections };
}

function lineupStory({ source, sourceAt, others, player, v }) {
  const { body, sections, add } = sectioner();
  const pn = player?.name || 'The player';
  const tn = v.team?.name || 'the team';
  const headline = `${pn} lineup change puts the ${tn} rotation in focus`;
  const deck = v.role
    ? `${pn} has averaged ${f1(v.role.min)} minutes in the recent rotation, making the reported lineup change a real shift in how the ${tn} allocate playing time.`
    : `The ${tn} have a reported lineup change involving ${pn}.`;
  add('The lineup change', 'change', [
    `${pn} is at the center of a reported lineup change for the ${tn}.`,
    reportSentence(source, sourceAt, others, `lineup change involving ${pn}`)
  ]);
  add('The minutes behind it', 'records', [roleSentence(pn, tn, v), seasonSentence(pn, tn, v.season)]);
  add('Next game', 'next', [nextGameSentence(tn, v.next_game)]);
  return { headline, deck, body, sections };
}

function awardsStory({ source, sourceHeadline, sourceAt, others, player, v }) {
  const { body, sections, add } = sectioner();
  const pn = player?.name || 'The player';
  const tn = v.team?.name || null;
  const award = awardName(sourceHeadline);
  const won = /\b(wins?|named|earns?|receives?|voted)\b/i.test(sourceHeadline);
  const headline = won ? `${pn} earns ${award}` : `${pn} enters the ${award} conversation`;
  const deck = v.season
    ? `${pn}’s season line — ${f1(v.season.pts)} points, ${f1(v.season.reb)} rebounds and ${f1(v.season.ast)} assists per game — supplies the basketball context behind the honor.`
    : `${pn} is at the center of a new ${award} development.`;
  add(won ? 'The honor' : 'The awards development', 'change', [
    won ? `${pn} has been named ${award}.` : `${pn} is at the center of a reported ${award} development.`,
    reportSentence(source, sourceAt, others, won ? `${award} honor` : `${award} development`)
  ]);
  add('The season behind it', 'records', [seasonSentence(pn, tn, v.season), recentSentence(pn, v.season)]);
  add(tn ? `Her role with ${nick(v.team)}` : 'Her role', 'team', [roleSentence(pn, tn, v), standingSentence(tn, v.standing)]);
  return { headline, deck, body, sections };
}

function draftStory({ source, sourceAt, others, player, v }) {
  const { body, sections, add } = sectioner();
  const pn = player?.name || 'The player';
  const tn = v.team?.name || null;
  const headline = `${pn} enters the WNBA draft picture${tn ? ` with ${tn} context` : ''}`;
  const deck = v.bio
    ? `${pn} is a ${[v.bio.height, v.bio.position?.toLowerCase()].filter(Boolean).join(' ')}${v.bio.college ? ` from ${v.bio.college}` : ''}; her current WNBA record supplies the context around the reported draft development.`
    : `${pn} is at the center of a new WNBA draft development.`;
  add('The draft development', 'change', [
    `${pn} is at the center of a new WNBA draft development.`,
    reportSentence(source, sourceAt, others, `draft development involving ${pn}`)
  ]);
  add('The player profile', 'records', [
    v.bio && (v.bio.height || v.bio.position) ? `${pn} is listed as a ${[v.bio.height, v.bio.position?.toLowerCase()].filter(Boolean).join(' ')}${v.bio.college ? ` from ${v.bio.college}` : ''}${Number.isFinite(v.bio.age) ? `, age ${v.bio.age}` : ''}.` : null,
    seasonSentence(pn, tn, v.season),
    roleSentence(pn, tn, v)
  ]);
  if (tn) add(`The ${nick(v.team)} fit`, 'team', [standingSentence(tn, v.standing)]);
  return { headline, deck, body, sections };
}

function teamChangeStory({ source, sourceAt, others, team, v, type }) {
  const { body, sections, add } = sectioner();
  const tn = v.team?.name || team?.name || 'The team';
  const label = type === 'coaching' ? 'coaching change' : 'front-office change';
  const headline = `${tn} make ${label}: the roster the move inherits`;
  const deck = v.core?.length
    ? `${listJoin(v.core.map((r) => r.name))} carry the heaviest recent minutes as the ${tn} move into a new ${type === 'coaching' ? 'coaching' : 'front-office'} phase.`
    : `The ${tn} are moving through a reported ${label}.`;
  add(cap(label), 'change', [
    `The ${tn} are making a ${label}, changing the leadership structure around a roster with established rotation roles and a season already in progress.`,
    reportSentence(source, sourceAt, others, `${label} for the ${tn}`)
  ]);
  add('The roster it inherits', 'context', [
    v.core?.length ? `Over the last ${wordN(v.core_sample)} games, the heaviest minutes belong to ${listJoin(v.core.map((r) => `${r.name} (${f1(r.min)} minutes, ${f1(r.pts)} points)`))}.` : null,
    v.core?.length >= 2
      ? `That recent workload gives the incoming leadership a clear on-court baseline: ${v.core[0].name} and ${v.core[1].name} are carrying the two largest minute loads in the observed rotation, while the rest of the roster fits around those established roles.`
      : null,
    standingSentence(tn, v.standing)
  ]);
  add('Recent roster movement', 'records', [
    ...(v.team_moves || []).slice(0, 3).map((m) => `On ${dMonth(m.date)}, the transactions log recorded: ${String(m.description).replace(/\.$/, '')}.`)
  ]);
  add('Next game', 'next', [
    nextGameSentence(tn, v.next_game),
    v.next_game ? `That game is the first scheduled look at the roster under the new ${type === 'coaching' ? 'coaching' : 'front-office'} setup.` : null
  ]);
  return { headline, deck, body, sections };
}

function playoffStory({ source, sourceAt, others, team, v }) {
  const { body, sections, add } = sectioner();
  const tn = v.team?.name || team?.name || 'The team';
  const headline = `${tn} playoff picture sharpens as the standings tighten`;
  const deck = v.standing
    ? `The ${tn} are ${v.standing.wins}–${v.standing.losses}${v.standing.seed ? ` and hold the No. ${v.standing.seed} seed` : ''} as the postseason race moves into its next stage.`
    : `The ${tn} are part of a new WNBA playoff development.`;
  add('The playoff picture', 'change', [standingSentence(tn, v.standing), reportSentence(source, sourceAt, others, `playoff development involving the ${tn}`)]);
  add('The schedule ahead', 'next', [nextGameSentence(tn, v.next_game)]);
  return { headline, deck, body, sections };
}

function leagueStory({ source, sourceAt, others, team, v, type, leagueTeams }) {
  const { body, sections, add } = sectioner();
  const tn = v.team?.name || team?.name || null;
  const label = type === 'cba' ? 'WNBA labor talks' : type === 'expansion' ? 'WNBA expansion' : type === 'business' ? 'WNBA business' : 'WNBA league';
  const headline = tn ? `${tn} at the center of a new ${label} development` : `${label}: the latest confirmed development`;
  const deck = tn && v.standing
    ? `The ${tn} are ${v.standing.wins}–${v.standing.losses} as a new off-court development reaches the team.`
    : others.length ? `Multiple independent publishers are reporting the same ${label.toLowerCase()} development, making it a league-wide development.` : `A new ${label.toLowerCase()} development has been reported.`;
  add('What changed', 'change', [
    tn
      ? `A new ${label.toLowerCase()} development involves the ${tn}, changing the team’s off-court picture.`
      : `A new ${label.toLowerCase()} development is moving across the WNBA, with the available reporting describing a league-level change rather than a player-specific basketball event.`,
    reportSentence(source, sourceAt, others, `${label.toLowerCase()} development`)
  ]);
  add('League context', 'context', [
    tn ? standingSentence(tn, v.standing) : null,
    ['cba', 'expansion'].includes(type) && leagueTeams ? `The current WNBA standings cover ${leagueTeams} teams, so the development reaches a league structure that spans every active club.` : null,
    !tn
      ? `The immediate basketball effect is not tied to one roster, one game or one player. It is a league-wide development, and the basketball impact will become clearer as teams respond.`
      : null,
    type === 'business'
      ? `The filing or business action is the event itself. Competitive, financial or legal outcomes are not inferred beyond what the reported development establishes.`
      : null
  ]);
  return { headline, deck, body, sections };
}

export function buildBriefStory(args) {
  const type = args.type;
  if (type === 'record') return recordStory(args);
  if (['injury', 'availability'].includes(type)) return injuryStory(args);
  if (['trade', 'signing', 'waiver', 'roster_move', 'transaction'].includes(type)) return transactionStory(args);
  if (type === 'lineup') return lineupStory(args);
  if (type === 'awards') return awardsStory(args);
  if (type === 'draft') return draftStory(args);
  if (['coaching', 'front_office'].includes(type)) return teamChangeStory(args);
  if (type === 'playoff') return playoffStory(args);
  return leagueStory(args);
}
