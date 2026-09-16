// wnba-prop-edge — governed WNBA player-prop intelligence.
// Cloudflare Cron is the ONLY scheduler. No GitHub Actions, no Vercel Functions.
//
// V1 is deliberately labeled TRACKING_BETA until historical validation is complete.
// Projection authority uses ONLY PropBetEdge-owned final-game archives. Sportsbook
// lines/prices are read only AFTER the projection and probability exist.

const SERVICE = 'wnba-prop-edge';
const VERSION = '1.0.0';
const MODEL_ID = 'pbe-wnba-prop-edge-v1';
const SNAPSHOT_KEY = 'prop-edge:v1:latest';
const STATUS_KEY = 'prop-edge:v1:status';
const MAX_ARCHIVES = 180;
const MIN_GAMES = 5;
const MAX_GAMES = 10;
const DECAY = 0.84;
const MARKET_STAT = Object.freeze({
  player_points: { stat: 'pts', label: 'Points', sdFloor: 3.5 },
  player_rebounds: { stat: 'reb', label: 'Rebounds', sdFloor: 2.0 },
  player_assists: { stat: 'ast', label: 'Assists', sdFloor: 1.5 },
  player_threes: { stat: 'fg3m', label: '3PM', sdFloor: 0.9 }
});

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const round = (n, d = 1) => Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(run(env)); },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method)) return reply({ ok: false, error: 'method_not_allowed' }, 405);
    if (!['/health', '/status'].includes(url.pathname)) return reply({ ok: false, error: 'not_found' }, 404);
    const [snapshot, status] = env.WNBA_KV ? await Promise.all([
      env.WNBA_KV.get(SNAPSHOT_KEY, 'json'), env.WNBA_KV.get(STATUS_KEY, 'json')
    ]) : [null, null];
    const shouldBootstrap = Boolean(env.WNBA_KV && !snapshot && status?.state !== 'RUNNING');
    if (shouldBootstrap && ctx?.waitUntil) ctx.waitUntil(run(env));
    return reply({
      ok: true,
      service: SERVICE,
      version: VERSION,
      model_id: MODEL_ID,
      mode: 'TRACKING_BETA',
      scheduler: 'cloudflare-cron',
      cron: '*/5 * * * *',
      kv: Boolean(env.WNBA_KV),
      bootstrap_kicked: shouldBootstrap,
      status: status || null,
      snapshot: snapshot ? {
        generated_at: snapshot.generated_at,
        source_captured_at: snapshot.source_captured_at,
        evaluated: snapshot.summary?.evaluated || 0,
        calls: snapshot.summary?.calls || 0,
        passes: snapshot.summary?.passes || 0
      } : null
    });
  }
};

async function status(env, patch) {
  if (!env.WNBA_KV) return;
  const prev = await env.WNBA_KV.get(STATUS_KEY, 'json').catch(() => null);
  await env.WNBA_KV.put(STATUS_KEY, JSON.stringify({ ...(prev || {}), service: SERVICE, version: VERSION, ...patch }));
}

async function run(env) {
  const attempted = new Date().toISOString();
  await status(env, { state: 'RUNNING', last_attempt_at: attempted, last_error: null });
  try {
    const result = await build(env);
    await status(env, { state: result.skipped ? 'HEALTHY_SKIPPED' : 'HEALTHY', last_success_at: new Date().toISOString(), last_result: result, last_error: null });
    return result;
  } catch (e) {
    const message = String(e?.message || e || 'unknown_error').slice(0, 400);
    await status(env, { state: 'ERROR', last_error_at: new Date().toISOString(), last_error: message }).catch(() => {});
    console.error(`[${SERVICE}] ${message}`);
    throw e;
  }
}

