// Market context attached to games. Reads ONLY the snapshots written by the
// scheduled wnba-ingest run (08/13/18 ET). A page view never calls The Odds API.

import { marketSurfaces } from '../../shared/market.js';

const MEMO_MS = 30000;
let memo = { at: 0, latest: null, props: null };

export async function marketSnapshots(env) {
  if (!env.WNBA_KV) return { latest: null, props: null };
  if (Date.now() - memo.at < MEMO_MS) return memo;
  const [latest, props] = await Promise.all([env.WNBA_KV.get('odds:v1:latest', 'json'), env.WNBA_KV.get('props:v1:latest', 'json')]);
  memo = { at: Date.now(), latest, props };
  return memo;
}

const ageS = (iso) => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)) : null);
const pick = (b) => (b ? { price: b.price, book: b.book, point: b.point ?? null } : null);

/** Compact, labelled market block for one Odds API event (normalized by ingest).
 *
 * Carries the market-side model state only. The game prediction model's state is attached by the
 * route from env, because the two models are independent and must never be inferred from each other.
 */
export function compactMarket(ev, capturedAt, propsGame, propsCapturedAt) {
  if (!ev) return null;
  const age = ageS(capturedAt);
  return {
    source: 'The Odds API',
    semantics: 'LAST_VERIFIED_MARKET',
    captured_at: capturedAt,
    age_s: age,
    stale: age !== null && age > 12 * 3600,
    odds_event_id: ev.odds_event_id,
    books: ev.book_count,
    moneyline: {
      home_best: pick(ev.moneyline?.best?.home),
      away_best: pick(ev.moneyline?.best?.away),
      home_no_vig: ev.moneyline?.consensus?.home_prob ?? null,
      away_no_vig: ev.moneyline?.consensus?.other_prob ?? null,
      consensus_books: ev.moneyline?.consensus?.books ?? 0
    },
    spread: {
      home_line: ev.spread?.consensus_line ?? null,
      home_best: pick(ev.spread?.best?.home),
      away_best: pick(ev.spread?.best?.away)
    },
    total: {
      line: ev.total?.consensus_line ?? null,
      over_best: pick(ev.total?.best?.over),
      under_best: pick(ev.total?.best?.under)
    },
    props: propsGame
      ? { available: propsGame.props.length > 0, count: propsGame.props.length, players: new Set(propsGame.props.map((p) => p.player)).size, captured_at: propsCapturedAt }
      : { available: false, count: 0, players: 0, captured_at: null, note: 'Props are captured only for games tipping within 36 hours.' },
    ...marketSurfaces({ marketPricing: true })
  };
}

function findEvent(latest, g) {
  if (!latest?.events?.length || !g) return null;
  const byId = latest.events.find((e) => e.game_id && e.game_id === g.game_id);
  if (byId) return byId;
  const tip = Date.parse(g.start_utc);
  return latest.events.find((e) => e.home_team_id === g.home?.team_id && e.away_team_id === g.away?.team_id && Math.abs(Date.parse(e.commence_time) - tip) < 6 * 3600e3) || null;
}

/** Market for one game: current snapshot if still listed, else the last pre-tip capture ingest kept. */
export async function marketForGame(env, g) {
  const { latest, props } = await marketSnapshots(env);
  const ev = findEvent(latest, g);
  const pg = props?.games?.find((x) => x.game_id === g.game_id) || null;
  if (ev) return compactMarket(ev, latest.captured_at, pg, props?.captured_at);
  if (!env.WNBA_KV || !g?.game_id) return null;
  const closing = await env.WNBA_KV.get(`odds:v1:game:${g.game_id}`, 'json');
  if (!closing?.event) return null;
  return { ...compactMarket(closing.event, closing.captured_at, null, null), semantics: 'LAST_PRE_TIP_SNAPSHOT' };
}

export async function attachMarkets(env, games) {
  const { latest, props } = await marketSnapshots(env);
  return games.map((g) => {
    if (g.status?.state === 'post') return g;
    const ev = findEvent(latest, g);
    if (!ev) return { ...g, market: null };
    const pg = props?.games?.find((x) => x.game_id === g.game_id) || null;
    return { ...g, market: compactMarket(ev, latest.captured_at, pg, props?.captured_at) };
  });
}

export async function marketHistory(env, oddsEventId) {
  if (!env.WNBA_KV || !oddsEventId) return [];
  return (await env.WNBA_KV.get(`odds:v1:hist:${oddsEventId}`, 'json')) || [];
}
