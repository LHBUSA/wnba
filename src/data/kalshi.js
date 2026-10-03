// Kalshi prediction-market data for WNBA games (contract market-intel/1).
// The browser reads ONLY the owned PropSports markets Worker (propsports-markets, PropSports network); it never
// calls Kalshi. The Worker's ingest runs on its own schedule, so polling here adds no Kalshi traffic.
// Prediction-market prices are not sportsbook odds and not a PropBetEdge model; they are labelled so wherever shown.
import { createKalshiClient } from '../vendor/kalshi/kalshi-market-client.js';
import { kalshiCard, kalshiLine, marketModule, marketHistoryCard, marketCloseLine, algoVsMarketCard, algoVsMarketEvent } from '../vendor/kalshi/kalshi-market-ui.js';
import { html, raw } from '../lib/dom.js';
import { setGameCardKalshi } from '../ui/components.js';
import { teamColors } from '../ui/logo.js';

export const MARKETS_BASE = import.meta.env?.VITE_MARKETS_URL || 'https://propsports-markets.sales-fd3.workers.dev';

export const kalshi = createKalshiClient({ sport: 'wnba', base: MARKETS_BASE });

/** Poll state for a game object from the WNBA API: live 20 s, pregame 45 s, anything else idle. */
export function kalshiPollState(g) {
  const s = g?.status?.state;
  return s === 'in' ? 'live' : s === 'pre' ? 'pregame' : 'idle';
}

/** A closed market is re-read every 5 minutes until the venue settles it; a settled market is never re-read. */
export const MARKET_CLOSED_POLL_MS = 300_000;

/**
 * Poll interval for the event's market module, 0 = no polling. The market lifecycle wins over the game state:
 * SETTLED -> 0, CLOSED -> 5 min. Otherwise live 20 s / pregame 45 s; a final game whose market is still open is
 * followed every 5 min (so its page turns into the history without a release); a final game with no entry -> 0.
 */
export function marketPollMs(g, entry) {
  const lc = entry?.market?.lifecycle;
  if (lc === 'SETTLED') return 0;
  if (lc === 'CLOSED') return MARKET_CLOSED_POLL_MS;
  const s = kalshiPollState(g);
  if (s === 'live' || s === 'pregame') return kalshi.pollMsFor(s);
  return entry ? MARKET_CLOSED_POLL_MS : 0;
}

/** True once the venue market has CLOSED or SETTLED (it then renders as history, never as live). */
export function isMarketDone(entry) {
  const lc = entry?.market?.lifecycle;
  return lc === 'CLOSED' || lc === 'SETTLED';
}

/** Resolves with the value of `p`, or with `undefined` after `ms` (bounded first-paint wait; `p` keeps running). */
export function within(p, ms = 800) {
  return Promise.race([p, new Promise((r) => setTimeout(() => r(undefined), ms))]);
}

/** Card colours keyed by role (away/home), from the canonical team manifest only. */
export function kalshiColors(g) {
  return { away: teamColors(g?.away).color, home: teamColors(g?.home).color };
}

/**
 * Compact game-card line from the last loaded board: the live line for a not-final game; for a final game the
 * restrained "how the market closed" line (only when the board recorded a close). '' when there is nothing.
 */
export function kalshiLineFor(g) {
  if (!g) return '';
  const entry = kalshi.forEvent(g.game_id);
  // A closed/settled market is never shown as a live line, whatever the game clock says.
  return g.status?.state === 'post' || isMarketDone(entry) ? marketCloseLine(entry) : kalshiLine(entry);
}

/** Event-page module: the live card while the market trades, "How the market closed" once CLOSED/SETTLED. */
export function matchupKalshiMarkup(entry, g) {
  return marketModule(entry, { placement: 'matchup-page', colors: kalshiColors(g) });
}

/** Matchup page block: the module in its own slot (an empty, zero-height slot when there is no entry). */
export function matchupKalshiSlot(entry, g) {
  return html`<div class="kx-slot kx-slot--matchup" data-kx-slot>${raw(matchupKalshiMarkup(entry, g))}</div>`;
}

/**
 * WNBACast Market Pulse (MLB PBEcast standard, propbetedge-v2 6f34d67): lifecycle label for the one module directly
 * under the scoreboard. [phase key, label] or null. A stale in-game quote is never labelled live.
 */
