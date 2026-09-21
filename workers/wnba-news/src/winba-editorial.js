// WinBA Score as an editorial statistic.
//
// WinBA is a PropBetEdge-owned metric, so the newsroom carries two obligations
// that a conventional box-score line does not:
//
//   1. IMMUTABILITY. The score printed in a story is the score that was true
//      when the story published. A frozen `winba_reference` is written onto the
//      article at generation; nothing downstream reads the live leaderboard.
//      A player at 88 on publication day still reads 88 after she reaches 91.
//
//   2. RESTRAINT. One appropriate story a day may use it. A metric quoted in
//      every article stops being a statistic and becomes a house advertisement,
//      so the daily slot is a hard cap, and no story is ever padded to earn it.
//
// WinBA also never helps a story publish: it is added after substance has been
// decided and contributes no evidence dimension. See `assertDepthNeutral`.

import { winbaForPlayer, WINBA_VERSION } from '../../shared/winba.js';
import { f1, etDate, aan } from './prose.js';

export const WINBA_EDITORIAL_VERSION = 'wnba-winba-editorial/1.0.0';

/** The one canonical WinBA destination. Audited, not invented: src/lib/routes.js. */
export const WINBA_URL = '/winba-score';
export const WINBA_RANKINGS_URL = '/winba-score#winba-rankings';
export const WINBA_METHOD_URL = '/winba-score#how-winba-is-calculated';

/**
 * Reader-facing name of the metric, matching the shipped product ("WinBA
 * Score", not "WINBA"). The renderer links the first in-body occurrence of
 * this phrase to WINBA_URL via a pseudo-entity, so prose stays URL-free.
 */
export const WINBA_LABEL = 'WinBA Score';
export const WINBA_METRIC_ENTITY = Object.freeze({ type: 'metric', id: 'winba', name: WINBA_LABEL });

/**
 * How old a leaderboard may be and still be quoted. The snapshot is rebuilt
 * from the final-game archive, so it legitimately does not move on days with
 * no completed games; the API's own 900s cache window is a serving concern,
 * not an editorial one. 48h keeps a quoted score inside the same slate.
 */
export const WINBA_MAX_AGE_MS = 48 * 3600e3;

/** Kinds whose player context makes a rating meaningful. */
export const WINBA_ELIGIBLE_KINDS = Object.freeze(['performance', 'result', 'injury', 'preview', 'transaction', 'trend']);

/**
 * A rating earns its place in prose when there is a rank statement to make.
 * "She carries a 53 WinBA Score" tells a reader nothing without the whole
 * distribution in front of her, so mid-pack ratings stay out of stories and
 * live on the leaderboard, where the distribution is visible.
 */
export const WINBA_EDITORIAL_MAX_RANK = 25;

const FNV = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

/**
 * Factual rank phrasing only. There is no deterministic band defining "elite",
 * so no story says it; a rank or a plain score is always defensible.
 */
export function winbaRankPhrase(ref) {
  const { rank, qualified_count: total } = ref || {};
  if (!Number.isFinite(rank) || rank < 1) return null;
  if (rank === 1) return 'the highest mark in the league';
  if (rank <= 5) return `No. ${rank} in the league`;
  if (rank <= 10) return `No. ${rank}, inside the league’s top 10`;
  if (rank <= 25 && Number.isFinite(total)) return `No. ${rank} of ${total} qualified players`;
  return null;
}

/**
 * Freeze the leaderboard state used by one story. Every value a story may print
 * comes from here, never from a later read.
 *
 * `generatedAt` is the article's generation cutoff: a snapshot built after it
 * did not exist when the story was reported and is refused, which is what stops
 * today's leaderboard reaching a historical article.
 */
