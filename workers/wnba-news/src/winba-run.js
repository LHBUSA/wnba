// The WinBA passes, run after the article pass has finished.
//
// Deliberately a POST-PASS rather than a hook inside article generation. The
// ordering is the guarantee: substance is decided, gated and written first, and
// only then may a story be enriched. A metric that cannot run until a story has
// already earned publication cannot help it earn publication.
//
// It also keeps this lane out of the article generators entirely, so the
// newsroom's quality work and the WinBA work do not touch the same files.

import {
  applyWinbaContext,
  winbaSlotFor,
  winbaReferenceFor,
  winbaEligibility,
  WINBA_ELIGIBLE_KINDS,
  WINBA_EDITORIAL_VERSION
} from './winba-editorial.js';
import {
  runWinbaIndex,
  winbaPeriodOf,
  winbaMonthlyKey,
  WINBA_MONTHLY_INDEX_KEY,
  WINBA_SLOT_STATE_KEY,
  WINBA_INDEX_VERSION
} from './winba-index.js';
import { etDate } from './prose.js';

const ITEM = (id) => `art:v1:item:${id}`;
const ITEM_TTL = { expirationTtl: 120 * 86400 };

/**
 * Preference order when several stories qualify on the same day. A performance
 * or recap is where a season-long rating reads most naturally; a transaction is
 * where it reads least naturally, so it goes last.
 */
const KIND_PREFERENCE = ['performance', 'result', 'preview', 'injury', 'trend', 'transaction'];

/**
 * Choose today's one story, deterministically.
 *
 * Ranked by story kind, then by the player's standing on the board, then by id
 * so the same run always makes the same choice.
 */
export function rankWinbaCandidates(cards, snapshot) {
  const rankOf = new Map((snapshot?.rows || []).filter((r) => r.qualified).map((r) => [String(r.athlete_id), Number(r.rank)]));
  return (cards || [])
    .filter((c) => c && !c.superseded_by && !c.duplicate_of
      && c.status === 'published' && c.quality_state !== 'retired_from_index' && c.quality_state !== 'external_coverage'
      && WINBA_ELIGIBLE_KINDS.includes(String(c.kind))
      && c.lead_player_id != null && rankOf.has(String(c.lead_player_id)))
    .map((c) => ({
      card: c,
      kindRank: KIND_PREFERENCE.indexOf(String(c.kind)) < 0 ? KIND_PREFERENCE.length : KIND_PREFERENCE.indexOf(String(c.kind)),
      playerRank: rankOf.get(String(c.lead_player_id))
    }))
    .sort((a, b) => a.kindRank - b.kindRank || a.playerRank - b.playerRank || String(a.card.id).localeCompare(String(b.card.id)))
    .map((x) => x.card);
}

/**
 * The daily lane. At most one story gains a frozen WinBA reference.
 *
 * Only stories first published on the slot's own day are considered, so the
 * pass can never reach back and decorate history. `winbaReferenceFor` enforces
 * the same rule again from the article's own generation cutoff.
 */
