// THE WINBA INDEX — the monthly editorial franchise around WinBA Score.
//
// One feature per completed ranking period, built from a FROZEN monthly
// snapshot. The article is a permanent record: it never re-reads the live
// leaderboard, so September's Index still reports September's ranks after
// October moves them.
//
// Month-over-month movement is only ever reported from two frozen snapshots.
// The first Index therefore ships with no deltas, and says so, rather than
// inventing a prior month out of the current dataset. `buildWinbaSnapshotAsOf`
// can establish a genuine earlier month from the game archive when the owner
// wants the series backfilled — same frozen formula, only games that had
// actually been played — but nothing is reconstructed implicitly.

import { f1 } from './prose.js';
import { WINBA_LABEL, WINBA_URL, WINBA_METHOD_URL, WINBA_METRIC_ENTITY } from './winba-editorial.js';

export const WINBA_INDEX_VERSION = 'wnba-winba-index/1.0.0';
export const WINBA_INDEX_SERIES = 'The WinBA Index';
export const WINBA_INDEX_DESK = 'winba-index';
export const WINBA_INDEX_KIND = 'winba_index';

/** KV keys. Snapshot identity is the calendar period, which makes reruns idempotent. */
export const winbaMonthlyKey = (period) => `winba:v1:monthly:${period}`;
export const WINBA_MONTHLY_INDEX_KEY = 'winba:v1:monthly:index';
export const WINBA_SLOT_STATE_KEY = 'winba:v1:daily-slot';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TZ = 'America/New_York';

/** Calendar period (YYYY-MM) of an instant, in New York. */
export function winbaPeriodOf(at) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(new Date(at));
  return parts.slice(0, 7);
}

