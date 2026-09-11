// Market layer. Four concepts stay separate everywhere they appear:
//   1. sportsbook price        — what one book offers (source: The Odds API)
//   2. market consensus        — no-vig benchmark across books (PropBetEdge arithmetic on market prices)
//   3. PBE fair value          — a PropBetEdge MODEL output (none published for WNBA yet)
//   4. PBE model gap           — model vs price (none, because 3 does not exist)
// Consensus is never labelled or rendered as a model.

export const PBE_MODEL = Object.freeze({
  status: 'NOT_PUBLISHED',
  note: 'No validated PropBetEdge WNBA model is published. Fair value and model gap are unavailable by design, not missing data.'
});

export function americanToDecimal(a) {
  const n = Number(a);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

export function probToAmerican(p) {
  if (!(p > 0 && p < 1)) return null;
  return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function noVigPair(outA, outB) {
  const da = americanToDecimal(outA?.price);
  const db = americanToDecimal(outB?.price);
  if (!da || !db) return null;
  const ia = 1 / da;
  const ib = 1 / db;
  const s = ia + ib;
  return { a: ia / s, b: ib / s, hold: s - 1 };
}

const norm = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Exact-name team join (Odds API full names == ESPN displayName, verified 2026-09-11). */
export function teamIndex(teams) {
  const idx = new Map();
  for (const t of teams || []) if (t?.name) idx.set(norm(t.name), t);
  return idx;
}

function modalPoint(entries) {
  const counts = new Map();
  for (const e of entries) if (e.point !== null && e.point !== undefined) counts.set(e.point, (counts.get(e.point) || 0) + 1);
  let best = null;
  for (const [pt, c] of counts) if (!best || c > best.c || (c === best.c && Math.abs(pt) < Math.abs(best.pt))) best = { pt, c };
  return best ? best.pt : null;
}

/**
 * Normalize one Odds API event (featured markets h2h/spreads/totals).
 * Output per market: per-book prices, best price per side, consensus no-vig.
 */
export function normalizeOddsEvent(ev, tIdx) {
  const home = tIdx.get(norm(ev.home_team)) || null;
  const away = tIdx.get(norm(ev.away_team)) || null;
  const books = (ev.bookmakers || []).map((b) => ({ key: b.key, title: b.title, last_update: b.last_update, markets: b.markets || [] }));

  const h2hRows = [];
  const spreadRows = [];
  const totalRows = [];
  for (const b of books) {
    for (const m of b.markets) {
      if (m.key === 'h2h') {
        const ho = m.outcomes.find((o) => norm(o.name) === norm(ev.home_team));
        const ao = m.outcomes.find((o) => norm(o.name) === norm(ev.away_team));
        if (ho && ao) h2hRows.push({ book: b.key, title: b.title, updated: m.last_update, home: ho.price, away: ao.price, nv: noVigPair(ho, ao) });
      } else if (m.key === 'spreads') {
        const ho = m.outcomes.find((o) => norm(o.name) === norm(ev.home_team));
        const ao = m.outcomes.find((o) => norm(o.name) === norm(ev.away_team));
        if (ho && ao) spreadRows.push({ book: b.key, title: b.title, updated: m.last_update, point: ho.point, home: ho.price, away: ao.price, nv: noVigPair(ho, ao) });
      } else if (m.key === 'totals') {
        const ov = m.outcomes.find((o) => o.name === 'Over');
        const un = m.outcomes.find((o) => o.name === 'Under');
        if (ov && un) totalRows.push({ book: b.key, title: b.title, updated: m.last_update, point: ov.point, over: ov.price, under: un.price, nv: noVigPair(ov, un) });
      }
    }
  }

  const best = (rows, side) => {
    let top = null;
    for (const r of rows) {
      const d = americanToDecimal(r[side]);
      if (d && (!top || d > top.decimal)) top = { book: r.book, title: r.title, price: r[side], point: r.point ?? null, decimal: d };
    }
    return top;
  };

  const consensus = (rows, sideA) => {
    const probs = rows.map((r) => r.nv?.a).filter(Number.isFinite);
    if (probs.length < 2) return null;
    const p = median(probs);
    return {
      books: probs.length,
      [`${sideA}_prob`]: round(p, 4),
      [`${sideA}_fair_american`]: probToAmerican(p),
      other_prob: round(1 - p, 4),
      other_fair_american: probToAmerican(1 - p),
      median_hold: round(median(rows.map((r) => r.nv?.hold)), 4)
    };
  };

  const spreadLine = modalPoint(spreadRows);
  const totalLine = modalPoint(totalRows);
  const atSpread = spreadRows.filter((r) => r.point === spreadLine);
  const atTotal = totalRows.filter((r) => r.point === totalLine);

  return {
    odds_event_id: ev.id,
    commence_time: ev.commence_time,
    home_team: ev.home_team,
    away_team: ev.away_team,
    home_team_id: home?.team_id || null,
    away_team_id: away?.team_id || null,
    team_join: home && away ? 'EXACT_NAME' : 'UNMATCHED',
    book_count: books.length,
    last_update: books.map((b) => b.last_update).sort().at(-1) || null,
    moneyline: {
      books: h2hRows.map(({ nv, ...r }) => r),
      best: { home: best(h2hRows, 'home'), away: best(h2hRows, 'away') },
      consensus: consensus(h2hRows, 'home')
    },
    spread: {
      consensus_line: spreadLine,
      books: spreadRows.map(({ nv, ...r }) => r),
      best: { home: best(atSpread, 'home'), away: best(atSpread, 'away') },
      consensus: consensus(atSpread, 'home')
    },
    total: {
      consensus_line: totalLine,
      books: totalRows.map(({ nv, ...r }) => r),
      best: { over: best(atTotal, 'over'), under: best(atTotal, 'under') },
      consensus: consensus(atTotal, 'over')
    },
    pbe_model: PBE_MODEL
  };
}

/** Player props (Odds API event-odds with player_* markets). Name join is exact against the two rosters. */
export function normalizeProps(eventOdds, rosterIdx) {
  const byKey = new Map();
  for (const b of eventOdds?.bookmakers || []) {
    for (const m of b.markets || []) {
      for (const o of m.outcomes || []) {
        const player = o.description || null;
        const key = `${m.key}|${player}|${o.point}`;
        if (!byKey.has(key)) {
          const hit = player ? rosterIdx.get(norm(player)) : null;
          byKey.set(key, { market: m.key, player, athlete_id: hit?.athlete_id || null, team_id: hit?.team_id || null, identity: hit ? 'EXACT_NAME_ON_GAME_ROSTER' : 'UNMATCHED', point: o.point ?? null, books: [] });
        }
        const row = byKey.get(key);
        let bk = row.books.find((x) => x.book === b.key);
        if (!bk) row.books.push((bk = { book: b.key, title: b.title, updated: m.last_update, over: null, under: null }));
        if (o.name === 'Over') bk.over = o.price;
        if (o.name === 'Under') bk.under = o.price;
      }
    }
  }
  const out = [];
  for (const r of byKey.values()) {
    let bestOver = null;
    let bestUnder = null;
    const nvs = [];
    for (const b of r.books) {
      const dO = americanToDecimal(b.over);
      const dU = americanToDecimal(b.under);
      if (dO && (!bestOver || dO > bestOver.decimal)) bestOver = { book: b.book, price: b.over, decimal: dO };
      if (dU && (!bestUnder || dU > bestUnder.decimal)) bestUnder = { book: b.book, price: b.under, decimal: dU };
      if (dO && dU) nvs.push(noVigPair({ price: b.over }, { price: b.under }).a);
    }
    const p = median(nvs);
    out.push({
      ...r,
      best: { over: bestOver, under: bestUnder },
      consensus: nvs.length >= 2 ? { books: nvs.length, over_prob: round(p, 4), over_fair_american: probToAmerican(p), under_fair_american: probToAmerican(1 - p) } : null,
      consensus_note: nvs.length >= 2 ? null : 'Fewer than two books with both sides — no consensus computed.',
      pbe_model: PBE_MODEL
    });
  }
  return out.sort((a, b) => a.market.localeCompare(b.market) || String(a.player).localeCompare(String(b.player)) || (a.point ?? 0) - (b.point ?? 0));
}

function round(v, d) {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

export { norm as normalizeName };
