// Orchestrates one newsroom article pass: gather structured inputs from
// wnba-api (service binding), run every generator, gate, store in KV (and
// Supabase when bound). Deterministic ids: a re-run rewrites the same article
// only when its inputs changed (input_hash) or the generator version moved.

import { injuryArticles, transactionArticles, resultArticles, previewArticles, trendArticles, propArticles, marketMoveArticles, withSlug, cardOf, ARTICLE_VERSION } from './articles.js';

const et = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replaceAll('-', '');
const add = (s, n) => { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + n)); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; };

export async function runArticles(env, { apiGet, dict, externalItems, force = false }) {
  const started = new Date().toISOString();
  const now = Date.now();
  const last = await env.NEWS_KV.get('art:v1:last_run', 'json');
  if (!force && last?.at && now - Date.parse(last.at) < 25 * 60e3 && last.version === ARTICLE_VERSION) return { skipped: 'ran_recently', last_at: last.at };

  const soft = async (path) => { try { return await apiGet(path); } catch (e) { errors.push(`${path}: ${e.message}`); return null; } };
  const errors = [];
  const today = et();
  const [inj, tx, sched, longSched, standings, props] = await Promise.all([
    soft('/v1/injuries'),
    soft('/v1/transactions'),
    soft(`/v1/schedule?from=${add(today, -14)}&to=${add(today, 7)}`),
    soft(`/v1/schedule?from=${add(today, -50)}&to=${today}`),
    soft('/v1/standings'),
    soft('/v1/props')
  ]);
  const standingsById = new Map((standings?.groups || []).flatMap((g) => g.entries.map((e) => [e.team_id, { ...e, conference_name: g.name }])));
  const games = sched?.games || [];
  const finals = games.filter((g) => g.status?.state === 'post' && g.status?.completed).sort((a, b) => b.start_utc.localeCompare(a.start_utc)).slice(0, 10);
  const upcoming = games.filter((g) => g.status?.state === 'pre').sort((a, b) => a.start_utc.localeCompare(b.start_utc)).slice(0, 8);
  const finalsByTeam = new Map();
  for (const g of (longSched?.games || []).filter((x) => x.status?.state === 'post' && x.status?.completed).sort((a, b) => b.start_utc.localeCompare(a.start_utc))) {
    for (const t of [g.home?.team_id, g.away?.team_id]) { if (!finalsByTeam.has(t)) finalsByTeam.set(t, []); finalsByTeam.get(t).push(g); }
  }
  const externalByPlayer = new Map();
  for (const it of externalItems) for (const e of it.entities || []) if (e.type === 'player') { if (!externalByPlayer.has(e.id)) externalByPlayer.set(e.id, []); externalByPlayer.get(e.id).push(it); }
  for (const v of externalByPlayer.values()) v.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));

  const api = (path) => soft(path);
  const ctx = { api, injuries: inj?.items || [], externalByPlayer, schedule: games, standingsById, now, transactions: tx?.items || [], dict, finals, upcoming, finalsByTeam, teams: dict.teamsList || [], props };
  const runs = {};
  const produced = [];
  const doTrends = (await env.NEWS_KV.get(`art:v1:trends:${today}`)) === null || force;
  for (const [name, fn, on] of [
    ['injury', injuryArticles, true], ['transaction', transactionArticles, true], ['result', resultArticles, true],
    ['preview', previewArticles, true], ['trend', trendArticles, doTrends], ['props', propArticles, true], ['market', marketMoveArticles, true]
  ]) {
    if (!on) { runs[name] = 'skipped (daily)'; continue; }
    try {
      const xs = await fn(ctx);
      runs[name] = xs.length;
      produced.push(...xs);
    } catch (e) {
      runs[name] = `error: ${e.message}`;
      errors.push(`${name}: ${e.stack || e.message}`.slice(0, 300));
    }
  }
  if (doTrends) await env.NEWS_KV.put(`art:v1:trends:${today}`, '1', { expirationTtl: 3 * 86400 });

  const index = (await env.NEWS_KV.get('art:v1:index', 'json')) || [];
  const byId = new Map(index.map((c) => [c.id, c]));
  const held = [];
  let written = 0;
  for (const a0 of produced) {
    const a = await withSlug(a0);
    if (a.status !== 'published') { held.push({ id: a.id, kind: a.kind, headline: a.headline, failures: a.gate.failures.slice(0, 6), at: started }); continue; }
    const prev = byId.get(a.id);
    const inHash = `${ARTICLE_VERSION}|${a.input_hash || ''}|${a.headline}|${a.deck}`;
    if (prev && prev.input_hash === inHash) continue;
    a.first_published_at = prev?.first_published_at || started;
    a.revised_at = prev ? started : null;
    await env.NEWS_KV.put(`art:v1:item:${a.id}`, JSON.stringify(a), { expirationTtl: 120 * 86400 });
    byId.set(a.id, { ...cardOf(a), input_hash: inHash, first_published_at: a.first_published_at });
    written += 1;
  }
  // Retire: trend articles older than the current day's set; keep 90 days of everything else.
  const cutoff = now - 90 * 86400e3;
  const next = [...byId.values()].filter((c) => Date.parse(c.published_at) > cutoff);
  next.sort((x, y) => String(y.published_at).localeCompare(String(x.published_at)));
  await env.NEWS_KV.put('art:v1:index', JSON.stringify(next.slice(0, 400)));
  await env.NEWS_KV.put('art:v1:held', JSON.stringify(held.slice(0, 100)));
  const status = { at: started, version: ARTICLE_VERSION, runs, produced: produced.length, written, held: held.length, published_total: next.length, errors: errors.slice(0, 10) };
  await env.NEWS_KV.put('art:v1:last_run', JSON.stringify(status));
  return status;
}
