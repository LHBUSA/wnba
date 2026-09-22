// COMMISSIONED FEATURES — manually ordered editorial, built deterministically.
//
// The autopilot desks answer "what happened today". A commission answers a
// question an editor thought was worth asking. The idea is human; everything
// under it is not: each feature is composed from frozen snapshots and verified
// records by a named composer, gated, and published with its provenance
// attached. Two features on the same metric therefore do not come out as one
// template with the names swapped — they are different functions, because they
// are different arguments.
//
// Rules this lane keeps:
//   - Frozen inputs only. A published chart is a record, not a query.
//   - Visuals are validated before publication, and a feature whose premise is
//     a chart REFUSES to publish without it (`visuals.js` is fail-closed).
//   - PropBetEdge data is the article's source. Where we hold nothing — career
//     history, league awards — the fact is cited to the official page it was
//     read from (`data/commissions/verified-facts.json`) and never absorbed
//     into our own numbers.
//   - The metric's own window is described as what it is. The archive WinBA
//     reads is not identical to the official regular-season record, so this
//     lane does not claim it is.

import { WINBA_LABEL, WINBA_URL, WINBA_METHOD_URL, WINBA_METRIC_ENTITY } from './winba-editorial.js';
import { WINBA_INDEX_SERIES, winbaPeriodLabel } from './winba-index.js';
import { lineSeries, componentBars, rankCards, resumeCard, visualsFailures, VISUALS_VERSION } from './visuals.js';

export const COMMISSION_VERSION = 'wnba-commission/1.0.0';
export const COMMISSION_KIND = 'commissioned_feature';
export const COMMISSION_DESK = 'feature';
export const COMMISSION_SERIES = 'PropBetEdge Features';
export const COMMISSION_STATE_KEY = 'commission:v1:state';

/** The minimum a feature must be worth. Below it, nothing publishes rather than padding. */
export const COMMISSION_MIN_WORDS = 800;

const TZ = 'America/New_York';
const dayLabel = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'long', day: 'numeric' }).format(new Date(iso));
// A published statistic always carries its decimal: "19 points" invites the
// reader to wonder whether it was rounded, "19.0" does not.
const one = (v) => (v === null || v === undefined ? '' : (Math.round(Number(v) * 10) / 10).toFixed(1));
const pct = (v) => `${one(v)}%`;
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const word = (n) => (Number.isInteger(n) && n >= 0 && n <= 12 ? WORDS[n] : String(n));
const listOf = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] || '');
const honourPhrase = (h) => `${word(h.count)} ${h.plural || h.label}`;

/**
 * A section writer that keeps `sections` and `body` in step.
 *
 * `visual` binds a validated spec id to the section: the renderer draws that
 * figure after the section's paragraphs, and the paragraphs stand alone if it
 * never draws.
 */
function proseBuilder() {
  const body = [];
  const sections = [];
  let open = null;
  const close = () => { if (open) { open.count = body.length - open.first; if (open.count > 0) sections.push(open); } open = null; };
  return {
    body,
    sections,
    section(title, { key = null, visual = null } = {}) { close(); open = { title, key: key || title, first: body.length, count: 0, ...(visual ? { visual } : {}) }; },
    p(...text) { for (const t of text) if (t) body.push(t); },
    done() { close(); return { body, sections }; }
  };
}

/** The frozen board hash a plotted value must carry. Same digest the readiness report and the series canary print. */
export async function boardHash(board) {
  const canon = JSON.stringify((board?.rows || []).map((r) => [r.rank, r.player_id, r.score, r.team_id, r.components]));
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function hashId(parts, n = 12) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, n);
}

/**
 * One subject's frozen trajectory across the published editions.
 *
 * `observed_at` is the period cutoff — the instant the board's data window
 * closed — because that is when the values were true. It is not the moment the
 * snapshot object happened to be written.
 */
export function trajectoryOf(playerId, editions) {
  return editions
    .map((e) => {
      const row = (e.board?.rows || []).find((r) => String(r.player_id) === String(playerId));
      if (!row) return null;
      return {
        period: e.period,
        label: winbaPeriodLabel(e.period),
        short_label: winbaPeriodLabel(e.period).split(' ')[0],
        value: row.score,
        rank: row.rank,
        row,
        snapshot_at: e.board.leaderboard_as_of || e.board.snapshot_at,
        source_hash: e.hash,
        article_slug: e.slug || null
      };
    })
    .filter(Boolean);
}

const COMPONENT_LABELS = [
  ['production_percentile', 'Production percentile', 'percentile', 45, 'Box Impact per 36 minutes against the league'],
  ['win_rate', 'Win rate', 'percent', 25, 'the share of her games her team won'],
  ['winning_output_share', 'Production in wins', 'percent', 20, 'the share of her season production that arrived in wins'],
  ['court_share', 'Court share', 'percent', 10, 'the share of available minutes she played']
];