export function winbaPeriodLabel(period) {
  const [y, m] = String(period).split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

export function previousPeriod(period) {
  const [y, m] = String(period).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** First instant AFTER the period, so the period's own games all count. */
export function periodCutoff(period) {
  const [y, m] = String(period).split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01T00:00:00.000Z` : `${y}-${String(m + 1).padStart(2, '0')}-01T00:00:00.000Z`;
}

const kebab = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72).replace(/-+$/, '');

async function hashId(parts, n = 12) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, n);
}

/** Stable identity for a period: a rerun resolves to the same id and slug. */
export async function winbaIndexIdentity(period) {
  const id = await hashId([WINBA_INDEX_KIND, period]);
  const headline = winbaIndexHeadline(period);
  return { id, slug: `${kebab(headline)}-${id.slice(0, 6)}`, headline, period };
}

/** One strong editorial title. Not keyword soup. */
export function winbaIndexHeadline(period) {
  return `${WINBA_INDEX_SERIES}: the WNBA’s top players for ${winbaPeriodLabel(period)}`;
}

// ---------------------------------------------------------------------------
// Frozen monthly snapshot
// ---------------------------------------------------------------------------

/**
 * Freeze the ranked board for a period. Stores only what an article may print,
 * with the roster attributes (position, first-season flag) resolved AT FREEZE
 * TIME so a later trade or roster edit cannot change a published Index.
 */
export function freezeWinbaMonthly(snapshot, { period, playerById = new Map(), teamById = new Map(), at = new Date().toISOString(), top = 25 } = {}) {
  if (!snapshot?.rows?.length) return null;
  const qualified = snapshot.rows.filter((r) => r.qualified && Number.isFinite(Number(r.score)));
  if (!qualified.length) return null;
  const ranked = [...qualified].sort((a, b) => Number(b.score) - Number(a.score) || String(a.athlete_id).localeCompare(String(b.athlete_id)));

  const rows = ranked.slice(0, top).map((r, i) => {
    const p = playerById.get(String(r.athlete_id)) || null;
    const team = teamById.get(String(r.team_id)) || null;
    return {
      rank: i + 1,
      player_id: String(r.athlete_id),
      player_name: r.name || p?.name || null,
      team_id: r.team_id ? String(r.team_id) : null,
      team_name: team?.name || null,
      position: p?.position || null,
      // `Number(null)` is 0, so a missing experience value would otherwise
      // label a veteran a first-season player. Unknown stays unknown.
      first_wnba_season: firstSeasonFlag(p),
      score: Number(r.score),
      production_percentile: num(r.components?.production_percentile),
      win_rate: num(r.components?.win_rate),
      games: num(r.sample?.games),
      wins: num(r.sample?.wins),
      averages: {
        min: num(r.averages?.min), pts: num(r.averages?.pts),
        reb: num(r.averages?.reb), ast: num(r.averages?.ast)
      }
    };
  });

  // Whether the ranking period had actually closed when the board was frozen.
  // A mid-month board is a legitimate Index, but it must not claim a player
  // "finishes" the month on top.
  const frozenAt = Date.parse(at);
  const periodComplete = Number.isFinite(frozenAt) && frozenAt >= Date.parse(periodCutoff(period));

  return {
    version: WINBA_INDEX_VERSION,
    metric_version: snapshot.version || null,
    period,
    period_label: winbaPeriodLabel(period),
    period_complete: periodComplete,
    season: snapshot.season ?? null,
    frozen_at: at,
    snapshot_at: snapshot.generated_at || null,
    leaderboard_as_of: snapshot.as_of || snapshot.generated_at || null,
    qualified_count: snapshot.qualified_count ?? qualified.length,
    provisional_count: snapshot.provisional_count ?? null,
    games_used: snapshot.games_used ?? null,
    rows
  };
}

const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

/** True only when the roster states zero prior WNBA seasons. Never inferred. */
function firstSeasonFlag(player) {
  const raw = player?.experience_years;
  if (raw === null || raw === undefined || raw === '') return null;
  const years = Number(raw);
  return Number.isFinite(years) ? years === 0 : null;
}

/**
 * Movement between two FROZEN snapshots. Returns null when the prior period is
 * absent — there is no such thing as an inferred previous rank here.
 */
export function winbaMovement(current, prior) {
  if (!current?.rows?.length || !prior?.rows?.length) return null;
  const was = new Map(prior.rows.map((r) => [r.player_id, r]));
  const moves = [];
  for (const row of current.rows) {
    const before = was.get(row.player_id);
    if (!before) { moves.push({ ...row, prior_rank: null, prior_score: null, rank_delta: null, score_delta: null, entered: true }); continue; }
    moves.push({
      ...row,
      prior_rank: before.rank,
      prior_score: before.score,
      rank_delta: before.rank - row.rank,
      score_delta: Math.round((row.score - before.score) * 10) / 10,
      entered: false
    });
  }
  const ranked = moves.filter((m) => m.rank_delta !== null);
  return {
    from_period: prior.period,
    to_period: current.period,
    moves,
    risers: ranked.filter((m) => m.rank_delta > 0).sort((a, b) => b.rank_delta - a.rank_delta),
    fallers: ranked.filter((m) => m.rank_delta < 0).sort((a, b) => a.rank_delta - b.rank_delta),
    entered: moves.filter((m) => m.entered)
  };
}

// ---------------------------------------------------------------------------
// The article
// ---------------------------------------------------------------------------

const poss = (name) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);
const statBits = (a) => [
  Number.isFinite(a?.pts) ? `${f1(a.pts)} points` : null,
  Number.isFinite(a?.reb) ? `${f1(a.reb)} rebounds` : null,
  Number.isFinite(a?.ast) ? `${f1(a.ast)} assists` : null
].filter(Boolean).join(', ');

const POSITION_NAME = { G: 'guard', F: 'forward', C: 'center' };

/**
 * Build the monthly feature from the frozen board. Sections render only when
 * their facts exist, and every number printed comes from the snapshot.
 */
export function composeWinbaIndex(frozen, { movement = null, identity, priorArticle = null } = {}) {
  if (!frozen?.rows?.length) return null;
  const rows = frozen.rows;
  const leader = rows[0];
  const label = frozen.period_label;
  const body = [];
  const sections = [];
  const open = (title, render = null) => sections.push({
    title: title || null,
    key: title ? kebab(title) : 'lede',
    first: body.length,
    count: 0,
    ...(render ? { render } : {})
  });
  const close = () => { const s = sections.at(-1); if (s) s.count = body.length - s.first; };

  // ---- lede: the story of the board, not a list header.
  // It opens an untitled section so the renderer, which prints only paragraphs
  // covered by a section, carries it. Without this the lede is dropped.
  open(null);
  const leadBits = statBits(leader.averages);
  const closed = frozen.period_complete !== false;
  body.push(
    `${leader.player_name} ${closed ? `finishes ${label}` : `leads ${label} so far`} at the top of ${WINBA_LABEL}, PropBetEdge’s winning-impact rating, with a mark of ${Math.round(leader.score)}${leader.team_name ? ` for the ${leader.team_name}` : ''}${leadBits ? ` on ${leadBits} a game` : ''}.`
  );
  const second = rows[1];
  if (second) {
    const gap = Math.round((leader.score - second.score) * 10) / 10;
    body.push(
      gap >= 2
        ? `${second.player_name} is next at ${Math.round(second.score)}, ${f1(gap)} points back — the clearest separation at the top of the board this month.`
        : `${second.player_name} is a stride behind at ${Math.round(second.score)}, close enough that ${poss(leader.player_name)} hold on the top spot is not settled.`
    );
  }
  if (!closed) {
    body.push(`These are the standings as of ${new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'long', day: 'numeric' }).format(new Date(frozen.leaderboard_as_of || frozen.snapshot_at))}, with ${label} still being played. The board is frozen at this point and the ranks recorded here are the ones the next edition will measure against.`);
  }
  body.push(
    `${WINBA_LABEL} is built only from completed WNBA games: Box Impact (points plus 1.2 times rebounds plus 1.5 times assists) measured per 36 minutes against the league, the player’s win rate, the share of her production that came in wins, and her court share. It is an association-with-winning index, not a causal estimate of wins added. ${frozen.qualified_count} players qualified this month at 10 games and 250 minutes.`
  );

  close();

  // ---- the league leaders
  // The renderer draws this section as leader cards (photo, team, position,
  // rating, rank, conventional line). The paragraphs remain the accessible and
  // feed-safe form of the same frozen facts, so nothing depends on the cards.
  open('The league leaders', 'winba_leaders');
  for (const r of rows.slice(0, 10)) {
    const bits = statBits(r.averages);
    const posName = r.position ? POSITION_NAME[r.position] || null : null;
    body.push(
      `No. ${r.rank} ${r.player_name}, ${Math.round(r.score)}${r.team_name ? ` — ${r.team_name}` : ''}${posName ? ` ${posName}` : ''}${bits ? `, ${bits} in ${f1(r.averages.min)} minutes` : ''}${Number.isFinite(r.win_rate) ? `, ${Math.round(r.win_rate)}% of her games won` : ''}.`
    );
  }
  close();

  // ---- what changed (only with two frozen boards)
  if (movement?.risers?.length || movement?.fallers?.length) {
    open('What changed this month');
    const riser = movement.risers[0];
    if (riser && riser.rank_delta >= 2) {
      body.push(`${riser.player_name} is the month’s clearest riser, up ${riser.rank_delta} places from No. ${riser.prior_rank} in the ${winbaPeriodLabel(movement.from_period)} Index to No. ${riser.rank}, with her score moving from ${riser.prior_score} to ${Math.round(riser.score)}.`);
    }
    const faller = movement.fallers[0];
    if (faller && faller.rank_delta <= -2) {
      body.push(`${faller.player_name} moves the other way, from No. ${faller.prior_rank} to No. ${faller.rank}${Number.isFinite(faller.score_delta) ? ` on a ${f1(Math.abs(faller.score_delta))}-point drop in rating` : ''}.`);
    }
    const entered = movement.entered.filter((m) => m.rank <= 10);
    if (entered.length) {
      body.push(`${entered.map((m) => `${m.player_name} (No. ${m.rank})`).join(', ')} ${entered.length === 1 ? 'is new' : 'are new'} to the top 10 since ${winbaPeriodLabel(movement.from_period)}.`);
    }
    // A month in which nothing moved more than a place is still a finding, and
    // saying so is better than opening a section that reports nothing.
    if (sections.at(-1).first === body.length) {
      const swaps = movement.moves
        .filter((m) => m.rank_delta !== null && m.rank_delta !== 0 && m.rank <= 5)
        .sort((a, b) => a.rank - b.rank)
        .slice(0, 3);
      body.push(
        swaps.length
          ? `The board held its shape from ${winbaPeriodLabel(movement.from_period)}: ${swaps.map((m) => `${m.player_name} moved from No. ${m.prior_rank} to No. ${m.rank}`).join(', ')}, and no player in the top 25 moved more than a single place.`
          : `The order is unchanged from ${winbaPeriodLabel(movement.from_period)}: every ranked player holds the place she held a month ago.`
      );
    }
    close();
  } else {
    open('Where the series starts');
    body.push(`This is the first WinBA Index, so there is no prior frozen board to measure movement against. Month-over-month risers and fallers begin with the next edition, compared against the ${label} ranks recorded here.`);
    close();
  }

  // ---- positional leaders
  const byPos = ['G', 'F', 'C'].map((p) => ({ pos: p, row: rows.find((r) => r.position === p) })).filter((x) => x.row);
  if (byPos.length >= 2) {
    open('Who leads each position');
    for (const { pos, row } of byPos) {
      body.push(`${POSITION_NAME[pos] ? POSITION_NAME[pos].replace(/^./, (c) => c.toUpperCase()) : pos}: ${row.player_name}${row.team_name ? `, ${row.team_name}` : ''} — ${Math.round(row.score)}, No. ${row.rank} overall${statBits(row.averages) ? ` on ${statBits(row.averages)}` : ''}.`);
    }
    close();
  }

  // ---- rookie watch
  const rookie = rows.find((r) => r.first_wnba_season === true);
  if (rookie) {
    open('The first-season watch');
    body.push(
      rookie.rank === 1
        ? `The highest-rated player on the board is in her first WNBA season: ${rookie.player_name} leads the league outright at ${Math.round(rookie.score)}.`
        : `${rookie.player_name} is the highest-rated player in her first WNBA season, No. ${rookie.rank} overall at ${Math.round(rookie.score)}${rookie.team_name ? ` for the ${rookie.team_name}` : ''}.`
    );
    const others = rows.filter((r) => r.first_wnba_season === true && r.player_id !== rookie.player_id).slice(0, 3);
    if (others.length) {
      const named = others.map((r) => `${r.player_name} (No. ${r.rank}, ${Math.round(r.score)})`);
      body.push(`${named.length > 1 ? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}` : named[0]} also ${named.length === 1 ? 'rates' : 'rate'} inside the top ${rows.length} in a first WNBA season.`);
    }
    close();
  }

  // ---- team depth
  const byTeam = new Map();
  for (const r of rows) {
    if (!r.team_id) continue;
    const cur = byTeam.get(r.team_id) || { team_id: r.team_id, team_name: r.team_name, players: [] };
    cur.players.push(r);
    byTeam.set(r.team_id, cur);
  }
  const deep = [...byTeam.values()].filter((t) => t.players.length >= 2)
    .sort((a, b) => b.players.length - a.players.length || a.players[0].rank - b.players[0].rank);
  if (deep.length) {
    open('The teams with more than one');
    for (const t of deep.slice(0, 4)) {
      body.push(`${t.team_name || `Team ${t.team_id}`}: ${t.players.map((p) => `${p.player_name} (No. ${p.rank}, ${Math.round(p.score)})`).join(', ')}.`);
    }
    close();
  }

  // ---- synthesis, from observable components only
  open('What the board is telling us');
  const topWinRate = rows.slice(0, 10).filter((r) => Number.isFinite(r.win_rate));
  if (topWinRate.length >= 5) {
    const avgWin = topWinRate.reduce((s, r) => s + r.win_rate, 0) / topWinRate.length;
    body.push(`The top 10 won ${Math.round(avgWin)}% of the games they played. Because a quarter of ${WINBA_LABEL} is win rate and a fifth is the share of production that came in wins, the board rewards players whose output arrives in victories — which is why it is read as a winning-impact rating rather than a volume leaderboard.`);
  }
  const topProd = rows.slice(0, 10).filter((r) => Number.isFinite(r.production_percentile));
  if (topProd.length >= 5) {
    const lo = Math.min(...topProd.map((r) => r.production_percentile));
    body.push(`Every player in the top 10 sits at or above the ${Math.floor(lo)}th percentile of Box Impact per 36, so none of these ratings rests on playing time alone.`);
  }
  close();

  const headline = identity?.headline || winbaIndexHeadline(frozen.period);
  const deck = `${leader.player_name} leads at ${Math.round(leader.score)}${second ? ` from ${second.player_name} at ${Math.round(second.score)}` : ''}, with ${frozen.qualified_count} qualified players ranked on PropBetEdge’s winning-impact rating for ${label}.`;

  const players = rows.slice(0, 10).map((r) => ({ type: 'player', id: r.player_id, name: r.player_name, team_id: r.team_id }));
  const teams = [...new Map(rows.slice(0, 10).filter((r) => r.team_id).map((r) => [r.team_id, { type: 'team', id: r.team_id, name: r.team_name }])).values()];

  return {
    kind: WINBA_INDEX_KIND,
    desk: WINBA_INDEX_DESK,
    category: WINBA_INDEX_SERIES,
    series: WINBA_INDEX_SERIES,
    period: frozen.period,
    period_label: label,
    headline,
    deck,
    body,
    sections: sections.filter((s) => s.count > 0),
    lead_player_id: leader.player_id,
    lead_team_id: leader.team_id,
    primary_subject: WINBA_INDEX_SERIES,
    entities: [...players, ...teams, { ...WINBA_METRIC_ENTITY }],
    winba_board: frozen,
    // Everything a leader card may show, resolved from the frozen board only.
    // `delta` is present only when a prior frozen board supplied it.
    leader_cards: rows.slice(0, 10).map((r) => {
      const move = movement?.moves?.find((m) => m.player_id === r.player_id) || null;
      return {
        rank: r.rank,
        player_id: r.player_id,
        player_name: r.player_name,
        team_id: r.team_id,
        team_name: r.team_name,
        position: r.position,
        position_name: r.position ? POSITION_NAME[r.position] || null : null,
        score: Math.round(r.score),
        averages: r.averages,
        games: r.games,
        win_rate: Number.isFinite(r.win_rate) ? Math.round(r.win_rate) : null,
        first_wnba_season: r.first_wnba_season,
        delta: move && move.rank_delta !== null
          ? { prior_rank: move.prior_rank, rank_delta: move.rank_delta, score_delta: move.score_delta }
          : null,
        href: `/players/${r.player_id}`,
        team_href: r.team_id ? `/teams/${r.team_id}` : null
      };
    }),
    winba_movement: movement ? { from_period: movement.from_period, risers: movement.risers.slice(0, 5), fallers: movement.fallers.slice(0, 5) } : null,
    prior_index: priorArticle ? { period: priorArticle.period, slug: priorArticle.slug, headline: priorArticle.headline } : null,
    links: { winba: WINBA_URL, methodology: WINBA_METHOD_URL },
    generator: { type: 'deterministic', version: WINBA_INDEX_VERSION },
    words: body.join(' ').split(/\s+/).filter(Boolean).length
  };
}

