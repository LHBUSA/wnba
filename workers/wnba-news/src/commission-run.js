// The commissioned-feature pass, bound to the Worker's stores.
//
// Explicit only: nothing here runs on a cron. An editor names a commission on
// the request and this pass assembles its inputs — the frozen monthly boards the
// Index lane already published, the subject's own records from wnba-api, and the
// externally verified facts checked into the repo — then hands them to the pure
// composer in commission.js.
//
// The pass reads live endpoints for one purpose only: the conventional season
// and recent-form lines, which are described in the article as what they are.
// Everything the charts plot comes from frozen boards.

import { runCommission, cardForCommission, boardHash, COMMISSIONS, COMMISSION_STATE_KEY, COMMISSION_VERSION } from './commission.js';
import { winbaMonthlyKey, WINBA_MONTHLY_INDEX_KEY } from './winba-index.js';
import factsDoc from '../../../data/commissions/verified-facts.json';

const ITEM = (id) => `art:v1:item:${id}`;
const ITEM_TTL = { expirationTtl: 400 * 86400 };
const f1 = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);

/**
 * The subject's conventional 2026 line, from the season aggregate.
 *
 * Deliberately the aggregate rather than the WinBA archive window: the
 * aggregate excludes exhibition fixtures and is the figure that reconciles with
 * the official league profile, so it is the number a reader can check.
 */
function seasonLineFrom(stats, playerId) {
  const row = (stats?.rows || []).find((r) => String(r.athlete_id) === String(playerId));
  if (!row) return null;
  const pts = f1(row.avgPoints);
  const reb = f1(row.avgRebounds);
  const ast = f1(row.avgAssists);
  if (pts === null || reb === null || ast === null) return null;
  return {
    season_label: `${stats?.season?.label || '2026'} season`,
    games: row.gamesPlayed ?? null,
    pts,
    reb,
    ast,
    observed_at: null // set by the caller to the run instant: this is a live read
  };
}

/**
 * The most recent five games she actually played for her own team.
 *
 * Rows whose team id is not her team are not her team's games — the All-Star
 * fixture is carried upstream inside the regular-season game log — so they are
 * excluded here rather than averaged into a form line.
 */
function recentFormFrom(playerDoc, teamId, n = 5) {
  const season = (playerDoc?.gamelog?.seasons || []).find((s) => /Regular Season/i.test(s.name || ''));
  const all = (season?.games || []).filter((g) => Number.isFinite(Date.parse(g.date)));
  const own = teamId ? all.filter((g) => String(g.team_id) === String(teamId)) : all;
  const games = own.slice().sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, n);
  if (games.length < n) return { line: null, excluded: all.length - own.length };
  const avg = (k) => f1(games.reduce((s, g) => s + (Number(g[k]) || 0), 0) / games.length);
  return {
    line: {
      games: games.length,
      pts: avg('pts'),
      reb: avg('reb'),
      ast: avg('ast'),
      from: games.at(-1).date,
      to: games[0].date
    },
    excluded: all.length - own.length
  };
}

/** Attach approved photography to a rank-cards figure. Decoration only: it is not part of the payload hash. */
function withCardPhotos(article, boardMedia) {
  if (!boardMedia?.length) return article;
  const byId = new Map(boardMedia.map((m) => [String(m.player_id), m]));
  return {
    ...article,
    visuals: (article.visuals || []).map((v) => (v.type === 'rank_cards'
      ? { ...v, cards: (v.cards || []).map((c) => ({ ...c, photo: byId.get(String(c.entity.id))?.image || null })) }
      : v))
  };
}

/**
 * Publish one named commission.
 *
 * Returns a compact report. A refusal — a failed chart, a thin draft, a team
 * disagreement — returns its reason and writes nothing.
 */
export async function runCommissionPass(env, { key, apiGet, at = new Date().toISOString(), force = false, mediaFor = null, winbaBoardMedia = null } = {}) {
  if (!env?.NEWS_KV) return { skipped: 'no_kv' };
  const spec = COMMISSIONS[key];
  if (!spec) return { key, status: 'unknown_commission', known: Object.keys(COMMISSIONS) };

  // The frozen boards, and the edition each was published as.
  const indexState = (await env.NEWS_KV.get(WINBA_MONTHLY_INDEX_KEY, 'json')) || { published: {} };
  const editions = [];
  for (const period of spec.periods) {
    const board = await env.NEWS_KV.get(winbaMonthlyKey(period), 'json').catch(() => null);
    if (!board) continue;
    const published = indexState.published?.[period] || null;
    editions.push({ period, board, hash: await boardHash(board), slug: published?.slug || null, headline: published?.headline || null });
  }

  // Live reads, used only for the conventional lines the article labels as such.
  let subjectRecord = null;
  let seasonLine = null;
  let recent = null;
  let excludedFixtures = null;
  try {
    subjectRecord = await apiGet(`/v1/players/${spec.subject.id}`);
    const stats = await apiGet('/v1/stats/players?limit=400');
    seasonLine = seasonLineFrom(stats, spec.subject.id);
    if (seasonLine) seasonLine.observed_at = at;
    const form = recentFormFrom(subjectRecord, subjectRecord?.player?.team?.team_id);
    recent = form.line;
    excludedFixtures = form.excluded;
  } catch (e) {
    return { key, status: 'api_unavailable', error: String(e.message || e).slice(0, 160) };
  }
  if (!seasonLine) return { key, status: 'no_season_line' };

  const result = await runCommission({
    key,
    editions,
    subjectRecord,
    seasonLine,
    recent,
    factsDoc,
    at,
    force,
    getState: () => env.NEWS_KV.get(COMMISSION_STATE_KEY, 'json'),
    putState: (v) => env.NEWS_KV.put(COMMISSION_STATE_KEY, JSON.stringify(v)),
    getArticle: (id) => env.NEWS_KV.get(ITEM(id), 'json'),
    putArticle: async (a) => {
      const media = mediaFor ? mediaFor(a) : null;
      const rows = (editions.at(-1)?.board?.rows || []).slice(0, 3);
      const boardMedia = winbaBoardMedia ? winbaBoardMedia(rows) : null;
      const decorated = withCardPhotos({ ...a, ...(media ? { media } : {}) }, boardMedia);
      await env.NEWS_KV.put(ITEM(a.id), JSON.stringify(decorated), ITEM_TTL);
    }
  });

  // A published feature joins the newsroom index so it is listed, linked and fed
  // like any other story.
  if ((result.status === 'published' || result.status === 'regenerated') && result.article) {
    const stored = await env.NEWS_KV.get(ITEM(result.id), 'json');
    const index = (await env.NEWS_KV.get('art:v1:index', 'json')) || [];
    const card = cardForCommission(stored || result.article);
    const next = index.some((c) => c.id === card.id)
      ? index.map((c) => (c.id === card.id ? { ...c, ...card } : c))
      : [card, ...index];
    await env.NEWS_KV.put('art:v1:index', JSON.stringify(next));
  }

  const { article, ...rest } = result;
  return {
    ...rest,
    version: COMMISSION_VERSION,
    boards: editions.map((e) => ({ period: e.period, hash: e.hash, rows: (e.board.rows || []).length })),
    season_line: seasonLine,
    recent_form: recent,
    non_team_fixtures_excluded: excludedFixtures
  };
}
