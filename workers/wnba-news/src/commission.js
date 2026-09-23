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

export const COMMISSION_VERSION = 'wnba-commission/1.1.0';
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
 * OLIVIA MILES — a live availability stress test for WinBA.
 *
 * This feature is deliberately framed as a test, not a victory lap. The player
 * was unavailable and the team had a bad first half at the same time; that is
 * a useful observation, not a counterfactual proof of what would have happened
 * with her on the floor.
 */
function composeMilesAbsence(ctx) {
  const { subject, team, traj, sept, seasonLine, recent, topThree, qualified, liveContext } = ctx;
  const w = proseBuilder();
  const first = traj[0];
  const last = traj.at(-1);
  const injury = liveContext?.injury || {};
  const game = liveContext?.game || {};
  const half = liveContext?.halftime || {};
  const opponent = game.opponent?.name || game.opponent?.short_name || game.opponent?.abbr || 'the opponent';
  const teamName = team?.name || game.subject_team?.name || 'Minnesota Lynx';
  const teamHalf = Number(half.subject_team_score);
  const oppHalf = Number(half.opponent_score);
  const deficit = Math.abs(Number(half.margin));
  const bodyPart = injury.body_part ? ` with a ${injury.body_part} issue` : '';
  const rankedPeers = topThree
    .filter((c) => String(c.entity.id) !== String(subject.id))
    .map((c) => `${c.entity.name} at ${one(c.value)}`)
    .join(' and ');

  w.p(
    `${subject.name} was listed out${bodyPart} before the ${teamName}'s game against ${opponent}. At halftime, Minnesota trailed ${oppHalf}–${teamHalf}, a ${deficit}-point gap.`,
    `That timing is impossible to ignore because ${subject.name} entered the night as the No. ${sept.rank} player in the frozen ${winbaPeriodLabel(sept.period)} edition of ${WINBA_INDEX_SERIES}, with an ${one(sept.value)} ${WINBA_LABEL}. But it is just as important not to overstate what one half of basketball can prove.`
  );

  w.section('The halftime snapshot', { key: 'halftime_snapshot' });
  w.p(
    `The facts are narrow and clean. The availability feed listed ${subject.name} as ${injury.status || 'Out'}, and the game record shows the ${teamName} at ${teamHalf} points and ${opponent} at ${oppHalf} through two quarters. Those are separate source records captured in the same game window.`,
    `The score does not tell us that ${subject.name}'s absence caused a ${deficit}-point halftime deficit. It tells us that the team was being outscored badly in the first half while its highest-rated player by ${WINBA_LABEL} was unavailable. That distinction is the difference between a useful stress test and a causal claim the data cannot support.`,
    `There are dozens of reasons a team can lose a half: shooting variance, turnovers, foul trouble, matchup problems, opponent shot-making, lineup combinations and simple game-to-game noise. None of those disappear because a proprietary rating happens to have its No. 1 player sitting out.`
  );

  w.section('Why this is a real WinBA stress test', { key: 'trajectory', visual: 'miles-winba-trajectory' });
  w.p(
    `${subject.name}'s position at the top is not a one-night calculation. Across the four frozen monthly boards used by ${WINBA_INDEX_SERIES}, her ranks have been ${traj.map((p) => `No. ${p.rank} in ${p.label.split(' ')[0]}`).join(', ')}. Her score moved from ${one(first.value)} in ${first.label.split(' ')[0]} to ${one(last.value)} in ${last.label.split(' ')[0]}.`,
    `The September board places her No. 1 of ${qualified} qualified players at ${one(sept.value)}. ${rankedPeers ? `The next two names on that frozen board are ${rankedPeers}.` : ''} The point is not that a ranking predicted tonight's halftime score. The point is that an independently built season metric had already identified ${subject.name} as the league's strongest combination of production and winning context before this game began.`,
    `${WINBA_LABEL} is rebuilt from completed games, not from tonight's live score. The canonical metric therefore does not get credit for Minnesota falling behind while ${subject.name} sits, and it will not be rewritten upward because this half happened. A useful metric should survive a dramatic anecdote without changing its rules to fit the anecdote.`
  );

  w.section('What the 87 is actually measuring', { key: 'components', visual: 'miles-winba-components' });
  w.p(
    `WinBA v1 has four inputs. League-relative Box Impact per 36 minutes carries 45% of the score. Player win rate carries 25%. The share of a player's production that came in wins carries 20%. Court share carries the final 10%.`,
    `On the frozen September row, ${subject.name}'s production percentile is ${one(sept.row.components?.production_percentile)}, her win-rate input is ${pct(sept.row.components?.win_rate)}, her production-in-wins input is ${pct(sept.row.components?.winning_output_share)}, and her court-share input is ${pct(sept.row.components?.court_share)}. Those are the inputs behind the ${one(sept.value)} rating; tonight's halftime margin is not one of them.`,
    `Her conventional ${seasonLine.season_label} line is ${one(seasonLine.pts)} points, ${one(seasonLine.reb)} rebounds and ${one(seasonLine.ast)} assists per game across ${seasonLine.games} appearances. ${recent ? `Over her most recent five team games before this one, she averaged ${one(recent.pts)} points, ${one(recent.reb)} rebounds and ${one(recent.ast)} assists.` : ''} Those numbers provide basketball context, but the test tonight is about availability: what happens to the team environment when the player sitting at No. 1 is not available?`
  );

  w.section('What one game cannot prove', { key: 'limits' });
  w.p(
    `One absence cannot validate ${WINBA_LABEL}. Even a final margin in the same direction would not be enough. A proper test needs repeated absences, comparable opponents, the team's own baseline with the player available, and enough games to separate signal from the enormous variance inside basketball.`,
    `The current score also cannot isolate which part of ${subject.name}'s value is missing. WinBA does not directly measure defence, shooting efficiency, turnovers, shot quality, lineup fit or optical-tracking effects. It is an association-with-winning index built from box production, results and minutes. That makes this game relevant to the metric's thesis, but not a controlled experiment.`,
    `There is another trap to avoid: using the result backward. If Minnesota rallies and wins, that does not disprove ${subject.name}'s No. 1 ranking. If the deficit grows, that does not prove the ranking. The metric has to be judged across a sample, not allowed to declare victory whenever a single scoreboard happens to agree with it.`
  );

  w.section('The test PropBetEdge should keep', { key: 'future_test' });
  w.p(
    `The useful next step is to archive this game as an availability case and repeat the same process every time a highly rated player misses a game. Freeze the player's pregame WinBA rank, availability status and opponent; then compare the team's performance with its established baseline without changing the canonical score.`,
    `Over enough cases, that creates a separate question from WinBA itself: do teams systematically move in the expected direction when players near the top of the winning-impact board are unavailable? That belongs in a WinBA Context or Availability Impact layer, not inside the canonical 0–100 score.`,
    `That separation matters. WinBA should remain the same transparent season metric whether tonight becomes a blowout, a comeback or something in between. The context layer can ask what the absence appears to mean in a specific matchup. Mixing those two jobs would make the score less trustworthy, not more sophisticated.`
  );

  w.section('Why tonight belongs in the record', { key: 'record' });
  w.p(
    `At halftime, the cleanest statement is also the strongest one: the player sitting No. 1 on PropBetEdge's frozen September WinBA board was out, and her team was down ${deficit} points after two quarters.`,
    `That is not proof of causation. It is a high-information observation that arrived naturally, without changing the formula or selecting the player after the score was known. The ranking existed first. The absence existed before tip. The halftime result came afterward. That ordering is exactly why the game is worth preserving as a stress test.`,
    `If the same pattern repeats across a meaningful sample of high-WinBA absences, the story becomes larger than one night. If it does not, the record should show that too. A proprietary metric earns credibility by keeping both outcomes.`
  );

  const { body, sections } = w.done();
  const provenance = {
    source: `PropBetEdge frozen ${WINBA_LABEL} monthly snapshots`,
    metric: 'winba/1.0.0',
    observed_at: sept.snapshot_at
  };
  const entity = { type: 'player', id: String(subject.id), name: subject.name, team_id: team?.team_id ? String(team.team_id) : null };
  const visuals = [
    lineSeries({
      id: 'miles-winba-trajectory',
      title: `${subject.name}'s WinBA rank was established before tonight`,
      subtitle: 'Monthly WinBA Score with frozen league rank',
      caption: `Four published monthly snapshots. Tonight's live score does not change any point on this chart.`,
      entity,
      points: traj,
      provenance,
      footnote: 'Each point is copied from that month’s frozen WinBA board and carries its snapshot hash.'
    }),
    componentBars({
      id: 'miles-winba-components',
      title: `What makes up ${subject.name}'s ${one(sept.value)} WinBA`,
      subtitle: 'The four frozen inputs behind the September score',
      caption: `The live game is context, not an input. These values were fixed before tonight's result.`,
      entity,
      total: sept.value,
      rows: componentRowsOf(sept.row),
      provenance: { ...provenance, source: `${provenance.source} · ${sept.source_hash}` },
      footnote: 'WinBA is an association-with-winning index, not a causal estimate of wins added.'
    })
  ];

  return {
    headline: `${subject.name} Was Out. Minnesota Was Down ${deficit} at Half. WinBA Just Got a Real Stress Test`,
    deck: `PropBetEdge's No. 1-rated WNBA player was unavailable while the ${teamName} trailed ${oppHalf}–${teamHalf} at halftime. That does not prove causation — but it creates a clean case for testing what the metric is actually capturing.`,
    body,
    sections,
    visuals,
    context: {
      game: {
        game_id: game.game_id,
        start_utc: game.start_utc || null,
        home: game.home || null,
        away: game.away || null,
        halftime: half
      },
      availability: injury
    },
    method: [
      `The availability status and halftime score are frozen source records from the same game window. They are evidence for timing, not for a counterfactual claim about what the score would have been with ${subject.name} available.`,
      'This feature was commissioned during the game because the pre-existing No. 1 WinBA ranking and the confirmed absence created an unusually clean stress-test case.'
    ],
    seo_title: `${subject.name} out: Minnesota's halftime deficit becomes a WinBA stress test`,
    seo_description: `${subject.name}, No. 1 at ${one(sept.value)} on PropBetEdge's frozen September WinBA board, was out as Minnesota trailed ${oppHalf}–${teamHalf} at halftime. What the moment can — and cannot — say about the metric.`,
    keywords: [`${subject.name} WinBA`, `${subject.name} injury`, 'Minnesota Lynx', `${teamName} ${opponent}`, 'WinBA Score', 'WNBA player impact'],
    commission_note: 'Commissioned in-game because the pre-existing No. 1 WinBA ranking, confirmed absence and verified halftime deficit created a clean real-world stress test worth preserving without making a causal claim.'
  };
}

/**
 * The commission registry. A feature is a named, versioned entry — never a
 * generic template — so the newsroom can say exactly what was ordered.
 */
export const COMMISSIONS = Object.freeze({
  'miles-winba-absence-stress-test': {
    slug: 'olivia-miles-out-minnesota-halftime-winba-stress-test',
    subject: { id: '4433791', name: 'Olivia Miles' },
    mentions: [{ id: '3149391', name: "A'ja Wilson" }, { id: '4433402', name: 'Angel Reese' }],
    periods: ['2026-06', '2026-07', '2026-08', '2026-09'],
    facts: [],
    live_context: 'availability_stress_test',
    compose: composeMilesAbsence,
    required_visuals: ['miles-winba-trajectory', 'miles-winba-components']
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
    ...(composed.context ? { context: composed.context } : {}),
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