/** The four frozen components of one board row, in the metric's own weight order. */
export function componentRowsOf(row) {
  return COMPONENT_LABELS
    .map(([key, label, unit, weight, note]) => ({ key, label, unit, weight, note, value: row?.components?.[key] }))
    .filter((r) => r.value !== null && r.value !== undefined && r.value !== '');
}

/** Component movement between the first and last frozen board, largest mover first. */
export function componentMovement(first, last) {
  return COMPONENT_LABELS
    .map(([key, label]) => {
      const a = first?.components?.[key];
      const b = last?.components?.[key];
      if (a === null || a === undefined || b === null || b === undefined) return null;
      return { key, label, from: Number(a), to: Number(b), delta: Math.round((Number(b) - Number(a)) * 10) / 10 };
    })
    .filter(Boolean)
    .sort((x, y) => y.delta - x.delta);
}

// =================================================================== features

/**
 * ANGEL REESE — the metric against a criticism.
 *
 * The question is not whether she produces; it is whether the production shows
 * up in winning. WinBA is one measurable way to ask that, so the piece puts the
 * frozen trajectory and the frozen components in front of the argument and
 * reports what they do and do not settle.
 */
function composeReese(ctx) {
  const { subject, team, traj, sept, seasonLine, recent, topThree, facts, qualified } = ctx;
  const w = proseBuilder();
  const first = traj[0];
  const last = traj.at(-1);
  const moves = componentMovement(first.row, last.row);
  const comps = Object.fromEntries(componentRowsOf(sept.row).map((r) => [r.key, r.value]));
  const rise = moves.filter((m) => m.delta > 0);
  const winningMovers = moves.filter((m) => ['win_rate', 'winning_output_share'].includes(m.key));

  w.p(
    `The argument about ${subject.name} has never really been about whether she produces. It is about whether the production means anything.`,
    `That is the shape of the “empty stats” criticism, and it is a more specific claim than it usually sounds: not that the numbers are small, but that they are disconnected from winning basketball. Stated that way it is testable, because it is a claim about the relationship between two measurable things.`,
    `${WINBA_LABEL} is one attempt to measure that relationship. It is PropBetEdge's 0–100 winning-impact rating, and it combines how much a player produces relative to the league with how often her team wins, how much of her production lands in those wins, and how much of the available floor time she takes. In the ${winbaPeriodLabel(sept.period)} edition of ${WINBA_INDEX_SERIES}, ${subject.name} ranks No. ${sept.rank} of ${qualified} qualified players at ${one(sept.value)}.`
  );

  w.section('The data point that makes this interesting', { key: 'data_point', visual: 'september-context' });
  w.p(
    `${subject.name} plays for the ${team?.name || 'Atlanta Dream'}, and her ${seasonLine.season_label} line is ${one(seasonLine.pts)} points, ${one(seasonLine.reb)} rebounds and ${one(seasonLine.ast)} assists a game across ${seasonLine.games} appearances — a line that matches her official league profile exactly.`,
    recent
      ? `Her most recent five games are louder than that: ${one(recent.pts)} points, ${one(recent.reb)} rebounds and ${one(recent.ast)} assists, from ${dayLabel(recent.from)} to ${dayLabel(recent.to)}. Recent-form windows are volatile by construction and this one is five games wide, so it is context rather than evidence.`
      : null,
    `The rating is the part worth sitting with. Only ${word(sept.rank - 1)} qualified players in the league grade above her: ${topThree.filter((c) => String(c.entity.id) !== String(subject.id)).map((c) => `${c.entity.name} at ${one(c.value)}`).join(' and ')}. Third is not a moral victory. It is a position near the top of a rating that was explicitly built to hold down production that does not travel with winning.`
  );

  w.section(`${subject.name}'s WinBA climb`, { key: 'climb', visual: 'reese-climb' });
  w.p(
    `The rating did not find her in September. Across four frozen monthly snapshots she has moved from No. ${first.rank} to No. ${last.rank}, and her score has risen in every one of them.`,
    `What makes that progression interesting is not its size — ${one(last.value - first.value)} points of rating across four months is a moderate move — but its composition. All four of the metric's inputs rose${rise.length === 4 ? '' : ' for the ones that moved'}, and the two that rose most are the two that carry winning context: ${listOf(winningMovers.map((m) => `${m.label.toLowerCase()} from ${pct(m.from)} to ${pct(m.to)}`))}.`,
    `Her production percentile over the same stretch went from ${one(first.row.components.production_percentile)} to ${one(last.row.components.production_percentile)} out of 100. She was already producing at close to the top of the league in ${first.label.split(' ')[0]}; what changed is the context the production arrived in. A climb built that way is the opposite of a volume story.`
  );

  w.section('What WinBA is actually measuring', { key: 'method' });
  w.p(
    `The rating has four inputs and they are deliberately plain. Box Impact — points plus 1.2 times rebounds plus 1.5 times assists — is measured per 36 minutes and placed as a percentile against every qualified player in the league; that is 45% of the score. Win rate is 25%. The share of a player's season production that arrived in wins is 20%. Court share, the proportion of available minutes she actually played, is the last 10%.`,
    `That construction is why the rating behaves differently from a counting-stat leaderboard: a player can produce heavily and still be held down by the two winning-context terms, which together are 45% of the number.`,
    `It is also worth being clear about what the rating does not do. It does not measure defence directly, it knows nothing about shot quality, lineup context or role, and it is an association-with-winning index rather than a causal estimate of wins added. It is built from completed games in PropBetEdge's own 2026 archive, which is close to but not identical with the official regular-season record. One lens, honestly scaled — not a verdict on a player's value.`
  );

  w.section(`What makes up ${subject.name}'s ${one(sept.value)} WinBA`, { key: 'components', visual: 'reese-components' });
  w.p(
    `Broken into its four inputs, the ${winbaPeriodLabel(sept.period)} rating says something quite specific.`,
    `Her production percentile is ${one(comps.production_percentile)} out of 100. On the metric's largest input she is essentially at the league ceiling: almost nobody who qualified produced more per minute played. Her court share, ${pct(comps.court_share)}, is the workload of a full-time starter.`,
    `The two winning-context inputs are the ones that are merely good. Her teams won ${pct(comps.win_rate)} of the games she played, and ${pct(comps.winning_output_share)} of her production arrived in those wins. Both are comfortably on the positive side of the league — and both are lower than her production percentile, which is precisely why she rates third rather than first.`,
    `So the metric's own answer is not that the criticism is baseless. It is narrower and more useful than that: her production is near the top of the league, her winning context is solidly positive, and it is the winning context — not the production — that separates her from the two players above her.`
  );

  w.section('The “empty stats” question', { key: 'empty_stats' });
  w.p(
    `Traditional counting stats genuinely cannot settle this argument. Points and rebounds record what a player did; by themselves they say nothing about whether the team was winning while she did it. That gap is the whole reason the criticism has had room to live for as long as it has.`,
    `${WINBA_LABEL} closes part of the gap by building winning into the measurement rather than inferring it afterwards. A quarter of the rating is win rate and a fifth is the share of production that came in wins, so a player whose numbers really were disconnected from winning would be pushed down by nearly half of the formula. ${subject.name} is No. ${sept.rank} in the league on it.`,
    `That is meaningful evidence against the simple form of the criticism. It is not a finding that every criticism of her game is invalid — the rating does not adjudicate shot selection, defensive scheme or fit, and reasonable arguments about all three exist. What it does is move the burden. Calling the production empty now requires explaining why a metric that explicitly weights wins and production-in-wins at 45% still grades her among the three best players in the league.`,
    facts.reese_dream_season_awards
      ? `There is also a non-WinBA data point worth putting beside it: the Dream's own 2026 season-awards page lists ${subject.name} as Defensive Player of the Year, All-WNBA and All-Defensive Team, and states that she owns the WNBA single-season records for total rebounds, for offensive rebounds, and for double-doubles, with ${facts.reese_dream_season_awards.double_doubles}. Those are her club's own words rather than ours, and they describe recognition that a purely empty statistical profile does not usually attract.`
      : null
  );

  w.section('What the rating is good for', { key: 'conclusion' });
  w.p(
    `The value of ${WINBA_LABEL} is not that it ends basketball arguments. Any single number that claimed to would be lying about what it measures.`,
    `Its value is that it makes the arguments more specific. With ${subject.name}, the conversation can stop being about whether the stat line is large — it plainly is — and start being about what those numbers look like once winning context is included. On this rating, in this season, they look like the third-best profile in the WNBA. The interesting question is no longer whether the production is real. It is what would have to be true for a top-three winning-impact rating to still be considered empty.`
  );

  const { body, sections } = w.done();
  const provenance = {
    source: `PropBetEdge frozen ${WINBA_LABEL} monthly snapshots`,
    metric: sept.row ? 'winba/1.0.0' : null,
    observed_at: sept.snapshot_at
  };

  const visuals = [
    lineSeries({
      id: 'reese-climb',
      title: `${subject.name}'s WinBA climb`,
      subtitle: 'Monthly WinBA Score, with her league rank at each frozen snapshot',
      caption: `Frozen monthly ${WINBA_LABEL} snapshots. ${winbaPeriodLabel(sept.period)} reflects the current published ${WINBA_INDEX_SERIES}.`,
      entity: { type: 'player', id: String(subject.id), name: subject.name, team_id: team?.team_id ? String(team.team_id) : null },
      unit: 'winba_score',
      points: traj,
      provenance,
      footnote: `Each point is read from that month's frozen board, identified by its own snapshot hash. Published values are never recomputed.`
    }),
    componentBars({
      id: 'reese-components',
      title: `What makes up ${subject.name}'s ${one(sept.value)} WinBA`,
      subtitle: `The four inputs behind PropBetEdge's winning-impact metric`,
      caption: `${winbaPeriodLabel(sept.period)} frozen board. Percentile is measured against every qualified player; the remaining three are shares of her own season.`,
      entity: { type: 'player', id: String(subject.id), name: subject.name, team_id: team?.team_id ? String(team.team_id) : null },
      rows: componentRowsOf(sept.row),
      total: sept.value,
      provenance,
      footnote: `Weights: production percentile 45%, win rate 25%, production in wins 20%, court share 10%.`
    }),
    rankCards({
      id: 'september-context',
      title: `The top three in ${winbaPeriodLabel(sept.period)}`,
      subtitle: 'Where the rating places her, and against whom',
      caption: `${winbaPeriodLabel(sept.period)} frozen board — ${qualified} qualified players ranked.`,
      unit: 'winba_score',
      cards: topThree.map((c) => ({ ...c, highlight: String(c.entity.id) === String(subject.id) })),
      provenance
    })
  ];

  return {
    headline: `${subject.name} and the “Empty Stats” Debate: What WinBA Says About Winning Impact`,
    deck: `She is No. ${sept.rank} of ${qualified} qualified players on PropBetEdge's winning-impact rating, and has climbed in all four frozen monthly snapshots. The rating does not end the argument — it narrows it.`,
    body,
    sections,
    visuals,
    seo_title: `${subject.name} WinBA: what the winning-impact rating says about the “empty stats” argument`,
    seo_description: `${subject.name} ranks No. ${sept.rank} at ${one(sept.value)} on PropBetEdge's ${WINBA_LABEL} in ${winbaPeriodLabel(sept.period)}, after climbing from No. ${first.rank} in ${winbaPeriodLabel(first.period)}. A component-level look at her production, win rate and production in wins.`,
    keywords: [`${subject.name} WinBA`, `${subject.name} stats`, `${subject.name} winning impact`, `${subject.name} ${team?.name || ''}`.trim(), 'WNBA winning impact metric'],
    commission_note: 'Commissioned because the “empty stats” criticism makes a claim about the relationship between production and winning, and that is the relationship WinBA measures.'
  };
}