export function castMarketPhase(entry, g) {
  if (!entry || !g || String(entry.event?.canonical_event_id ?? '') !== String(g.game_id)) return null;
  const lc = entry.market?.lifecycle;
  if (lc === 'SETTLED') return ['settled', 'MARKET SETTLED'];
  if (lc === 'CLOSED') return ['closed', 'MARKET CLOSED · AWAITING SETTLEMENT'];
  const s = g.status?.state;
  if (s === 'post') return ['final-open', 'GAME FINAL · MARKET STILL TRADING'];
  if (s === 'in') return entry.kalshi?.freshness === 'stale' ? ['stale', 'MARKET OPEN · QUOTE STALE'] : ['live', 'LIVE MARKET'];
  if (s === 'pre') return ['pre', 'MARKET OPEN · PRE-MATCH'];
  return null;
}

/**
 * The module: lifecycle label over the full compact Market Pulse card (Mid-market per side, Updated Ns ago, stored
 * movement + sparkline, bid/ask, View market on Kalshi), or "How the market closed" once CLOSED/SETTLED (the settled
 * card when no history is stored yet — never nothing after the final). '' when there is no entry for this game.
 */
export function castMarketMarkup(entry, g) {
  const phase = castMarketPhase(entry, g);
  if (!phase) return '';
  const colors = kalshiColors(g);
  const body = (isMarketDone(entry) && entry.market_history ? marketHistoryCard(entry, { placement: 'wnbacast-history' }) : '')
    || kalshiCard(entry, { placement: 'wnbacast', colors, compact: true });
  if (!body) return '';
  return `<div class="cast-mkt" data-phase="${phase[0]}"><div class="cast-mkt-phase"><span class="cast-mkt-dot" aria-hidden="true"></span>${phase[1]}</div>${body}</div>`;
}

/**
 * Ticker market text for a WNBA game ("NY 40.5¢ · ATL 59.5¢"), or ''. Only an exact match (event id + both team ids,
 * away / home order) and only what a game card would show (kalshiLine: open, displayable, every Mid-market, not
 * stale). Final games carry none (their history lives in WNBACast).
 */
const cents = (bp) => `${(bp / 100).toFixed(1)}¢`;
export function tickerMarketText(entry, g) {
  if (!entry || !g) return '';
  const s = g.status?.state;
  if (s !== 'in' && s !== 'pre') return '';
  if (String(entry.event?.canonical_event_id ?? '') !== String(g.game_id)) return '';
  if (isMarketDone(entry) || !kalshiLine(entry)) return '';
  const outs = entry.kalshi?.outcomes || [];
  if (outs.length !== 2) return '';
  const away = outs.find((o) => o.role === 'away');
  const home = outs.find((o) => o.role === 'home');
  if (!away || !home || g.away?.team_id == null || g.home?.team_id == null) return '';
  if (String(away.team_id) !== String(g.away.team_id) || String(home.team_id) !== String(g.home.team_id)) return '';
  if (!Number.isFinite(away.mid_bp) || !Number.isFinite(home.mid_bp)) return '';
  return `${g.away.abbr} ${cents(away.mid_bp)} · ${g.home.abbr} ${cents(home.mid_bp)}`;
}

const escText = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Write / update / remove one ticker item's market segment in place; nothing else in the item changes. */
export function patchTickerMarket(item, text) {
  const el = item.querySelector('.tk-mkt');
  if (!text) { if (el) el.remove(); return; }
  if (!el) { item.insertAdjacentHTML('beforeend', `<span class="tk-mkt" title="Kalshi prediction market · Mid-market (not sportsbook odds)"><b>MKT</b>${escText(text)}</span>`); return; }
  const next = `MKT${text}`;
  if (el.textContent !== next) el.innerHTML = `<b>MKT</b>${escText(text)}`;
}

/**
 * Client-only: the Today ticker's WNBA game items get their market segment from the last loaded board (read once per
 * Today refresh, alongside the slate). Items are matched by their /cast/<id> or /matchups/<id> link; the marquee
 * duplicate copy is patched too. The publishing Worker's server render is unchanged (no Worker deploy).
 */