export async function runWinbaDaily(env, { snapshot, dict = null, at = new Date().toISOString() } = {}) {
  if (!env?.NEWS_KV) return { skipped: 'no_kv' };
  if (!snapshot?.rows?.length) return { skipped: 'no_winba_snapshot' };

  const state = (await env.NEWS_KV.get(WINBA_SLOT_STATE_KEY, 'json')) || { version: WINBA_EDITORIAL_VERSION, days: {} };
  const { day, claim } = winbaSlotFor(state, at);
  if (claim) return { day, status: 'already_used', article_id: claim.article_id, player_id: claim.player_id };

  const index = (await env.NEWS_KV.get('art:v1:index', 'json')) || [];
  const today = etDate(at);
  const sameDay = index.filter((c) => c.first_published_at && etDate(c.first_published_at) === today);
  const candidates = rankWinbaCandidates(sameDay, snapshot);
  if (!candidates.length) return { day, status: 'no_candidate', considered: sameDay.length };

  const teamById = dict?.teamById || new Map();
  const declined = [];

  for (const card of candidates) {
    const item = await env.NEWS_KV.get(ITEM(card.id), 'json');
    if (!item) continue;
    const boardRow = (snapshot.rows || []).find((r) => String(r.athlete_id) === String(item.lead_player_id)) || null;
    const team = teamById.get?.(String(item.lead_team_id)) || null;
    const out = applyWinbaContext(item, {
      snapshot,
      state,
      at,
      averages: boardRow?.averages || null,
      teamName: team?.short_name || team?.name || null
    });
    if (!out.applied) { declined.push({ slug: card.slug, reason: out.reason }); continue; }

    await env.NEWS_KV.put(ITEM(out.article.id), JSON.stringify(out.article), ITEM_TTL);
    // Mirror onto the card so listings can show the chip without a second read.
    const next = index.map((c) => (c.id === out.article.id
      ? { ...c, winba_reference: out.article.winba_reference, entities: out.article.entities }
      : c));
    await env.NEWS_KV.put('art:v1:index', JSON.stringify(next));
    await env.NEWS_KV.put(WINBA_SLOT_STATE_KEY, JSON.stringify(out.state));

    return {
      day,
      status: 'applied',
      article_id: out.article.id,
      slug: out.article.slug,
      kind: out.article.kind,
      player_id: out.article.winba_reference.player_id,
      player_name: out.article.winba_reference.player_name,
      score: out.article.winba_reference.score,
      rank: out.article.winba_reference.rank,
      sentence: out.article.winba_sentence,
      considered: candidates.length,
      declined: declined.slice(0, 5)
    };
  }
  return { day, status: 'no_eligible_candidate', considered: candidates.length, declined: declined.slice(0, 8) };
}

/**
 * When a period's Index is due.
 *
 * The scheduled rule is the completed ranking period: the board is frozen once
 * the month has closed. A period still in progress is only ever published on an
 * explicit force, and it says so in its own copy rather than claiming the month
 * finished.
 */
export function winbaIndexDue(at, { period = null, force = false } = {}) {
  const now = new Date(at);
  const current = winbaPeriodOf(at);
  const target = period || previousOf(current);
  if (force) return { due: true, period: period || current, reason: 'forced' };
  // Publish the month just completed, within its first week.
  const dayOfMonth = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', day: '2-digit' }).format(now));
  if (dayOfMonth <= 7) return { due: true, period: target, reason: `${target} has closed` };
  return { due: false, period: target, reason: 'the completed period was already published earlier this month' };
}