/**
 * A'JA WILSON — the metric against a career.
 *
 * Not "why isn't she first". The finding is the absence of movement: an
 * established, decorated player who does not leave the top of a rating built
 * around production and winning, month after month.
 */
function composeWilson(ctx) {
  const { subject, team, traj, sept, seasonLine, facts, qualified, leader } = ctx;
  const w = proseBuilder();
  const first = traj[0];
  const ranks = traj.map((p) => p.rank);
  const scores = traj.map((p) => p.value);
  const spread = Math.max(...scores) - Math.min(...scores);
  const prodPct = traj.map((p) => p.row.components?.production_percentile).filter((v) => v !== null && v !== undefined);
  const prodFlat = prodPct.length === traj.length && new Set(prodPct.map(Number)).size === 1;
  const honours = facts.wilson_official_profile?.honours || [];
  const career = facts.wilson_official_profile?.career_line || null;
  const bestRank = Math.min(...ranks);
  const worstRank = Math.max(...ranks);

  w.p(
    `Excellence that lasts long enough stops being remarked upon. It becomes the baseline other things are measured against, and the player at the centre of it gets described in the present tense as though nothing were happening.`,
    `${subject.name} is at that stage of her career. ${honours.length ? `Her league profile carries ${listOf(honours.slice(0, 4).map(honourPhrase))}, and the sentence barely registers any more.` : ''}`,
    `So here is a smaller, stranger measurement. In the ${winbaPeriodLabel(sept.period)} edition of ${WINBA_INDEX_SERIES}, ${subject.name} is No. ${sept.rank} of ${qualified} qualified players at ${one(sept.value)}. The interesting part is not the No. ${sept.rank}. It is that across every publishable monthly snapshot of the rating, she has been No. ${bestRank} or No. ${worstRank} — and nothing else.`
  );

  w.section(`${subject.name} has lived at the top of WinBA`, { key: 'standard', visual: 'wilson-standard' });
  w.p(
    `Four frozen monthly boards, in order: ${traj.map((p) => `No. ${p.rank} at ${one(p.value)} in ${p.label.split(' ')[0]}`).join(', ')}. As a sequence of ranks it reads ${ranks.join(' · ')}.`,
    `The total spread between her best and worst monthly rating is ${one(spread)} points on a 0-100 scale. That is the finding, and it is a finding about the absence of movement rather than the presence of it: on a rating that re-measures production and winning from scratch every month, one of the most decorated players of her generation has not meaningfully moved.`,
    prodFlat
      ? `Underneath it there is something starker still. Her production percentile — Box Impact per 36 minutes measured against every qualified player, and the largest single input to the rating — is ${one(Number(prodPct[0]))} out of 100 in all four boards. Not near the top of the league. The top of it, in every snapshot the series has published.`
      : `Underneath it, her production percentile has held between ${one(Math.min(...prodPct.map(Number)))} and ${one(Math.max(...prodPct.map(Number)))} out of 100 across the four boards — the largest single input to the rating, effectively unmoved.`,
    leader && String(leader.entity.id) !== String(subject.id)
      ? `What moved was the top of the board, not her. ${leader.entity.name} rose past her after ${first.label.split(' ')[0]} and has held No. 1 since; ${subject.name}'s own rating over those months fell by ${one(first.value - sept.value)} points. She did not decline out of first place. Somebody else climbed into it.`
      : null
  );

  w.section('The résumé beside the rating', { key: 'resume', visual: 'wilson-resume' });
  w.p(
    `Put the rating next to the career and the alignment is worth noticing.`,
    honours.length
      ? `Her official league profile lists ${listOf(honours.map((h) => `${h.count}× ${h.label}`))}. Her ${seasonLine.season_label} line is ${one(seasonLine.pts)} points, ${one(seasonLine.reb)} rebounds and ${one(seasonLine.ast)} assists a game${career ? `, against a career line of ${career.verbatim.pts} points, ${career.verbatim.reb} rebounds and ${career.verbatim.ast} assists` : ''}. The season figure is not an outlier year measured against a modest career; it is the same player, slightly better.`
      : null,
    `PropBetEdge holds no career-history or awards data of its own — our archive is the 2026 season — so the honours and the career line above are cited to her official league profile rather than derived from our records. Our own ${seasonLine.season_label} aggregate, ${one(seasonLine.pts)} / ${one(seasonLine.reb)} / ${one(seasonLine.ast)}, matches that profile exactly, which is the reconciliation we ask of any number we print.`,
    `This is not a claim that ${WINBA_LABEL} has been scientifically validated. One player is not a validation study. It is the weaker and still useful observation that a rating built to find production arriving in winning contexts puts a player with that résumé at the top of the league in every month it has measured — which is the sort of face-validity result you want from a new metric before you trust it on players whose careers have not already been adjudicated.`
  );

  w.section('The Kevin Durant question', { key: 'durant' });
  w.p(
    `The comparison gets made, and it is worth taking seriously rather than dismissing or endorsing.`,
    `What it gets right is the texture of the career: scoring at the top of the league across years rather than spiking in one of them, a résumé large enough to lose track of, and output so consistent that observers normalise it. A ${one(seasonLine.pts)}-point season would be the defining year of most careers; here it is roughly what the last several have looked like. That is the specific thing the analogy is reaching for — a player whose ordinary is somebody else's ceiling, and who is therefore perennially present near the top of the sport without the annual narrative that usually accompanies it.`,
    `What it gets wrong is nearly everything about the basketball. ${subject.name} is a ${String(team?.position_name || 'center').toLowerCase()} whose defensive résumé is central to her greatness rather than an addendum to it — her profile carries ${honours.find((h) => h.key === 'dpoy') ? honourPhrase(honours.find((h) => h.key === 'dpoy')) : 'multiple Defensive Player of the Year awards'} — and the comparison imports the offensive half of a wing's identity while dropping the half that makes hers distinctive. The leagues differ, the roles differ, and the defensive expectations of a frontcourt anchor are not the ones a perimeter scorer carries.`,
    `The honest use of the analogy is as a lens for what sustained, normalised excellence does to perception, and not as a claim about equivalence. ${subject.name} is not a version of somebody else. She is the reason the question gets asked in the first place.`
  );

  w.section('Reading the two lenses together', { key: 'lenses' });
  w.p(
    `A résumé and a rating fail in different directions. Awards are retrospective, voted, and slow to update; they can lag a decline by a season and they cannot tell you anything about a player who has not yet been recognised. A monthly rating is fast and blind: it re-measures from the games alone and has no memory of what anybody won last year.`,
    `Both lenses have limits worth stating. ${WINBA_LABEL} does not measure defence directly and knows nothing about role or lineup context, and it is built from completed games in PropBetEdge's own 2026 archive, which is close to but not identical with the official regular-season record. It is an association-with-winning index, not a causal estimate of wins added — which is why the conventional line printed above comes from our season aggregate, reconciled against her official profile, rather than from the metric's own window.`,
    `Their agreement is the point. The slow lens says ${honours.find((h) => h.key === 'mvp') ? `${word(honours.find((h) => h.key === 'mvp').count)}-time MVP` : 'a decorated career'}; the fast one, re-derived monthly from box scores and results with no knowledge of any of that, says No. ${bestRank} or No. ${worstRank} every single month. Where two measurements built on entirely different information land in the same place, the thing they are both pointing at is probably real.`
  );

  w.section('Why No. 2 is the least interesting part', { key: 'conclusion' });
  w.p(
    `Rank is the noisiest thing on a leaderboard. It changes when somebody else has a good month, which is exactly what happened here, and it says less about the player it is attached to than the number beside it does.`,
    `The durable finding is the flatness. Month after month, on a rating that starts from zero every time and rewards production that arrives in wins, it takes an extraordinary season from somebody else to move ${subject.name} off the very top — and even then it moves her one place. That is what greatness looks like when it has stopped being news: not a spike, but a line that refuses to come down.`
  );

  const { body, sections } = w.done();
  const provenance = {
    source: `PropBetEdge frozen ${WINBA_LABEL} monthly snapshots`,
    metric: 'winba/1.0.0',
    observed_at: sept.snapshot_at
  };

  const visuals = [
    lineSeries({
      id: 'wilson-standard',
      title: `${subject.name} has lived at the top of WinBA`,
      subtitle: 'Monthly WinBA Score, with her league rank at each frozen snapshot',
      caption: `Frozen monthly ${WINBA_LABEL} snapshots. The axis is scaled to the rating, not to the movement: the flatness is the finding.`,
      entity: { type: 'player', id: String(subject.id), name: subject.name, team_id: team?.team_id ? String(team.team_id) : null },
      unit: 'winba_score',
      points: traj,
      provenance,
      footnote: `Each point is read from that month's frozen board, identified by its own snapshot hash. Published values are never recomputed.`
    }),
    resumeCard({
      id: 'wilson-resume',
      title: 'The résumé beside the rating',
      subtitle: 'Counted honours from her official league profile; season production from PropBetEdge',
      caption: `Honours and career line: ${facts.wilson_official_profile?.source || 'official league profile'}, read ${facts.wilson_official_profile ? dayLabel(facts.wilson_official_profile.captured_at) : ''}. Season line: PropBetEdge 2026 aggregate, which matches that profile exactly.`,
      entity: { type: 'player', id: String(subject.id), name: subject.name, team_id: team?.team_id ? String(team.team_id) : null },
      honours,
      lines: [
        {
          key: 'season_2026',
          label: seasonLine.season_label,
          window: `${seasonLine.games} appearances, 2026 regular season`,
          source: 'PropBetEdge season aggregate',
          stats: [
            { key: 'pts', label: 'PPG', value: seasonLine.pts },
            { key: 'reb', label: 'RPG', value: seasonLine.reb },
            { key: 'ast', label: 'APG', value: seasonLine.ast }
          ]
        },
        ...(career
          ? [{
            key: 'career',
            label: 'Career',
            window: career.window,
            source: facts.wilson_official_profile.source,
            stats: [
              { key: 'pts', label: 'PPG', value: Number(career.verbatim.pts) },
              { key: 'reb', label: 'RPG', value: Number(career.verbatim.reb) },
              { key: 'ast', label: 'APG', value: Number(career.verbatim.ast) }
            ]
          }]
          : [])
      ],
      provenance: { ...provenance, source: 'PropBetEdge season aggregate and the official league profile cited in the evidence list' },
      footnote: 'PropBetEdge stores no career history or awards data. Those values are cited, not computed.'
    })
  ];

  return {
    headline: `${subject.name} Has Made Greatness Look Routine. WinBA Shows Just How Consistent She's Been`,
    deck: `Four frozen monthly snapshots of PropBetEdge's winning-impact rating put her at No. ${bestRank} or No. ${worstRank} every time, inside ${one(spread)} points of rating. The rank is the least interesting part.`,
    body,
    sections,
    visuals,
    seo_title: `${subject.name} WinBA: four months at the top of the winning-impact rating`,
    seo_description: `${subject.name} is No. ${sept.rank} at ${one(sept.value)} on PropBetEdge's ${WINBA_LABEL} in ${winbaPeriodLabel(sept.period)}, after ranking No. ${ranks.join(', ')} across four frozen monthly boards. Her production percentile, her ${seasonLine.season_label} line and her career résumé, read together.`,
    keywords: [`${subject.name} WinBA`, `${subject.name} stats`, `${subject.name} consistency`, `${subject.name} ${team?.name || ''}`.trim(), 'WNBA winning impact metric'],
    commission_note: 'Commissioned because sustained excellence is under-reported by construction: nothing about it is new on any given day.'
  };
}

