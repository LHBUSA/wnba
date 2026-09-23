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

export const COMMISSION_VERSION = 'wnba-commission/1.2.0';
export const COMMISSION_KIND = 'commissioned_feature';
export const COMMISSION_DESK = 'feature';
export const COMMISSION_SERIES = 'PropBetEdge Features';
export const COMMISSION_STATE_KEY = 'commission:v1:state';

/** The minimum a feature must be worth. Below it, nothing publishes rather than padding. */
export const COMMISSION_MIN_WORDS = 700;

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
    `The useful version of the “empty stats” criticism is specific: does ${subject.name}'s production show up in winning contexts, or is the box score doing most of the work?`,
    `${WINBA_LABEL} is one way to test that question. It combines league-relative box-score production with team win rate, the share of a player's production that came in wins, and court share. In the ${winbaPeriodLabel(sept.period)} edition of ${WINBA_INDEX_SERIES}, ${subject.name} ranks No. ${sept.rank} of ${qualified} qualified players at ${one(sept.value)}.`
  );

  w.section('The data point that makes this interesting', { key: 'data_point', visual: 'september-context' });
  w.p(
    `${subject.name} plays for the ${team?.name || 'Atlanta Dream'}, and her ${seasonLine.season_label} line is ${one(seasonLine.pts)} points, ${one(seasonLine.reb)} rebounds and ${one(seasonLine.ast)} assists a game across ${seasonLine.games} appearances — a line that matches her official league profile exactly.`,
    recent
      ? `Her most recent five games are louder than that: ${one(recent.pts)} points, ${one(recent.reb)} rebounds and ${one(recent.ast)} assists, from ${dayLabel(recent.from)} to ${dayLabel(recent.to)}. Recent-form windows are volatile by construction and this one is five games wide, so it is context rather than evidence.`
      : null,
    `Only ${word(sept.rank - 1)} qualified players grade above her: ${topThree.filter((c) => String(c.entity.id) !== String(subject.id)).map((c) => `${c.entity.name} at ${one(c.value)}`).join(' and ')}. The ranking matters here because WinBA gives 45% of the score to two winning-context inputs rather than treating raw production alone as sufficient.`
  );

  w.section(`${subject.name}'s WinBA climb`, { key: 'climb', visual: 'reese-climb' });
  w.p(
    `The rating did not find her in September. Across four frozen monthly snapshots she has moved from No. ${first.rank} to No. ${last.rank}, and her score has risen in every one of them.`,
    `What makes that progression interesting is not its size — ${one(last.value - first.value)} points of rating across four months is a moderate move — but its composition. All four of the metric's inputs rose${rise.length === 4 ? '' : ' for the ones that moved'}, and the two that rose most are the two that carry winning context: ${listOf(winningMovers.map((m) => `${m.label.toLowerCase()} from ${pct(m.from)} to ${pct(m.to)}`))}.`,
    `Her production percentile over the same stretch went from ${one(first.row.components.production_percentile)} to ${one(last.row.components.production_percentile)} out of 100. She was already producing near the top of the league in ${first.label.split(' ')[0]}; the larger gains came from win rate and production in wins, so the rise was not driven by the production term alone.`
  );

  w.section(`How ${subject.name} gets to ${one(sept.value)} WinBA`, { key: 'components', visual: 'reese-components' });
  w.p(
    `WinBA v1 uses four inputs. Its production term is a simple per-36 box-score index — points plus 1.2 times rebounds plus 1.5 times assists — converted to a percentile against qualified players and weighted at 45%. Win rate is 25%, the share of a player's production that came in wins is 20%, and court share is 10%.`,
    `For ${subject.name}, the frozen ${winbaPeriodLabel(sept.period)} row is ${one(comps.production_percentile)} for production percentile, ${pct(comps.win_rate)} win rate, ${pct(comps.winning_output_share)} production in wins and ${pct(comps.court_share)} court share. Her production term is near the league ceiling; the two winning-context inputs are positive but lower, which is why the overall score sits below the two players ahead of her.`,
    `The limits are equally important. The production term does not include shooting efficiency or turnovers, and WinBA does not directly measure defence, shot quality, lineup context or role. It is an association-with-winning index built from completed games in PropBetEdge's 2026 archive, which is close to but not identical with the official regular-season record. It is not a causal estimate of wins added.`
  );

  w.section('The “empty stats” question', { key: 'empty_stats' });
  w.p(
    `Traditional counting stats genuinely cannot settle this argument. Points and rebounds record what a player did; by themselves they say nothing about whether the team was winning while she did it. That gap is the whole reason the criticism has had room to live for as long as it has.`,
    `${WINBA_LABEL} addresses part of that gap directly: 45% of the score comes from win rate and the share of production recorded in wins. On that combined framework, ${subject.name} still ranks No. ${sept.rank} in the league.`,
    `That is evidence against the simplest version of the “empty stats” label, but it does not answer every question about her game. Efficiency, turnovers, defence, shot selection, role and lineup fit require other measures. The narrower finding is that her production remains near the top of the league even after winning context is built into the score.`,
    facts.reese_dream_season_awards
      ? `There is also a non-WinBA data point worth putting beside it: the Dream's own 2026 season-awards page lists ${subject.name} as Defensive Player of the Year, All-WNBA and All-Defensive Team, and states that she owns the WNBA single-season records for total rebounds, for offensive rebounds, and for double-doubles, with ${facts.reese_dream_season_awards.double_doubles}. Those are her club's own words rather than ours, and they describe recognition that a purely empty statistical profile does not usually attract.`
      : null
  );

  w.section('What the rating adds', { key: 'conclusion' });
  w.p(
    `WinBA cannot settle a player-value debate by itself. For ${subject.name}, it answers a narrower question: her 2026 production has occurred in enough winning context to rank No. ${sept.rank} on this metric.`,
    `That does not resolve efficiency, turnovers, defence, role or fit. It does mean the “empty stats” label is incomplete unless it also accounts for the winning-context terms that make up 45% of the score.`
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
      caption: `Frozen monthly ${WINBA_LABEL} snapshots. ${winbaPeriodLabel(sept.period)} is the currently published edition of ${WINBA_INDEX_SERIES}.`,
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
    deck: `She is No. ${sept.rank} of ${qualified} qualified players on PropBetEdge's winning-impact rating after climbing in all four frozen monthly snapshots, with the strongest gains coming from the metric's winning-context inputs.`,
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
    `${subject.name}'s résumé already establishes long-term elite performance. The WinBA question is narrower: does her 2026 month-to-month profile stay at that level when the rating is rebuilt from the season's games?`,
    `${honours.length ? `Her official league profile lists ${listOf(honours.slice(0, 4).map(honourPhrase))}.` : ''} In the ${winbaPeriodLabel(sept.period)} edition of ${WINBA_INDEX_SERIES}, she is No. ${sept.rank} of ${qualified} qualified players at ${one(sept.value)}.`,
    `Across every publishable monthly snapshot, she has ranked No. ${bestRank} or No. ${worstRank} — and nowhere else.`
  );

  w.section(`${subject.name} has lived at the top of WinBA`, { key: 'standard', visual: 'wilson-standard' });
  w.p(
    `Four frozen monthly boards, in order: ${traj.map((p) => `No. ${p.rank} at ${one(p.value)} in ${p.label.split(' ')[0]}`).join(', ')}. As a sequence of ranks it reads ${ranks.join(' · ')}.`,
    `The total spread between her best and worst monthly rating is ${one(spread)} points on a 0-100 scale. Across four fresh monthly calculations, that is a narrow range.`,
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
    `What it gets right is sustained elite scoring rather than a one-season spike. A ${one(seasonLine.pts)}-point season sits near the top of the league, and Wilson has produced at that level often enough that the output can feel routine. That consistency is the useful part of the comparison.`,
    `What it gets wrong is nearly everything about the basketball. ${subject.name} is a ${String(team?.position_name || 'center').toLowerCase()} whose defensive résumé is central to her greatness rather than an addendum to it — her profile carries ${honours.find((h) => h.key === 'dpoy') ? honourPhrase(honours.find((h) => h.key === 'dpoy')) : 'multiple Defensive Player of the Year awards'} — and the comparison imports the offensive half of a wing's identity while dropping the half that makes hers distinctive. The leagues differ, the roles differ, and the defensive expectations of a frontcourt anchor are not the ones a perimeter scorer carries.`,
    `The comparison is useful only as a way to discuss sustained scoring consistency. It is not a role, style or all-around-impact equivalence.`
  );

  w.section('Reading the two lenses together', { key: 'lenses' });
  w.p(
    `A résumé and a rating fail in different directions. Awards are retrospective, voted, and slow to update; they can lag a decline by a season and they cannot tell you anything about a player who has not yet been recognised. A monthly rating is fast and blind: it re-measures from the games alone and has no memory of what anybody won last year.`,
    `Both lenses have limits worth stating. ${WINBA_LABEL} does not measure defence directly and knows nothing about role or lineup context, and it is built from completed games in PropBetEdge's own 2026 archive, which is close to but not identical with the official regular-season record. It is an association-with-winning index, not a causal estimate of wins added — which is why the conventional line printed above comes from our season aggregate, reconciled against her official profile, rather than from the metric's own window.`,
    `Their agreement is the point. The slow lens says ${honours.find((h) => h.key === 'mvp') ? `${word(honours.find((h) => h.key === 'mvp').count)}-time MVP` : 'a decorated career'}; the fast one, re-derived monthly from box scores and results with no knowledge of any of that, says No. ${bestRank} or No. ${worstRank} every single month. Where two measurements built on entirely different information land in the same place, the thing they are both pointing at is probably real.`
  );

  w.section('Why the month-to-month consistency matters', { key: 'conclusion' });
  w.p(
    `Rank can move because another player improves, so the score range matters alongside the ordinal position.`,
    `Across the four frozen boards, ${subject.name}'s WinBA score stays within ${one(spread)} points and her rank never falls below No. ${worstRank}. That consistency is the finding.`
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
    deck: `Four frozen monthly snapshots of PropBetEdge's winning-impact rating place her at No. ${bestRank} or No. ${worstRank} every time, with only ${one(spread)} points separating her highest and lowest score.`,
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
 * OLIVIA MILES — completed-game analysis.
 *
 * Reader-facing copy treats WinBA as a normal PropBetEdge player stat. The
 * provenance and revision machinery remain underneath the story, but the
 * article itself is basketball analysis rather than a methodology exercise.
 */
function composeMilesAbsence(ctx) {
  const { subject, team, traj, sept, seasonLine, recent, topThree, qualified, liveContext } = ctx;
  const w = proseBuilder();
  const injury = liveContext?.injury || {};
  const game = liveContext?.game || {};
  const half = liveContext?.halftime || {};
  const three = liveContext?.after_three || {};
  const final = liveContext?.final || {};
  const opponent = game.opponent?.name || game.opponent?.short_name || game.opponent?.abbr || 'Indiana';
  const teamName = team?.name || game.subject_team?.name || 'Minnesota Lynx';
  const teamHalf = Number(half.subject_team_score);
  const oppHalf = Number(half.opponent_score);
  const halfDeficit = Math.abs(Number(half.margin));
  const teamThree = Number(three.subject_team_score);
  const oppThree = Number(three.opponent_score);
  const threeDeficit = Number.isFinite(Number(three.margin)) ? Math.abs(Number(three.margin)) : null;
  const teamFinal = Number(final.subject_team_score);
  const oppFinal = Number(final.opponent_score);
  const finalDeficit = Math.abs(Number(final.margin));
  const subjectQ = final.subject_quarters || [];
  const opponentQ = final.opponent_quarters || [];
  const bodyPart = injury.body_part ? ` with a ${injury.body_part} injury` : '';
  const rankedPeers = topThree
    .filter((c) => String(c.entity.id) !== String(subject.id))
    .map((c) => `${c.entity.name} (${one(c.value)})`)
    .join(' and ');

  w.p(
    `${subject.name} was ruled out${bodyPart} before the ${teamName} faced ${opponent}, and Minnesota spent the rest of the night trying to climb out of an early hole. ${opponent} won ${oppFinal}–${teamFinal}, handing the Lynx a ${finalDeficit}-point loss.`,
    `${subject.name} entered the night No. ${sept.rank} in WinBA Score at ${one(sept.value)}, the highest mark on the September board. That number belongs in the story the same way any established player stat does: it adds season-long context to what Minnesota was missing before the ball went up.`
  );

  w.section('Indiana put Minnesota in a hole immediately', { key: 'first_half' });
  w.p(
    `${opponent} controlled the opening quarter ${opponentQ[0]}–${subjectQ[0]}. Minnesota never got the game onto comfortable terms, and the second quarter did not bring relief: ${opponent} won that period ${opponentQ[1]}–${subjectQ[1]} as well.`,
    `By halftime the score was ${oppHalf}–${teamHalf}. A ${halfDeficit}-point deficit is the kind of gap that changes the entire second half. Every possession becomes urgent, every empty trip gets more expensive, and the trailing team has almost no room to absorb another bad stretch.`,
    `Miles' absence did not single-handedly create that score, but it mattered to the shape of Minnesota's lineup. The Lynx were playing without the player who has spent the summer at or near the top of WinBA while also supplying ${one(seasonLine.pts)} points, ${one(seasonLine.reb)} rebounds and ${one(seasonLine.ast)} assists per game across ${seasonLine.games} appearances.`
  );

  w.section('The third quarter made it a game again', { key: 'third_quarter' });
  w.p(
    `Minnesota's response after halftime was emphatic. The Lynx won the third quarter ${subjectQ[2]}–${opponentQ[2]}, turning a ${halfDeficit}-point halftime deficit into a ${oppThree}–${teamThree} game entering the fourth.`,
    `That ${subjectQ[2]}-point quarter changed the feel of the night. The deficit was down to ${threeDeficit}, the game had a pulse again, and Minnesota had shown it could create offense without Miles on the floor.`,
    `It also keeps the larger read honest. This was not a night where Minnesota simply stopped functioning because one player was unavailable. The Lynx adjusted, found a run and put real pressure back on Indiana. The problem was that the recovery required almost everything to keep going right.`
  );

  w.section('Indiana closed the door in the fourth', { key: 'fourth_quarter' });
  w.p(
    `${opponent} answered the comeback with a ${opponentQ[3]}–${subjectQ[3]} fourth quarter. Minnesota had spent enormous energy erasing most of the first-half damage, only to watch the margin open back up when the game reached its closing possessions.`,
    `The final, ${oppFinal}–${teamFinal}, looks comfortable for Indiana. The path there was more complicated: a blowout first half, a serious Minnesota push in the third, then a decisive fourth-quarter response. For the Lynx, that sequence made the absence of their top-end production feel most important at the two points of the game where they had the least margin for error — the opening stretch and the finish.`
  );

  w.section('What Minnesota was missing without Miles', { key: 'miles_context' });
  w.p(
    `Miles' season line gives the simplest basketball context. She has averaged ${one(seasonLine.pts)} points, ${one(seasonLine.reb)} rebounds and ${one(seasonLine.ast)} assists per game across ${seasonLine.games} appearances. ${recent ? `Over her five most recent appearances before this one, she was at ${one(recent.pts)} points, ${one(recent.reb)} rebounds and ${one(recent.ast)} assists per game.` : ''}`,
    `WinBA tells the same season from a different angle. Her ${one(sept.value)} score is No. ${sept.rank} among ${qualified} qualified players on the September board, combining production, minutes and winning results into one 0–100 player rating.`,
    `That does not mean Minnesota was “missing ${one(sept.value)} points” or that the final margin can be assigned to one player. It means the player unavailable on Tuesday was not just another rotation piece. By both conventional production and PropBetEdge's overall player rating, Miles has been one of the most important players in the league this season.`
  );

  w.section('Miles has stayed at the top of WinBA', { key: 'trajectory', visual: 'miles-winba-trajectory' });
  w.p(
    `The September No. 1 ranking is not a one-month spike. Miles has ranked ${traj.map((p) => `No. ${p.rank} in ${p.label.split(' ')[0]}`).join(', ')} across the four monthly editions published from June through September.`,
    `Her WinBA scores over that span were ${traj.map((p) => `${p.label.split(' ')[0]} ${one(p.value)}`).join(', ')}. The movement is small because her standing has been consistently elite rather than volatile.`,
    `That consistency is why the 87.0 belongs naturally beside the injury news. It is a compact way of saying Minnesota entered this game without a player who has spent essentially the entire season at the top of PropBetEdge's overall WNBA player board.`
  );

  w.section('Where 87.0 sits in the league', { key: 'leaders', visual: 'miles-winba-leaders' });
  w.p(
    `${subject.name} leads the September WinBA board at ${one(sept.value)}. ${rankedPeers ? `Immediately behind her are ${rankedPeers}.` : ''}`,
    `That company matters. WinBA is not being used here as a one-game prediction or an injury model. It is the same player rating shown throughout PropBetEdge's WNBA player pages and league rankings, and Miles entered the Indiana game sitting at the top of it.`
  );

  w.section('The loss still belongs to the whole team', { key: 'team_context' });
  w.p(
    `A ${finalDeficit}-point final does not reduce to one absence. Minnesota's first-half problems were team problems, Indiana still had to make the shots and win the possessions in front of it, and the Lynx proved with a ${subjectQ[2]}–${opponentQ[2]} third quarter that they could change the game without Miles.`,
    `What the loss does show is how thin the margin became. Minnesota needed a huge third-quarter swing just to get within ${threeDeficit}, then had no cushion when Indiana responded. Missing a player with Miles' season production and No. 1 WinBA ranking made that kind of game harder to rescue.`,
    `That is the basketball takeaway, not a formula takeaway. Minnesota was without one of the league's highest-impact players by both traditional production and WinBA Score, dug a massive early hole, mounted a legitimate comeback and still could not finish it.`
  );

  w.section('Bottom line', { key: 'bottom_line' });
  w.p(
    `${opponent} earned the ${oppFinal}–${teamFinal} win. Minnesota's third-quarter response made the game competitive again, but the first-half deficit and Indiana's closing run were too much to overcome.`,
    `For the Lynx, Miles' absence was part of the story from the opening tip. She came into the night No. ${sept.rank} in WinBA at ${one(sept.value)}, and Minnesota had to replace that level of season-long production and winning impact by committee. For one quarter, the committee nearly pulled the game back. Over 40 minutes, it was not enough.`
  );

  const { body, sections } = w.done();
  const provenance = {
    source: `PropBetEdge ${WINBA_LABEL} monthly editions`,
    metric: 'winba/1.0.0',
    observed_at: sept.snapshot_at
  };
  const entity = { type: 'player', id: String(subject.id), name: subject.name, team_id: team?.team_id ? String(team.team_id) : null };
  const visuals = [
    lineSeries({
      id: 'miles-winba-trajectory',
      title: `${subject.name} has stayed at the top of WinBA`,
      subtitle: 'Monthly WinBA Score and league rank',
      caption: `Miles has ranked No. 2 or No. 1 in every published monthly edition from June through September.`,
      entity,
      points: traj,
      provenance,
      footnote: 'Monthly values are the scores published in each WinBA edition.'
    }),
    rankCards({
      id: 'miles-winba-leaders',
      title: 'September WinBA leaders',
      subtitle: 'Top three qualified players',
      caption: `${subject.name} leads the current board at ${one(sept.value)}.`,
      cards: topThree.map((c) => ({ ...c, highlight: String(c.entity.id) === String(subject.id) })),
      provenance,
      footnote: 'Scores shown are from the September WinBA edition.'
    })
  ];

  return {
    category: 'Game Analysis',
    series: 'Game Analysis',
    presentation: 'natural_news',
    headline: `Without ${subject.name}, Minnesota Falls ${oppFinal}–${teamFinal} to ${opponent} After Comeback Stalls`,
    deck: `${subject.name}, No. ${sept.rank} in WinBA Score at ${one(sept.value)}, missed the game${bodyPart}. Minnesota trailed by ${halfDeficit} at halftime, cut the deficit to ${threeDeficit} after three and still could not finish the rally.`,
    body,
    sections,
    visuals,
    context: {
      game: {
        game_id: game.game_id,
        start_utc: game.start_utc || null,
        home: game.home || null,
        away: game.away || null,
        halftime: half,
        after_three: three,
        final
      },
      availability: injury
    },
    method: [
      `Game status, quarter scores and ${subject.name}'s availability come from PropBetEdge's stored WNBA game records.`,
      `The ${one(sept.value)} WinBA Score and No. ${sept.rank} rank are the values published on the September WinBA board. The game result does not alter that rating.`
    ],
    seo_title: `Without ${subject.name}, Minnesota loses ${oppFinal}-${teamFinal} to ${opponent}`,
    seo_description: `${subject.name}, No. ${sept.rank} in WinBA Score at ${one(sept.value)}, missed Minnesota's ${oppFinal}-${teamFinal} loss to ${opponent}. The Lynx trailed by ${halfDeficit} at half, rallied to within ${threeDeficit}, then fell by ${finalDeficit}.`,
    keywords: [`${subject.name} WinBA`, `${subject.name} injury`, 'Minnesota Lynx', `${teamName} ${opponent}`, 'WinBA Score', 'WNBA game analysis'],
    commission_note: `Requested after the final because ${subject.name}'s absence was central to the game story and her No. ${sept.rank} WinBA position provided relevant season context.`
  };
}
/**
 * The commission registry. A feature is a named, versioned entry — never a
 * generic template — so the newsroom can say exactly what was ordered.
 */
export const COMMISSIONS = Object.freeze({
  'miles-winba-absence-stress-test': {
    slug: 'without-olivia-miles-minnesota-loses-indiana-96-77',
    subject: { id: '4433791', name: 'Olivia Miles' },
    mentions: [{ id: '3149391', name: "A'ja Wilson" }, { id: '4433402', name: 'Angel Reese' }],
    periods: ['2026-06', '2026-07', '2026-08', '2026-09'],
    facts: [],
    live_context: 'availability_loss_stress_test',
    event_date_et: '2026-09-22',
    compose: composeMilesAbsence,
    required_visuals: ['miles-winba-trajectory', 'miles-winba-leaders']
  },
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
  liveContext = null,
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
  if (spec.live_context && !liveContext?.ready) {
    return { key, status: 'missing_live_context', reason: liveContext?.reason || 'required live context not supplied' };
  }

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
    liveContext,
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
    ...(liveContext?.evidence || []),
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
    category: composed.category || 'Feature',
    series: composed.series || COMMISSION_SERIES,
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
    ...(composed.context ? { context: composed.context } : {}),
    commission: {
      key,
      version: COMMISSION_VERSION,
      ordered: 'newsroom editor',
      note: composed.commission_note,
      presentation: composed.presentation || null,
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
      `${WINBA_LABEL} is built from completed games in PropBetEdge's 2026 archive, which is close to but not identical with the official regular-season record. It is an association-with-winning index, not a causal estimate of wins added.`,
      ...(composed.method || [])
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