export function winbaReferenceFor(snapshot, athleteId, { generatedAt = null, now = Date.now() } = {}) {
  if (!snapshot?.rows?.length || !athleteId) return null;
  const row = winbaForPlayer(snapshot, athleteId);
  if (!row || String(row.athlete_id) !== String(athleteId)) return null;
  // `Number(null)` is 0 and 0 is finite, so the raw value has to be rejected
  // first or a missing score publishes as a rating of zero.
  if (row.score === null || row.score === undefined || row.score === '') return null;
  if (!Number.isFinite(Number(row.score))) return null;
  // Provisional players are scored against the benchmark but do not set it, so
  // their rank is not a league-wide statement. No rank, no editorial claim.
  if (!row.qualified) return null;

  const snapshotAt = snapshot.generated_at || null;
  const stamped = Date.parse(snapshotAt || '');
  if (!Number.isFinite(stamped)) return null;
  const cutoff = generatedAt ? Date.parse(generatedAt) : null;
  if (Number.isFinite(cutoff) && stamped > cutoff + 60e3) return null;
  if (now - stamped > WINBA_MAX_AGE_MS) return null;

  return {
    metric: WINBA_LABEL,
    version: snapshot.version || WINBA_VERSION,
    editorial_version: WINBA_EDITORIAL_VERSION,
    player_id: String(row.athlete_id),
    player_name: row.name || null,
    team_id: row.team_id ? String(row.team_id) : null,
    score: Number(row.score),
    rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : null,
    production_percentile: Number.isFinite(Number(row.components?.production_percentile))
      ? Number(row.components.production_percentile) : null,
    qualified: true,
    qualified_count: Number.isFinite(Number(snapshot.qualified_count)) ? Number(snapshot.qualified_count) : null,
    season: snapshot.season ?? null,
    games_in_sample: Number.isFinite(Number(row.sample?.games)) ? Number(row.sample.games) : null,
    snapshot_at: snapshotAt,
    leaderboard_as_of: snapshot.as_of || snapshotAt,
    canonical_url: WINBA_URL,
    frozen: true
  };
}

/**
 * Is this story a place where a rating adds something?
 *
 * Deliberately conservative. A story must already stand on its own, carry a
 * real player subject, and be the kind of story where a season-long rating is
 * context rather than clutter. Administrative and market-only items are out.
 */
export function winbaEligibility(article, ref, { slotTaken = false } = {}) {
  const no = (reason) => ({ eligible: false, reason });
  if (!article) return no('no article');
  if (!ref) return no('no valid frozen WinBA reference');
  if (slotTaken) return no('the daily WinBA slot is already used');
  if (!WINBA_ELIGIBLE_KINDS.includes(String(article.kind))) return no(`kind "${article.kind}" is not a WinBA-eligible story`);

  const leadId = article.lead_player_id == null ? null : String(article.lead_player_id);
  if (!leadId) return no('no primary player subject');
  // A story may never carry another player's rating.
  if (leadId !== String(ref.player_id)) return no('the reference is not the lead player');

  const leadEntity = (article.entities || [])
    .find((e) => e?.type === 'player' && String(e.id) === leadId) || null;
  if (!leadEntity) return no('the lead player is not a linked entity');
  if (ref.player_name && leadEntity.name && !namesAgree(ref.player_name, leadEntity.name)) {
    return no(`reference name "${ref.player_name}" disagrees with linked player "${leadEntity.name}"`);
  }

  // The story must not need WinBA to be worth reading.
  if (article.depth && article.depth.pass === false) return no('the story does not pass on its own substance');

  if (!Number.isFinite(ref.rank) || ref.rank > WINBA_EDITORIAL_MAX_RANK) {
    return no(`rank ${ref.rank ?? 'none'} is outside the top ${WINBA_EDITORIAL_MAX_RANK}, where the rating carries no readable context`);
  }

  return { eligible: true, reason: 'eligible' };
}