const previousOf = (period) => {
  const [y, m] = String(period).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/** The monthly lane, idempotent by stored publication state. */
export async function runWinbaIndexPass(env, { snapshot, dict = null, at = new Date().toISOString(), period = null, force = false, mediaFor = null, winbaPodium = null } = {}) {
  if (!env?.NEWS_KV) return { skipped: 'no_kv' };
  const due = winbaIndexDue(at, { period, force });
  if (!due.due) return { status: 'not_due', period: due.period, reason: due.reason };

  const result = await runWinbaIndex({
    period: due.period,
    snapshot,
    playerById: dict?.playerById || new Map(),
    teamById: dict?.teamById || new Map(),
    at,
    force,
    getMonthly: (p) => env.NEWS_KV.get(winbaMonthlyKey(p), 'json'),
    putMonthly: (p, v) => env.NEWS_KV.put(winbaMonthlyKey(p), JSON.stringify(v)),
    getIndexState: () => env.NEWS_KV.get(WINBA_MONTHLY_INDEX_KEY, 'json'),
    putIndexState: (v) => env.NEWS_KV.put(WINBA_MONTHLY_INDEX_KEY, JSON.stringify(v)),
    getArticle: (id) => env.NEWS_KV.get(ITEM(id), 'json'),
    // The hero is the board leader's approved photograph, resolved by the same
    // ledger-backed path as every other desk: no approved subject, no photo.
    putArticle: (a) => env.NEWS_KV.put(ITEM(a.id), JSON.stringify(decorate(a, { mediaFor, winbaPodium })), ITEM_TTL)
  });

  // A published Index joins the newsroom index so it is listed, linked and
  // carried into feeds like any other story.
  if ((result.status === 'published' || result.status === 'regenerated') && result.article) {
    const index = (await env.NEWS_KV.get('art:v1:index', 'json')) || [];
    const card = cardForIndex(decorate(result.article, { mediaFor, winbaPodium }));
    const next = index.some((c) => c.id === card.id)
      ? index.map((c) => (c.id === card.id ? { ...c, ...card } : c))
      : [card, ...index];
    await env.NEWS_KV.put('art:v1:index', JSON.stringify(next));
  }

  const { article, ...rest } = result;
  return { ...rest, version: WINBA_INDEX_VERSION, reason: due.reason };
}


/**
 * Hero and podium for an Index, both resolved from the approved-photo ledger.
 * The podium is all-or-nothing: a single unapproved subject means no podium and
 * the card falls back to the leader treatment.
 */
function decorate(a, { mediaFor, winbaPodium }) {
  const media = mediaFor ? mediaFor(a) : a.media || null;
  const podium = winbaPodium ? winbaPodium(a.winba_board?.rows || []) : null;
  return { ...a, ...(media ? { media } : {}), winba_podium: podium };
}

/** The listing card for an Index. Mirrors only what listings render. */
export function cardForIndex(a) {
  return {
    id: a.id,
    slug: a.slug,
    kind: a.kind,
    desk: a.desk,
    category: a.category,
    series: a.series,
    event_type: 'winba_index',
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
    period: a.period,
    period_label: a.period_label,
    has_market: false,
    sources: [],
    media: a.media || null,
    winba_podium: a.winba_podium || null,
    // A trimmed copy of the frozen board travels with the card so listings can
    // show the month's top three and a player page can state the rank THIS
    // edition recorded. Only the printable fields: the full board with averages
    // stays on the article.
    winba_board: a.winba_board
      ? {
        period: a.winba_board.period,
        period_label: a.winba_board.period_label,
        period_complete: a.winba_board.period_complete,
        qualified_count: a.winba_board.qualified_count,
        snapshot_at: a.winba_board.snapshot_at,
        rows: (a.winba_board.rows || []).map((r) => ({
          rank: r.rank, player_id: r.player_id, player_name: r.player_name,
          team_id: r.team_id, team_name: r.team_name, score: r.score
        }))
      }
      : null
  };
}

/** Both lanes. Returns a compact report for the run status document. */
export async function runWinbaPasses(env, { apiGet, dict = null, at = new Date().toISOString(), force = false, indexPeriod = null, mediaFor = null, winbaPodium = null } = {}) {
  let snapshot = null;
  let error = null;
  try {
    const res = await apiGet('/v1/stats/winba');
    snapshot = res?.data || res || null;
  } catch (e) {
    error = e?.message || String(e);
  }
  if (!snapshot?.rows?.length) return { version: WINBA_EDITORIAL_VERSION, status: 'no_snapshot', error };

  const daily = await runWinbaDaily(env, { snapshot, dict, at }).catch((e) => ({ error: e?.message || String(e) }));
  const monthly = await runWinbaIndexPass(env, { snapshot, dict, at, period: indexPeriod, force, mediaFor, winbaPodium }).catch((e) => ({ error: e?.message || String(e) }));
  return {
    version: WINBA_EDITORIAL_VERSION,
    index_version: WINBA_INDEX_VERSION,
    metric_version: snapshot.version || null,
    snapshot_at: snapshot.generated_at || null,
    qualified: snapshot.qualified_count ?? null,
    daily,
    monthly
  };
}
