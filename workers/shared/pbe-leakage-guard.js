// PREDICTION-MARKET LEAKAGE GUARD (owner directive 2026-10-03).
//
// The PBE WNBA model must be independent of BOTH prediction-market venues (Kalshi, Polymarket). Their prices
// are benchmark/context only and may never enter a model input. Adapted from LHBUSA/propbetedge-workers
// workers/propsports-markets/src/leakage-guard.js. Enforced at the model boundary in pbe-wnba-model.js
// (predictFromRows: game + team-game rows before features are built; predictGame: the feature object before
// the frozen artifact sees the vector). Throw-only: on clean inputs it changes nothing (golden test proves it).
//
// Sportsbook moneylines are a separate, already-enforced rule (no odds token in the feature/model code;
// market comparison happens after the probability, in pbe-runtime.js marketComparison).

// Any key whose name says it is venue / order-book data. Tailored so no legitimate pbe-wnba-team-game/1 row
// key or pbe-wnba-features/1.0.0 key matches (proved over the full committed fixture by the test).
export const MARKET_KEY_PATTERN = /(kalshi|polymarket|prediction_?market|clob|gamma|market|venue|consensus|yes_bid|yes_ask|no_bid|no_ask|best_bid|best_ask|\bbid\b|\bask\b|_bid|_ask|bid_|ask_|^mid$|_mid\b|mid_|mid_?point|spread|last_?trade|last_price|order_?book|book_hash|depth|open_interest|liquidity|implied_prob|traded|volume|outcome_token|token_id|condition_id)/i;

// Stores/tables/endpoints whose rows are prediction-market data. A model input may never be read from them.
export const MARKET_SOURCE_PATTERN = /(^|[\/:.?=])(market_intel_|market_venue_|market_|algo_market_|pred_venue_|kalshi|polymarket)|propsports-markets|clob\.polymarket|gamma-api\.polymarket|api\.elections\.kalshi|trading-api\.kalshi/i;

export class MarketLeakageError extends Error {
  constructor(path) { super(`market-derived field "${path}" cannot enter a PBE feature vector`); this.name = 'MarketLeakageError'; this.path = path; }
}

export function findMarketKeys(value, path = '$', hits = []) {
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) findMarketKeys(value[i], `${path}[${i}]`, hits); }
  else if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      const p = `${path}.${k}`;
      if (MARKET_KEY_PATTERN.test(k)) hits.push(p);
      findMarketKeys(value[k], p, hits);
    }
  }
  return hits;
}

// Fast path: key names repeat across thousands of rows, so each distinct name is tested once.
const KEY_VERDICT = new Map();
function marketKey(k) {
  let v = KEY_VERDICT.get(k);
  if (v === undefined) { v = MARKET_KEY_PATTERN.test(k); if (KEY_VERDICT.size < 10000) KEY_VERDICT.set(k, v); }
  return v;
}
function hasMarketKey(value) {
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) if (hasMarketKey(value[i])) return true; return false; }
  if (value && typeof value === 'object') {
    for (const k in value) {
      if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
      if (marketKey(k) || hasMarketKey(value[k])) return true;
    }
  }
  return false;
}

export function assertMarketFree(value, label = '$') {
  if (!hasMarketKey(value)) return value;
  const hits = findMarketKeys(value, label);
  if (hits.length) throw new MarketLeakageError(hits[0]);
  return value;
}

/** A KV key / table / URL a model input is read from. */
export function assertModelSource(source) {
  const s = String(source);
  if (MARKET_SOURCE_PATTERN.test(s)) throw new MarketLeakageError(`source ${s}`);
  return s;
}