const normName = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’‘`]/g, "'").toLowerCase().trim();
const namesAgree = (a, b) => normName(a) === normName(b);

/**
 * Four deterministic treatments so the metric does not read from a template.
 * The choice is stable for a given story and player, so a regenerated article
 * keeps its phrasing.
 */
export function winbaSentence(ref, { articleId = '', averages = null, teamName = null } = {}) {
  if (!ref) return null;
  const score = Math.round(ref.score);
  const name = ref.player_name;
  const rankPhrase = winbaRankPhrase(ref);
  const styles = [];

  // A — alongside the conventional line.
  if (averages && Number.isFinite(averages.pts)) {
    const bits = [`${f1(averages.pts)} points`];
    if (Number.isFinite(averages.reb)) bits.push(`${f1(averages.reb)} rebounds`);
    if (Number.isFinite(averages.ast)) bits.push(`${f1(averages.ast)} assists`);
    styles.push(`${name} is averaging ${bits.join(', ')} this season and carries ${aan(score)} ${score} ${WINBA_LABEL}${rankPhrase ? `, ${rankPhrase}` : ''}.`);
  }

  // B — plain prose. `aan` because the number is spoken: "an 86", "a 74".
  styles.push(`${name} carries ${aan(score)} ${score} ${WINBA_LABEL}, PropBetEdge’s winning-impact rating${rankPhrase ? `, ${rankPhrase}` : ''}.`);

  // C — ranking context, only when a rank claim is available.
  if (rankPhrase) styles.push(`Her ${score} ${WINBA_LABEL} is ${rankPhrase}.`);

  // D — the metric as team context. Needs both a rank claim and a team to name,
  // so it never dresses a mid-pack rating up as something a team plans around.
  if (teamName && rankPhrase) {
    styles.push(`Her ${score} ${WINBA_LABEL} is ${rankPhrase}, and the rating the ${teamName} are building around.`);
  }

  if (!styles.length) return null;
  return styles[FNV(`${articleId}|${ref.player_id}|${WINBA_EDITORIAL_VERSION}`) % styles.length];
}

/**
 * The compact stat treatment: WinBA sits beside points, rebounds and assists at
 * the same visual weight, never as a callout. Returns data only; the view owns
 * the markup and the link.
 */
export function winbaStatLine(ref, averages = null) {
  if (!ref) return null;
  const cells = [];
  if (averages && Number.isFinite(averages.pts)) cells.push({ label: 'PTS', value: f1(averages.pts) });
  if (averages && Number.isFinite(averages.reb)) cells.push({ label: 'REB', value: f1(averages.reb) });
  if (averages && Number.isFinite(averages.ast)) cells.push({ label: 'AST', value: f1(averages.ast) });
  cells.push({
    label: 'WINBA',
    value: String(Math.round(ref.score)),
    metric: true,
    href: WINBA_URL,
    title: `${WINBA_LABEL} — PropBetEdge overall WNBA player rating`
  });
  return { cells, rank: ref.rank, as_of: ref.snapshot_at };
}

// ---------------------------------------------------------------------------
// Daily slot
// ---------------------------------------------------------------------------

/**
 * At most one story a day references WinBA. The slot is keyed by New York
 * calendar date, so a late tip does not open a second slot, and it is stored
 * durably, so a Worker restart cannot reopen one.
 *
 * Re-claiming for the SAME article is idempotent: a regenerated story keeps its
 * reference instead of being denied by its own earlier claim.
 */
export function winbaSlotFor(state, at) {
  const day = etDate(at);
  const row = state?.days?.[day] || null;
  return { day, claim: row };
}

export function winbaSlotTaken(state, at, articleId) {
  const { claim } = winbaSlotFor(state, at);
  if (!claim) return false;
  return String(claim.article_id) !== String(articleId);
}

export function claimWinbaSlot(state, { at, articleId, ref }) {
  const day = etDate(at);
  const days = { ...(state?.days || {}) };
  const existing = days[day];
  if (existing && String(existing.article_id) !== String(articleId)) {
    return { state: state || { version: WINBA_EDITORIAL_VERSION, days }, claimed: false, claim: existing };
  }
  const claim = {
    date: day,
    article_id: String(articleId),
    player_id: ref ? String(ref.player_id) : null,
    score: ref ? Number(ref.score) : null,
    rank: ref?.rank ?? null,
    snapshot_at: ref?.snapshot_at || null,
    at: new Date(at).toISOString()
  };
  days[day] = claim;
  // Keep a bounded, ordered window of recent days.
  const keys = Object.keys(days).sort().slice(-60);
  const pruned = {};
  for (const k of keys) pruned[k] = days[k];
  return { state: { version: WINBA_EDITORIAL_VERSION, days: pruned }, claimed: true, claim };
}

/**
 * Where the sentence belongs in the reading order.
 *
 * The sentence is deliberately NOT written into `body`. Keeping it out is what
 * makes the metric structurally incapable of changing a story's depth class,
 * word count or evidence dimensions — the substance gate never sees it. The
 * renderer places it so the reader still meets it as ordinary prose, inside the
 * section that is already discussing the player's production or role.
 */
export function winbaPlacement(article) {
  const sections = article?.sections || [];
  const preferred = /role|rotation|production|form|season|performance|read|listing/i;
  const match = sections.find((s) => preferred.test(String(s.key || s.title || '')));
  const target = match || sections.at(-1) || null;
  return {
    after_section: target ? (target.key || target.title || null) : null,
    fallback: 'end_of_body',
    in_body: false
  };
}

/**
 * Attach a frozen reference to a story, or leave the story exactly as it was.
 *
 * This runs after substance has been decided, and returns the article unchanged
 * when anything at all is missing. Nothing here can make a story publishable.
 */
export function applyWinbaContext(article, { snapshot, state, at = new Date().toISOString(), averages = null, teamName = null } = {}) {
  const generatedAt = article?.provenance?.generated_at || article?.published_at || at;
  const ref = winbaReferenceFor(snapshot, article?.lead_player_id, { generatedAt, now: Date.parse(at) });
  const slotTaken = winbaSlotTaken(state, at, article?.id);
  const verdict = winbaEligibility(article, ref, { slotTaken });
  if (!verdict.eligible) return { article, applied: false, reason: verdict.reason, state, ref: null };

  const sentence = winbaSentence(ref, { articleId: article.id, averages, teamName });
  if (!sentence) return { article, applied: false, reason: 'no supportable sentence', state, ref: null };

  const claim = claimWinbaSlot(state, { at, articleId: article.id, ref });
  if (!claim.claimed) return { article, applied: false, reason: 'the daily WinBA slot is already used', state, ref: null };

  const entities = (article.entities || []).some((e) => e?.type === 'metric' && e.id === 'winba')
    ? article.entities
    : [...(article.entities || []), { ...WINBA_METRIC_ENTITY }];

  return {
    article: { ...article, winba_reference: ref, winba_sentence: sentence, winba_placement: winbaPlacement(article), entities },
    applied: true,
    reason: 'applied',
    state: claim.state,
    ref
  };
}

/**
 * WinBA must not change what class a story is or whether it publishes.
 * Exported so the test suite can assert it against the real depth assessor.
 */
export function assertDepthNeutral(assess, article) {
  const before = assess(article);
  const withWinba = {
    ...article,
    winba_reference: {
      metric: WINBA_LABEL, player_id: String(article.lead_player_id || '1'), score: 91, rank: 2,
      qualified: true, snapshot_at: '2026-09-21T03:17:45.205Z', canonical_url: WINBA_URL, frozen: true
    },
    winba_sentence: `Her 91 ${WINBA_LABEL} is No. 2 in the league.`
  };
  const after = assess(withWinba);
  return {
    equal: before.class === after.class && before.pass === after.pass
      && (before.dimensions || []).length === (after.dimensions || []).length,
    before: { class: before.class, pass: before.pass, dimensions: (before.dimensions || []).length },
    after: { class: after.class, pass: after.pass, dimensions: (after.dimensions || []).length }
  };
}