export function applyTickerMarkets(root, games = []) {
  const byId = new Map((games || []).filter(Boolean).map((g) => [String(g.game_id), g]));
  root.querySelectorAll('.ticker .tk-item:not(.tk-intl)').forEach((item) => {
    const m = /\/(?:cast|matchups)\/(\d+)(?:[/?#]|$)/.exec(item.getAttribute('href') || '');
    const g = m ? byId.get(m[1]) : null;
    patchTickerMarket(item, g ? tickerMarketText(kalshi.forEvent(g.game_id), g) : '');
  });
}

// Client-only: game cards render the Kalshi line once the SPA has loaded the board. The publishing Worker never
// imports this module, so server-rendered cards are unchanged.
setGameCardKalshi(kalshiLineFor);

/* ───────────── ALGO vs MARKET (contract algo-vs-market/1, same markets Worker) ─────────────
 * The official PBE WNBA Model's pick and the market's pick, both frozen at the PBE lock. The browser renders
 * exactly what the API returns: `algos` is empty until the first qualifying frozen comparison, a Pro-gated row
 * comes back LOCKED (no selection) until graded, and a failed read is null — nothing renders, nothing is invented. */
const AVM_BASE = String(MARKETS_BASE).replace(/\/+$/, '');
const defaultFetch = (...a) => globalThis.fetch(...a);
async function avmRead(path, fetchImpl) {
  try {
    const res = await fetchImpl(`${AVM_BASE}${path}`, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Track record: { algos: [...] } or null on failure. */
export async function loadAlgoVsMarket({ fetchImpl = defaultFetch } = {}) {
  const body = await avmRead('/v1/algo-vs-market/wnba', fetchImpl);
  return body && Array.isArray(body.algos) ? body : null;
}

/** One game (canonical id = WNBA game_id): { comparisons: [...] } or null on failure. */
export async function loadAlgoVsMarketEvent(gameId, { fetchImpl = defaultFetch } = {}) {
  if (!gameId) return null;
  const body = await avmRead(`/v1/algo-vs-market/event/wnba/${encodeURIComponent(String(gameId))}`, fetchImpl);
  return body && Array.isArray(body.comparisons) ? body : null;
}

/** Re-read cadence for a game's comparison: it changes only at the PBE lock and at grading. */
export const AVM_POLL_MS = 300_000;
/** A comparison with a result is final (no further reads). */
export const avmFinal = (payload) => (payload?.comparisons || []).some((r) => r?.result);

// Event label for an AVM ledger row from data the page already has (matchupOf(id) -> "AWAY @ HOME"), else the frozen
// market's own away/home labels; otherwise the row is unchanged. Never mutates the API payload.
export function avmWithEventLabels(algo, matchupOf = () => null) {
  if (!algo || !Array.isArray(algo.ledger)) return algo;
  const ledger = algo.ledger.map((r) => {
    if (r.event_label) return r;
    const p = r.market?.prices;
    const label = matchupOf(r.canonical_event_id) || (p?.away?.label && p?.home?.label ? `${p.away.label} @ ${p.home.label}` : null);
    return label ? { ...r, event_label: label } : r;
  });
  return { ...algo, ledger };
}

/** Event layer (PBE pick vs market at PBE lock) for THIS game only; '' when there is no qualifying comparison. */
export function avmEventMarkup(payload, g) {
  if (!payload || !g) return '';
  const own = (payload.comparisons || []).filter((r) => String(r?.canonical_event_id ?? '') === String(g.game_id));
  if (!own.length) return '';
  const nameOf = (r, role) => (role === 'away' || role === 'home' ? g[role]?.abbr || null : null);
  return algoVsMarketEvent({ ...payload, comparisons: own }, { nameOf });
}

/** Matchup page block: the AVM layer in its own slot (an empty, zero-height slot when there is none). */
export function matchupAvmSlot(payload, g) {
  return html`<div class="kx-slot kx-slot--matchup kx-slot--avm" data-avm-slot>${raw(avmEventMarkup(payload, g))}</div>`;
}

/**
 * Track-record module: one algoVsMarketCard per algorithm the API returns ('' while `algos` is empty — no box, no
 * heading). Event labels / away-home names come from the Pro ledger rows when this viewer has them (teamLabel(team_id)),
 * else the frozen market's own labels — never more than the API returned.
 */
export function trackAvmMarkup(body, ledgerRows = [], teamLabel = () => null) {
  const algos = Array.isArray(body?.algos) ? body.algos : [];
  if (!algos.length) return '';
  const gameOf = (id) => ledgerRows.find((x) => String(x?.game?.game_id) === String(id))?.game || null;
  const matchupOf = (id) => {
    const g = gameOf(id);
    const a = g && teamLabel(g.away_team_id);
    const h = g && teamLabel(g.home_team_id);
    return a && h ? `${a} @ ${h}` : null;
  };
  const nameOf = (r, role) => {
    const g = gameOf(r.canonical_event_id);
    return g && (role === 'away' || role === 'home') ? teamLabel(g[`${role}_team_id`]) || null : null;
  };
  return algos.map((a) => algoVsMarketCard(avmWithEventLabels(a, matchupOf), { nameOf, recent: 10 })).filter(Boolean).join('');
}