async function build(env) {
  if (!env.WNBA_KV) throw new Error('prop_edge_kv_unconfigured');
  const props = await env.WNBA_KV.get('props:v1:latest', 'json');
  if (!props?.captured_at) throw new Error('prop_edge_props_snapshot_missing');
  const prior = await env.WNBA_KV.get(SNAPSHOT_KEY, 'json');
  if (prior?.source_captured_at === props.captured_at) return { skipped: 'same_props_snapshot', source_captured_at: props.captured_at };

  const marketRows = (props.games || []).flatMap((game) => (game.props || []).map((prop) => ({ game, prop })))
    .filter(({ prop }) => MARKET_STAT[prop.market] && prop.athlete_id && Number.isFinite(Number(prop.point)));
  if (!marketRows.length) {
    const empty = snapshotEnvelope(props, [], { archive_games: 0, player_load: false });
    await env.WNBA_KV.put(SNAPSHOT_KEY, JSON.stringify(empty));
    return { generated_at: empty.generated_at, evaluated: 0, calls: 0, passes: 0, reason: 'no_eligible_prop_rows' };
  }

  const wanted = new Set(marketRows.map(({ prop }) => String(prop.athlete_id)));
  const archiveIndex = await env.WNBA_KV.get('archive:v1:index', 'json');
  const ids = Array.isArray(archiveIndex) ? archiveIndex.slice(-MAX_ARCHIVES) : [];
  const docs = await Promise.all(ids.map((id) => env.WNBA_KV.get(`game:v1:final:${id}`, 'json')));
  const history = new Map();
  for (const doc of docs) {
    const game = doc?.summary?.game;
    const players = doc?.summary?.box?.players;
    if (!game?.start_utc || !Array.isArray(players)) continue;
    for (const p of players) {
      const id = String(p?.athlete_id || '');
      if (!wanted.has(id) || p?.dnp) continue;
      const rows = history.get(id) || [];
      rows.push({ game_id: game.game_id, start_utc: game.start_utc, min: num(p.min), pts: num(p.pts), reb: num(p.reb), ast: num(p.ast), fg3m: num(p.fg3m) });
      history.set(id, rows);
    }
  }
  for (const rows of history.values()) rows.sort((a, b) => Date.parse(b.start_utc) - Date.parse(a.start_utc));

  const loadSnap = await env.WNBA_KV.get('player-load:v1:latest', 'json');
  const loadMap = new Map((loadSnap?.players || []).map((p) => [String(p.athlete_id), p]));
  const evaluated = [];
  for (const { game, prop } of marketRows) {
    const cfg = MARKET_STAT[prop.market];
    const rows = (history.get(String(prop.athlete_id)) || []).filter((r) => Number.isFinite(r[cfg.stat])).slice(0, MAX_GAMES);
    const projection = project(rows, cfg.stat, cfg.sdFloor);
    const base = {
      game_id: game.game_id || null,
      commence_time: game.commence_time || null,
      home_team_id: game.home_team_id || null,
      away_team_id: game.away_team_id || null,
      athlete_id: String(prop.athlete_id),
      player: prop.player,
      team_id: prop.team_id || null,
      market: prop.market,
      market_label: cfg.label,
      line: Number(prop.point),
      model_id: MODEL_ID,
      model_mode: 'TRACKING_BETA',
      model_uses_market: false,
      player_load_affects_projection: false,
      sample_games: rows.length,
      load: loadContext(loadMap.get(String(prop.athlete_id)))
    };
    if (!projection || rows.length < MIN_GAMES) {
      evaluated.push({ ...base, call: 'PASS', pass_reason: `INSUFFICIENT_HISTORY_${rows.length}_OF_${MIN_GAMES}`, projection: null, market: marketContext(prop) });
      continue;
    }

    // MODEL FIRST. Market comparison happens only after these values exist.
    const pOver = overProbability(Number(prop.point), projection.mean, projection.sd);
    const pUnder = 1 - pOver;
    const modelSide = pOver >= 0.5 ? 'OVER' : 'UNDER';
    const modelProb = Math.max(pOver, pUnder);
    const market = marketContext(prop);
    const marketProb = modelSide === 'OVER' ? market?.over_prob : market?.under_prob;
    const edgePts = Number.isFinite(marketProb) ? (modelProb - marketProb) * 100 : null;
    const call = modelProb >= 0.58 && (edgePts === null || edgePts >= 3) ? modelSide : 'PASS';
    evaluated.push({
      ...base,
      call,
      pass_reason: call === 'PASS' ? 'BELOW_TRACKING_THRESHOLD' : null,
      projection: {
        value: round(projection.mean, 1),
        sd: round(projection.sd, 2),
        p_over: round(pOver, 4),
        p_under: round(pUnder, 4),
        fair_side: modelSide,
        fair_probability: round(modelProb, 4),
        recent: projection.recent
      },
      market,
      pbe_edge_pts: round(edgePts, 1),
      confidence: modelProb >= 0.68 ? 'HIGH' : modelProb >= 0.61 ? 'MEDIUM' : 'LOW',
      drivers: drivers(rows, cfg.stat, projection.mean, loadMap.get(String(prop.athlete_id)))
    });
  }

  evaluated.sort((a, b) => Number(b.call !== 'PASS') - Number(a.call !== 'PASS') || Math.abs(b.pbe_edge_pts || 0) - Math.abs(a.pbe_edge_pts || 0) || String(a.player).localeCompare(String(b.player)));
  const snapshot = snapshotEnvelope(props, evaluated, { archive_games: docs.filter(Boolean).length, player_load: Boolean(loadSnap) });
  await env.WNBA_KV.put(SNAPSHOT_KEY, JSON.stringify(snapshot));
  return { generated_at: snapshot.generated_at, source_captured_at: props.captured_at, evaluated: snapshot.summary.evaluated, calls: snapshot.summary.calls, passes: snapshot.summary.passes };
}

