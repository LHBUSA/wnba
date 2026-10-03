// Kalshi prediction-market data for WNBA games (contract market-intel/1).
// The browser reads ONLY the owned PropSports markets Worker (propsports-markets, PropSports network); it never
// calls Kalshi. The Worker's ingest runs on its own schedule, so polling here adds no Kalshi traffic.
// Prediction-market prices are not sportsbook odds and not a PropBetEdge model; they are labelled so wherever shown.
import { createKalshiClient } from '../vendor/kalshi/kalshi-market-client.js';
import { kalshiLine, marketModule, marketCloseLine } from '../vendor/kalshi/kalshi-market-ui.js';
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

// Client-only: game cards render the Kalshi line once the SPA has loaded the board. The publishing Worker never
// imports this module, so server-rendered cards are unchanged.
setGameCardKalshi(kalshiLineFor);
