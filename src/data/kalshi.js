// Kalshi prediction-market data for WNBA games (contract market-intel/1).
// The browser reads ONLY the owned PropSports markets Worker (propsports-markets, PropSports network); it never
// calls Kalshi. The Worker's ingest runs on its own schedule, so polling here adds no Kalshi traffic.
// Prediction-market prices are not sportsbook odds and not a PropBetEdge model; they are labelled so wherever shown.
import { createKalshiClient } from '../vendor/kalshi/kalshi-market-client.js';
import { kalshiLine, kalshiCard } from '../vendor/kalshi/kalshi-market-ui.js';
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

/** Card colours keyed by role (away/home), from the canonical team manifest only. */
export function kalshiColors(g) {
  return { away: teamColors(g?.away).color, home: teamColors(g?.home).color };
}

/** Compact game-card line for a not-final game, from the last loaded board. '' when there is no entry. */
export function kalshiLineFor(g) {
  if (!g || g.status?.state === 'post') return '';
  return kalshiLine(kalshi.forEvent(g.game_id));
}

/** Matchup page block: the full card in its own slot (an empty, zero-height slot when there is no entry). */
export function matchupKalshiSlot(entry, g) {
  return html`<div class="kx-slot kx-slot--matchup" data-kx-slot>${raw(kalshiCard(entry, { placement: 'matchup-page', colors: kalshiColors(g) }))}</div>`;
}

// Client-only: game cards render the Kalshi line once the SPA has loaded the board. The publishing Worker never
// imports this module, so server-rendered cards are unchanged.
setGameCardKalshi(kalshiLineFor);