/**
 * Generate at most one Index per calendar period.
 *
 * Idempotency is by stored publication state, not by article search: a cron
 * firing twelve times in a month produces one article, and a rerun returns the
 * existing record untouched, including its original published_at.
 */
export async function runWinbaIndex({
  period,
  snapshot,
  playerById = new Map(),
  teamById = new Map(),
  at = new Date().toISOString(),
  getMonthly,
  putMonthly,
  getIndexState,
  putIndexState,
  getArticle,
  putArticle,
  force = false
} = {}) {
  const target = period || winbaPeriodOf(at);
  const state = (await getIndexState()) || { version: WINBA_INDEX_VERSION, published: {} };
  const already = state.published?.[target] || null;

  if (already && !force) {
    const existing = await getArticle(already.id).catch(() => null);
    return { period: target, status: 'already_published', id: already.id, slug: already.slug, article: existing, published_at: already.published_at };
  }

  let frozen = await getMonthly(target).catch(() => null);
  if (!frozen) {
    frozen = freezeWinbaMonthly(snapshot, { period: target, playerById, teamById, at });
    if (!frozen) return { period: target, status: 'no_snapshot' };
    await putMonthly(target, frozen);
  }

  const prior = await getMonthly(previousPeriod(target)).catch(() => null);
  const movement = winbaMovement(frozen, prior);
  const identity = await winbaIndexIdentity(target);
  const priorPublished = state.published?.[previousPeriod(target)] || null;

  const composed = composeWinbaIndex(frozen, { movement, identity, priorArticle: priorPublished });
  if (!composed) return { period: target, status: 'not_composable' };

  // The depth target for the franchise. Below it, the board did not support a
  // feature and nothing is published rather than padded.
  if (composed.words < 500) {
    return { period: target, status: 'held_thin', words: composed.words, frozen_rows: frozen.rows.length };
  }

  const firstPublished = already?.published_at || at;
  const article = {
    ...composed,
    id: identity.id,
    slug: identity.slug,
    status: 'published',
    published_at: firstPublished,
    first_published_at: firstPublished,
    updated_at: at,
    revisions: already ? [...(already.revisions || []), { at, kind: 'editorial_upgrade', generator: WINBA_INDEX_VERSION }] : [],
    provenance: {
      generated_at: at,
      source_observed_at: frozen.snapshot_at,
      leaderboard_as_of: frozen.leaderboard_as_of
    }
  };

  await putArticle(article);
  const published = { ...(state.published || {}), [target]: { id: identity.id, slug: identity.slug, period: target, headline: identity.headline, published_at: firstPublished, frozen_at: frozen.frozen_at } };
  await putIndexState({ version: WINBA_INDEX_VERSION, published });

  return { period: target, status: already ? 'regenerated' : 'published', id: identity.id, slug: identity.slug, words: composed.words, movement: Boolean(movement), article };
}