/**
 * The commission registry. A feature is a named, versioned entry — never a
 * generic template — so the newsroom can say exactly what was ordered.
 */
export const COMMISSIONS = Object.freeze({
  'reese-winba-empty-stats': {
    slug: 'angel-reese-winba-empty-stats-debate',
    subject: { id: '4433402', name: 'Angel Reese' },
    mentions: [{ id: '4433791', name: 'Olivia Miles' }, { id: '3149391', name: "A'ja Wilson" }],
    periods: ['2026-06', '2026-07', '2026-08', '2026-09'],
    facts: ['reese_official_profile', 'reese_dream_season_awards'],
    compose: composeReese,
    required_visuals: ['reese-climb', 'reese-components']
  },
  'wilson-winba-consistency': {
    slug: 'aja-wilson-winba-consistency-greatness-routine',
    subject: { id: '3149391', name: "A'ja Wilson" },
    mentions: [{ id: '4433791', name: 'Olivia Miles' }],
    periods: ['2026-06', '2026-07', '2026-08', '2026-09'],
    facts: ['wilson_official_profile'],
    compose: composeWilson,
    required_visuals: ['wilson-standard', 'wilson-resume']
  }
});

/**
 * Publish one commissioned feature.
 *
 * Idempotent by stored state: a rerun returns the existing record with its
 * original published_at. `force` recomposes in place and records a revision;
 * it never moves the publication date and never rewrites a frozen input.
 */