function snapshotEnvelope(props, rows, coverage) {
  return {
    schema: 'pbe-wnba-prop-edge/1',
    generated_at: new Date().toISOString(),
    source_captured_at: props.captured_at,
    model: {
      id: MODEL_ID,
      mode: 'TRACKING_BETA',
      official_record: false,
      publication_note: 'V1 is visible to WNBA Pro as a tracking beta while historical validation and an official locked prop ledger are being built.',
      projection_inputs: 'PropBetEdge persisted final WNBA box scores only; sportsbook prices are excluded from projection generation.',
      comparison_order: 'projection -> probability -> market comparison',
      load_affects_projection: false
    },
    coverage,
    summary: {
      evaluated: rows.length,
      calls: rows.filter((r) => r.call && r.call !== 'PASS').length,
      passes: rows.filter((r) => r.call === 'PASS').length,
      markets: Object.keys(MARKET_STAT)
    },
    rows
  };
}

function project(rows, stat, sdFloor) {
  if (!rows.length) return null;
  const values = rows.map((r) => Number(r[stat])).filter(Number.isFinite);
  if (!values.length) return null;
  let weight = 1;
  let sw = 0;
  let sx = 0;
  for (const v of values) {
    sx += v * weight;
    sw += weight;
    weight *= DECAY;
  }
  const mean = sx / sw;
  const variance = values.length > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1) : sdFloor ** 2;
  const sd = Math.max(sdFloor, Math.sqrt(Math.max(variance, 0)));
  const avg = (n, key = stat) => {
    const xs = rows.slice(0, n).map((r) => Number(r[key])).filter(Number.isFinite);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  return { mean, sd, recent: { last3: round(avg(3), 1), last5: round(avg(5), 1), last10: round(avg(10), 1), minutes_last3: round(avg(3, 'min'), 1), minutes_last10: round(avg(10, 'min'), 1) } };
}

function marketContext(prop) {
  const over = Number(prop?.consensus?.over_prob);
  const under = Number.isFinite(over) ? 1 - over : null;
  return {
    consensus_books: prop?.consensus?.books ?? 0,
    over_prob: Number.isFinite(over) ? over : null,
    under_prob: Number.isFinite(under) ? under : null,
    best_over: prop?.best?.over ? { book: prop.best.over.book, price: prop.best.over.price } : null,
    best_under: prop?.best?.under ? { book: prop.best.under.book, price: prop.best.under.price } : null,
    consensus_available: Boolean(prop?.consensus)
  };
}

function loadContext(load) {
  if (!load) return null;
  return { score: load.score, band: load.band, avg_minutes_last3: load.metrics?.avg_minutes_last3 ?? null, turnaround_hours: load.metrics?.turnaround_hours ?? null };
}

function drivers(rows, stat, projection, load) {
  const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const l3 = avg(rows.slice(0, 3).map((r) => Number(r[stat])).filter(Number.isFinite));
  const l10 = avg(rows.slice(0, 10).map((r) => Number(r[stat])).filter(Number.isFinite));
  const m3 = avg(rows.slice(0, 3).map((r) => Number(r.min)).filter(Number.isFinite));
  const m10 = avg(rows.slice(0, 10).map((r) => Number(r.min)).filter(Number.isFinite));
  const support = [];
  const risk = [];
  if (Number.isFinite(l3) && Number.isFinite(l10)) {
    if (l3 >= l10 + 1) support.push(`Recent production ${round(l3, 1)} vs ${round(l10, 1)} over the 10-game sample`);
    if (l3 <= l10 - 1) risk.push(`Recent production ${round(l3, 1)} vs ${round(l10, 1)} over the 10-game sample`);
  }
  if (Number.isFinite(m3) && Number.isFinite(m10)) {
    if (m3 >= m10 + 2) support.push(`Recent minutes elevated: ${round(m3, 1)} vs ${round(m10, 1)}`);
    if (m3 <= m10 - 2) risk.push(`Recent minutes down: ${round(m3, 1)} vs ${round(m10, 1)}`);
  }
  if (load?.band === 'HEAVY' || load?.band === 'EXTREME') risk.push(`Player Load ${load.score} · ${load.band} (context only; not in projection)`);
  if (!support.length) support.push(`Recency-weighted projection ${round(projection, 1)} from ${rows.length} archived games`);
  if (!risk.length) risk.push('No separate elevated workload risk detected in the current Player Load context');
  return { support: support.slice(0, 3), risk: risk.slice(0, 3) };
}

function overProbability(line, mean, sd) {
  const z = (line - mean) / sd;
  return clamp(1 - normalCdf(z), 0.05, 0.95);
}

function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return sign * y;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export { build, run };