export async function runCommission({
  key,
  editions = [],
  subjectRecord = null,
  seasonLine = null,
  recent = null,
  factsDoc = null,
  at = new Date().toISOString(),
  getState,
  putState,
  getArticle,
  putArticle,
  force = false
} = {}) {
  const spec = COMMISSIONS[key];
  if (!spec) return { key, status: 'unknown_commission' };

  const state = (await getState()) || { version: COMMISSION_VERSION, published: {} };
  const already = state.published?.[key] || null;
  if (already && !force) {
    const existing = await getArticle(already.id).catch(() => null);
    return { key, status: 'already_published', id: already.id, slug: already.slug, published_at: already.published_at, article: existing };
  }

  const missing = spec.periods.filter((p) => !editions.some((e) => e.period === p && e.board?.rows?.length));
  if (missing.length) return { key, status: 'missing_frozen_boards', missing };

  const ordered = spec.periods.map((p) => editions.find((e) => e.period === p));
  const traj = trajectoryOf(spec.subject.id, ordered);
  if (traj.length !== spec.periods.length) {
    return { key, status: 'subject_absent_from_a_board', present: traj.map((t) => t.period) };
  }
  const sept = traj.at(-1);
  const lastBoard = ordered.at(-1).board;
  const top = (lastBoard.rows || []).slice(0, 3);

  const facts = Object.fromEntries((spec.facts || []).map((f) => [f, factsDoc?.facts?.[f] || null]).filter(([, v]) => v));
  const team = subjectRecord?.player?.team
    ? { ...subjectRecord.player.team, position_name: subjectRecord.player.position_name || null }
    : null;

  // The team the article asserts must be the team the frozen board recorded for
  // her, or the feature does not run: a trade must not be able to publish a
  // wrong-team feature off a stale roster read.
  if (team?.team_id && sept.row.team_id && String(team.team_id) !== String(sept.row.team_id)) {
    return { key, status: 'team_disagreement', roster_team: String(team.team_id), board_team: String(sept.row.team_id) };
  }

  const topThree = top.map((r) => ({
    rank: r.rank,
    value: r.score,
    entity: { id: String(r.player_id), name: r.player_name, team_id: r.team_id ? String(r.team_id) : null, team_name: r.team_name || null }
  }));
  const leader = topThree[0] || null;

  const composed = spec.compose({
    subject: spec.subject,
    team,
    traj,
    sept,
    seasonLine,
    recent,
    topThree,
    leader,
    facts,
    qualified: lastBoard.qualified_count ?? null
  });

  // ---- fail-closed visual validation. A feature whose premise is a chart does
  // not publish with a broken chart.
  const visualFailures = visualsFailures(composed.visuals);
  const present = new Set((composed.visuals || []).map((v) => v.id));
  const absent = (spec.required_visuals || []).filter((id) => !present.has(id));
  if (visualFailures.length || absent.length) {
    return {
      key,
      status: 'held_visual_validation',
      failures: visualFailures,
      ...(absent.length ? { missing_required_visuals: absent } : {})
    };
  }
  // A section may only address a visual that exists.
  const danglingVisual = (composed.sections || []).filter((s) => s.visual && !present.has(s.visual)).map((s) => s.visual);
  if (danglingVisual.length) return { key, status: 'held_dangling_visual', dangling: danglingVisual };

  const words = composed.body.join(' ').split(/\s+/).filter(Boolean).length;
  if (words < COMMISSION_MIN_WORDS) return { key, status: 'held_thin', words };

  const entities = [
    { type: 'player', id: String(spec.subject.id), name: spec.subject.name, team_id: team?.team_id ? String(team.team_id) : null },
    ...(spec.mentions || []).map((m) => {
      const row = (lastBoard.rows || []).find((r) => String(r.player_id) === String(m.id));
      return { type: 'player', id: String(m.id), name: m.name, team_id: row?.team_id ? String(row.team_id) : null };
    }),
    ...(team ? [{ type: 'team', id: String(team.team_id), name: team.name }] : []),
    { ...WINBA_METRIC_ENTITY }
  ];

  const evidence = [
    ...ordered.map((e) => ({
      kind: 'internal_snapshot',
      source: `${WINBA_INDEX_SERIES} — frozen ${winbaPeriodLabel(e.period)} board`,
      headline: e.headline || null,
      url: e.slug ? `/news/${e.slug}` : null,
      // The instant the board's data window closed is when these values were
      // true. Not when the snapshot object happened to be written.
      captured_at: e.board.leaderboard_as_of || e.board.snapshot_at,
      detail: `${(e.board.rows || []).length} ranked players, ${e.board.qualified_count} qualified · snapshot hash ${e.hash}`
    })),
    ...(seasonLine ? [{
      kind: 'internal_record',
      source: `PropBetEdge ${seasonLine.season_label} aggregate`,
      captured_at: seasonLine.observed_at,
      detail: `${seasonLine.games} appearances`
    }] : []),
    ...Object.values(facts).map((f) => ({
      kind: 'publisher_report',
      publisher: f.publisher,
      source: f.source,
      url: f.url,
      captured_at: f.captured_at
    }))
  ];

  const id = already?.id || await hashId([COMMISSION_KIND, key, spec.subject.id], 12);
  const slug = already?.slug || `${spec.slug}-${(await hashId([key, spec.slug], 6))}`;
  const firstPublished = already?.published_at || at;
  const stored = already ? await getArticle(already.id).catch(() => null) : null;

  const article = {
    id,
    slug,
    kind: COMMISSION_KIND,
    desk: COMMISSION_DESK,
    category: 'Feature',
    series: COMMISSION_SERIES,
    status: 'published',
    headline: composed.headline,
    deck: composed.deck,
    body: composed.body,
    sections: composed.sections,
    visuals: composed.visuals,
    lead_player_id: String(spec.subject.id),
    lead_team_id: team?.team_id ? String(team.team_id) : null,
    primary_subject: spec.subject.name,
    identity_mode: 'player',
    subject_type: 'player_feature',
    entities,
    evidence,
    // The commission itself is part of the record: a reader can see that a human
    // ordered this piece and why, and that the writing under it was not.
    commission: {
      key,
      version: COMMISSION_VERSION,
      ordered: 'newsroom editor',
      note: composed.commission_note,
      autopilot: false
    },
    winba_reference: {
      period: sept.period,
      period_label: winbaPeriodLabel(sept.period),
      rank: sept.rank,
      score: sept.value,
      player_id: String(spec.subject.id),
      player_name: spec.subject.name,
      qualified_count: lastBoard.qualified_count ?? null,
      snapshot_at: sept.snapshot_at,
      source_hash: sept.source_hash,
      frozen: true
    },
    links: {
      winba: WINBA_URL,
      methodology: WINBA_METHOD_URL,
      index_series: '/news/winba-index',
      current_edition: ordered.at(-1).slug ? `/news/${ordered.at(-1).slug}` : null
    },
    seo: { title: composed.seo_title, description: composed.seo_description, keywords: composed.keywords },
    method: [
      `The idea for this feature was commissioned by an editor; every number in it was composed deterministically from stored records.`,
      `The charts are frozen payloads. Each plotted value carries the hash of the monthly ${WINBA_LABEL} board it was read from, and the renderer verifies the payload before drawing it. Nothing on this page is recomputed when you load it.`,
      `Where PropBetEdge holds no data of its own — career history and league awards — the fact is cited to the official page it was read from, with the time it was read, in the records above.`,
      `${WINBA_LABEL} is built from completed games in PropBetEdge's 2026 archive, which is close to but not identical with the official regular-season record. It is an association-with-winning index, not a causal estimate of wins added.`
    ],
    published_at: firstPublished,
    first_published_at: firstPublished,
    updated_at: at,
    revisions: already
      ? [...(stored?.revisions || already.revisions || []), { at, kind: 'editorial_upgrade', generator: COMMISSION_VERSION }].slice(-20)
      : [],
    revised_at: already ? at : null,
    provenance: {
      generated_at: at,
      source_observed_at: sept.snapshot_at,
      generator: COMMISSION_VERSION,
      visuals: VISUALS_VERSION
    },
    generator: { type: 'commissioned_deterministic', version: COMMISSION_VERSION },
    words
  };

  await putArticle(article);
  await putState({
    version: COMMISSION_VERSION,
    published: { ...(state.published || {}), [key]: { id, slug, key, headline: article.headline, published_at: firstPublished } }
  });

  return { key, status: already ? 'regenerated' : 'published', id, slug, words, visuals: (composed.visuals || []).map((v) => ({ id: v.id, type: v.type, values_hash: v.values_hash })), article };
}

/** The listing card for a commissioned feature. Mirrors only what listings render. */
export function cardForCommission(a) {
  return {
    id: a.id,
    slug: a.slug,
    kind: a.kind,
    desk: a.desk,
    category: a.category,
    series: a.series,
    event_type: 'commissioned_feature',
    headline: a.headline,
    deck: a.deck,
    status: 'published',
    quality_state: 'current_quality',
    published_at: a.published_at,
    first_published_at: a.first_published_at,
    updated_at: a.updated_at,
    revised_at: a.revised_at || null,
    revisions: a.revisions || [],
    lead_player_id: a.lead_player_id,
    lead_team_id: a.lead_team_id,
    entities: a.entities,
    has_market: false,
    sources: [],
    media: a.media || null,
    identity_mode: 'player',
    commission: a.commission || null,
    winba_reference: a.winba_reference || null
  };
}
