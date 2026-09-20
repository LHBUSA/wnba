// WNBA Pro entitlement on the PBE routes themselves (brief Part 15) + WNBA-owned sign-in.
// Calls the real wnba-api handlers with a stub KV and a stub billing binding. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { pbePicks, pbeGame, pbeTeam, pbeCoverage, trackRecordLedger, pbeVisibility } from '../workers/wnba-api/src/pbe.js';
import { resolveAccount } from '../workers/wnba-api/src/account.js';
import { signSession, verifySession, requestLink, verifyPage, verifyConsume, logout, safeNext, SESSION_COOKIE, sha256Hex } from '../workers/wnba-api/src/auth.js';
import { buildPredictionDoc, lockDoc } from '../workers/shared/pbe-runtime.js';

const SECRET = 'test-session-secret-0123456789abcdef';
const APP = 'https://wnba.propbetedge.ai';
const API = 'https://wnba-api.propbetedge.ai';
// Any of these in a denied body would be a leak of paid values.
const PAID = /p_home|p_away|pick_probability|win_probability|team_probability|feature_vector|feature_hash|pbe_edge|supporting|opposing|devig|consensus_moneyline|confidence|pick_team_id/;

const ROWS = zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/pbe-wnba-model/rows-2025-2026.jsonl.gz', import.meta.url))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

function kvStore() {
  const m = new Map();
  return {
    map: m,
    async get(k, type) { const v = m.get(k); if (v === undefined) return null; return type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, typeof v === 'string' ? v : JSON.stringify(v)); },
    async delete(k) { m.delete(k); }
  };
}

// Billing ledger stub: per email, per product. Records every read so the product key can be asserted.
const LEDGER = {
  'pro@example.com': { wnba_pro: { entitled: true, subscription: { plan: 'monthly', status: 'active', current_period_end: '2099-01-01T00:00:00Z', cancel_at_period_end: false } } },
  'expired@example.com': { wnba_pro: { entitled: false, subscription: { plan: 'weekly', status: 'active', current_period_end: '2020-01-01T00:00:00Z', cancel_at_period_end: false } } },
  'nba@example.com': { nba_pro: { entitled: true, subscription: { plan: 'monthly', status: 'active', current_period_end: '2099-01-01T00:00:00Z' } } },
  'free@example.com': {}
};
function billing(reads, { down = false } = {}) {
  return {
    async fetch(url, init) {
      if (down) throw new TypeError('network');
      assert.equal(new URL(url).pathname, '/v1/entitlement');
      assert.equal(init.headers.authorization, 'Bearer read-token');
      const { email, product_key } = JSON.parse(init.body);
      reads.push({ email, product_key });
      const e = LEDGER[email]?.[product_key];
      return new Response(JSON.stringify({ entitled: Boolean(e?.entitled), product_key, subscription: e?.subscription || null }), { status: 200 });
    }
  };
}

const GAME_ID = '499990001';
async function seededEnv(extra = {}) {
  const kv = kvStore();
  const tip = new Date(Date.now() + 26 * 3600e3).toISOString();
  const game = { event_id: GAME_ID, season: 2026, season_type: 2, start_utc: tip, neutral: false, home_id: '20', away_id: '18' };
  const doc = await buildPredictionDoc({
    game, leagueRows: ROWS, asOf: new Date().toISOString(), runId: 't', mode: 'dry_run',
    marketEvent: { home_team_id: '20', away_team_id: '18', moneyline: { books: [{ book: 'a', home: -300, away: 240 }, { book: 'b', home: -280, away: 230 }] } },
    marketCapturedAt: new Date().toISOString()
  });
  const index = { generated_at: new Date().toISOString(), games: [{ game_id: GAME_ID, scheduled_tip_utc: tip, home_team_id: '20', away_team_id: '18', locked: false }] };
  for (const ledger of ['official', 'shadow']) {
    await kv.put(`pbe:v1:${ledger}:pred:${GAME_ID}`, JSON.stringify({ ...doc, mode: ledger === 'shadow' ? 'dry_run' : 'armed' }));
    await kv.put(`pbe:v1:${ledger}:index`, JSON.stringify(index));
  }
  const reads = [];
  return { reads, doc, env: { WNBA_SESSION_SECRET: SECRET, WNBA_KV: kv, BILLING: billing(reads), ENTITLEMENT_READ_TOKEN: 'read-token', PBE_PUBLISH: 'true', WNBA_OWNER_EMAILS: 'owner@example.com', ...extra } };
}

const sessionFor = (email, opts = {}) => signSession({ email, sid: opts.sid || 'sid_0123456789abcdef', now: opts.now }, opts.secret || SECRET);
function req(path, { cookie, headers = {}, method = 'GET', origin = APP, body } = {}) {
  const h = new Headers({ origin, ...headers });
  if (cookie) h.set('cookie', `${SESSION_COOKIE}=${cookie}`);
  return new Request(`${API}${path}`, { method, headers: h, body });
}
async function call(handler, path, env, opts = {}, params = {}) {
  const res = await handler({ request: req(path, opts), env, params });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text), headers: res.headers };
}
const ROUTES = [[pbePicks, '/v1/pbe/picks', {}], [pbeGame, `/v1/pbe/games/${GAME_ID}`, { id: GAME_ID }], [pbeTeam, '/v1/pbe/teams/20', { id: '20' }], [trackRecordLedger, '/v1/track-record/ledger', {}]];

async function assertDenied(env, opts, expectStatus, label) {
  for (const [h, path, params] of ROUTES) {
    const r = await call(h, path, env, opts, params);
    assert.equal(r.status, expectStatus, `${label} ${path} status`);
    assert.equal(r.body.ok, false, `${label} ${path} ok`);
    assert.doesNotMatch(r.text, PAID, `${label} ${path} leaked a paid field`);
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
  }
}

test('signed out → no pick data on any protected route (401)', async () => {
  const { env } = await seededEnv();
  await assertDenied(env, {}, 401, 'signed_out');
});

test('authenticated free → no pick data (403)', async () => {
  const { env, reads } = await seededEnv();
  await assertDenied(env, { cookie: await sessionFor('free@example.com') }, 403, 'free');
  assert.ok(reads.every((r) => r.product_key === 'wnba_pro'));
});

test('WNBA Pro → full pick', async () => {
  const { env, doc } = await seededEnv();
  const cookie = await sessionFor('pro@example.com');
  const picks = await call(pbePicks, '/v1/pbe/picks', env, { cookie });
  assert.equal(picks.status, 200);
  assert.equal(picks.body.data.picks.length, 1);
  const p = picks.body.data.picks[0];
  assert.equal(p.phase, 'PRE_LOCK');
  assert.equal(p.p_home, doc.p_home);
  assert.equal(p.pick_team_id, doc.pick_team_id);
  assert.equal(p.market.available, true);
  assert.equal(p.ledger, 'official');
  assert.equal(picks.headers.get('access-control-allow-origin'), APP);
  assert.equal(picks.headers.get('access-control-allow-credentials'), 'true');
});

test('expired subscription → no pick', async () => {
  const { env } = await seededEnv();
  await assertDenied(env, { cookie: await sessionFor('expired@example.com') }, 403, 'expired');
});

test('NBA Pro only → no WNBA pick (wnba-api asks the ledger for wnba_pro only)', async () => {
  const { env, reads } = await seededEnv();
  await assertDenied(env, { cookie: await sessionFor('nba@example.com') }, 403, 'nba_only');
  assert.ok(reads.length > 0 && reads.every((r) => r.email === 'nba@example.com' && r.product_key === 'wnba_pro'));
});

test('forged browser state → no access', async () => {
  const { env } = await seededEnv();
  const good = await sessionFor('pro@example.com');
  const [h, p] = good.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const forgeries = {
    wrong_secret: await sessionFor('pro@example.com', { secret: 'not-the-secret-000000000000000000' }),
    alg_none: `${b64({ alg: 'none', typ: 'JWT' })}.${p}.`,
    tampered_sub: `${h}.${b64({ ...payload, sub: 'pro@example.com', sid: 'sid_ffffffffffffffff' })}.${good.split('.')[2]}`,
    free_token_relabelled: (await sessionFor('free@example.com')).split('.').slice(0, 2).join('.') + '.' + good.split('.')[2],
    expired: await sessionFor('pro@example.com', { now: Date.now() - 31 * 86400e3 }),
    garbage: 'eyJ.not.a.jwt'
  };
  for (const [label, cookie] of Object.entries(forgeries)) await assertDenied(env, { cookie }, 401, label);
  // Query string, headers and a non-session cookie can never carry identity.
  for (const [h2, path, params] of ROUTES) {
    const r = await h2({ request: new Request(`${API}${path}?email=pro@example.com&entitled=true&pro=1`, { headers: { origin: APP, 'x-user-email': 'pro@example.com', 'x-wnba-pro': 'true', authorization: 'Bearer pro@example.com', cookie: 'wnba_pro=true; entitled=1; pbe_session=x' } }), env, params });
    const text = await r.text();
    assert.equal(r.status, 401, `${path} with forged query/headers`);
    assert.doesNotMatch(text, PAID);
  }
  // A revoked session (after logout) is dead even though its signature is valid.
  await env.WNBA_KV.put('auth:revoked:sid_0123456789abcdef', '1');
  await assertDenied(env, { cookie: good }, 401, 'revoked');
});

test('billing ledger unreachable → no pick data, reported as UNAVAILABLE (never Pro)', async () => {
  const { env } = await seededEnv();
  const reads = [];
  env.BILLING = billing(reads, { down: true });
  const cookie = await sessionFor('pro@example.com');
  await assertDenied(env, { cookie }, 403, 'ledger_down');
  const acct = await resolveAccount(req('/v1/account', { cookie }), env);
  assert.deepEqual([acct.state, acct.entitlement_check], ['free', 'UNAVAILABLE']);
});

test('publication gate: before PBE_PUBLISH a subscriber sees MODEL_IN_VALIDATION with no values; only the owner sees shadow', async () => {
  const { env } = await seededEnv({ PBE_PUBLISH: undefined });
  const sub = await call(pbePicks, '/v1/pbe/picks', env, { cookie: await sessionFor('pro@example.com') });
  assert.equal(sub.status, 200);
  assert.equal(sub.body.data.availability, 'MODEL_IN_VALIDATION');
  assert.doesNotMatch(sub.text, PAID);
  const owner = await call(pbePicks, '/v1/pbe/picks', env, { cookie: await sessionFor('owner@example.com') });
  assert.equal(owner.body.data.availability, 'SHADOW_OWNER_ONLY');
  assert.equal(owner.body.data.picks[0].ledger, 'shadow');
  assert.equal(owner.body.data.picks[0].shadow, true);
  assert.deepEqual(pbeVisibility({ entitled: true, access: 'owner' }, { PBE_PUBLISH: 'true' }), { mode: 'full', ledger: 'official' });
});

test('public coverage exposes ids, tips and phase only', async () => {
  const { env } = await seededEnv();
  const res = await pbeCoverage({ env });
  const text = await res.text();
  assert.doesNotMatch(text, PAID);
  assert.equal(JSON.parse(text).data.games[0].game_id, GAME_ID);
});

test('same game = same prediction on both team pages (one canonical document, oriented)', async () => {
  const { env, doc } = await seededEnv();
  const cookie = await sessionFor('pro@example.com');
  const home = (await call(pbeTeam, '/v1/pbe/teams/20', env, { cookie }, { id: '20' })).body.data;
  const away = (await call(pbeTeam, '/v1/pbe/teams/18', env, { cookie }, { id: '18' })).body.data;
  assert.equal(home.game.game_id, away.game.game_id);
  assert.equal(home.feature_hash, away.feature_hash);
  assert.equal(home.feature_hash, doc.feature_hash);
  assert.equal(home.pick_team_id, away.pick_team_id);
  assert.equal(home.p_home, away.p_home);
  assert.equal(home.oriented.team_probability, away.oriented.opponent_probability);
  assert.equal(home.oriented.team_is_pick, !away.oriented.team_is_pick);
  assert.deepEqual(home.market, away.market);
});

test('a locked call serves the frozen lock, and a tipped game without a lock shows no call', async () => {
  const { env, doc } = await seededEnv();
  const lock = lockDoc({ ...doc, p_home: doc.p_home }, { ledger: 'official' });
  await env.WNBA_KV.put(`pbe:v1:official:lock:${GAME_ID}`, JSON.stringify(lock));
  await env.WNBA_KV.put(`pbe:v1:official:pred:${GAME_ID}`, JSON.stringify({ ...doc, p_home: 0.01, p_away: 0.99 })); // a later provisional must not override the lock
  const cookie = await sessionFor('pro@example.com');
  const g = (await call(pbeGame, `/v1/pbe/games/${GAME_ID}`, env, { cookie }, { id: GAME_ID })).body.data;
  assert.equal(g.phase, 'LOCKED');
  assert.equal(g.p_home, lock.p_home);
  // tipped, no lock
  const past = { ...doc, game: { ...doc.game, scheduled_tip_utc: new Date(Date.now() - 60e3).toISOString() } };
  await env.WNBA_KV.delete(`pbe:v1:official:lock:${GAME_ID}`);
  await env.WNBA_KV.put(`pbe:v1:official:pred:${GAME_ID}`, JSON.stringify(past));
  const t = await call(pbeGame, `/v1/pbe/games/${GAME_ID}`, env, { cookie }, { id: GAME_ID });
  assert.equal(t.body.data.phase, 'NOT_LOCKED');
  assert.equal(t.body.data.call, null);
  assert.doesNotMatch(t.text, /p_home|pick_probability/);
});

test('official lock stays on the picks board after tip even when the mutable KV index drops the live game', async (t) => {
  const { env, doc } = await seededEnv({
    PBE_SUPABASE_URL: 'https://ledger.test',
    PBE_SUPABASE_SERVICE_ROLE_KEY: 'service-key'
  });

  const now = Date.now();
  const tip = new Date(now - 60e3).toISOString();
  const lockedAt = new Date(now - 16 * 60e3).toISOString();
  const generatedAt = new Date(now - 17 * 60e3).toISOString();
  const selectedSide = String(doc.pick_team_id) === String(doc.game.home_team_id) ? 'home' : 'away';
  const row = {
    prediction_id: '11111111-1111-4111-8111-111111111111',
    contract: 'game_winner_v1',
    game_id: GAME_ID,
    season: 2026,
    season_type: 2,
    scheduled_tip_utc: tip,
    home_team_id: String(doc.game.home_team_id),
    away_team_id: String(doc.game.away_team_id),
    neutral_site: false,
    call: 'PICK',
    no_call_reason: null,
    selected_team_id: String(doc.pick_team_id),
    selected_side: selectedSide,
    p_home: doc.p_home,
    win_probability: doc.pick_probability,
    confidence: doc.confidence,
    feature_vector: { order: doc.feature_order, values: doc.feature_vector },
    feature_hash: doc.feature_hash,
    model_id: doc.model.model_id,
    artifact_sha256: doc.model.artifact_sha256,
    feature_spec_sha256: doc.model.feature_spec_sha256,
    reasoning: doc.reasoning,
    generated_at: generatedAt,
    locked_at: lockedAt,
    lock_policy: 'T-15m/v1',
    market_at_lock: doc.market,
    market_devig_probability: null,
    pbe_edge_at_lock: doc.market?.pbe_edge ?? null
  };

  // Reproduce the production failure exactly: ESPN flips the game live, the
  // mutable "current games" index no longer contains it, and the KV lock mirror
  // is absent. The immutable official ledger still has the pre-tip lock.
  await env.WNBA_KV.put('pbe:v1:official:index', JSON.stringify({
    generated_at: new Date(now).toISOString(),
    games: [],
    locked_history: []
  }));
  await env.WNBA_KV.delete(`pbe:v1:official:pred:${GAME_ID}`);
  await env.WNBA_KV.delete(`pbe:v1:official:lock:${GAME_ID}`);

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/rest/v1/wnba_pbe_locked_predictions')) {
      return new Response(JSON.stringify([row]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/rest/v1/wnba_pbe_current_grades')) {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected network read: ${u}`);
  };
  t.after(() => { globalThis.fetch = realFetch; });

  const picks = await call(pbePicks, '/v1/pbe/picks', env, { cookie: await sessionFor('pro@example.com') });
  assert.equal(picks.status, 200);
  assert.equal(picks.body.data.picks.length, 1);
  const p = picks.body.data.picks[0];
  assert.equal(p.game.game_id, GAME_ID);
  assert.equal(p.phase, 'LOCKED');
  assert.equal(p.call, 'PICK');
  assert.equal(p.pick_team_id, row.selected_team_id);
  assert.equal(p.pick_probability, row.win_probability);
  assert.equal(p.locked_at, lockedAt);
});

// ------------------------------------------------------------------ sign-in

function authEnv() {
  const sent = [];
  return { sent, env: { WNBA_SESSION_SECRET: SECRET, WNBA_KV: kvStore(), EMAIL: { async send(m) { sent.push(m); return { messageId: 'm1' }; } }, AUTH_FROM: 'signin@mail.wnba.propbetedge.ai', AUTH_PUBLIC_BASE: API } };
}

test('sign-in link: app origin only, configured only, token stored hashed, generic answer', async () => {
  const { env, sent } = authEnv();
  const post = (origin, body) => requestLink(new Request(`${API}/v1/auth/request`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4' }, body: JSON.stringify(body) }), env);
  assert.equal((await post('https://evil.example', { email: 'a@example.com' })).status, 403);
  assert.equal((await post(APP, { email: 'not-an-email' })).status, 400);
  const ok = await post(APP, { email: 'Pro@Example.com', next: '/teams/20' });
  assert.equal(ok.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'pro@example.com');
  const token = sent[0].text.match(/t=([A-Za-z0-9_-]+)/)[1];
  assert.ok(!env.WNBA_KV.map.has(`auth:link:${token}`));
  assert.ok(env.WNBA_KV.map.has(`auth:link:${await sha256Hex(token)}`));
  const { EMAIL, ...unconfigured } = env;
  assert.equal((await requestLink(new Request(`${API}/v1/auth/request`, { method: 'POST', headers: { origin: APP }, body: '{}' }), unconfigured)).status, 503);
});

test('sign-in link: GET never consumes; POST consumes once, sets a host-only session cookie, redirects safely', async () => {
  const { env, sent } = authEnv();
  await requestLink(new Request(`${API}/v1/auth/request`, { method: 'POST', headers: { origin: APP, 'cf-connecting-ip': '1.2.3.4' }, body: JSON.stringify({ email: 'pro@example.com', next: '//evil.example/x' }) }), env);
  const token = sent[0].text.match(/t=([A-Za-z0-9_-]+)/)[1];
  const page = await verifyPage(new Request(`${API}/v1/auth/verify?t=${token}`), env);
  assert.equal(page.status, 200);
  assert.ok(env.WNBA_KV.map.has(`auth:link:${await sha256Hex(token)}`), 'GET must not consume');
  const pageCookie = page.headers.get('set-cookie');
  assert.match(pageCookie, /^__Host-wnba_verify=[A-Za-z0-9_-]+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=900$/);
  const nonce = pageCookie.split(';')[0].split('=')[1];
  const html = await page.text();
  assert.ok(html.includes(`name="n" value="${nonce}"`), 'form carries the same nonce');
  assert.match(page.headers.get('content-security-policy'), /form-action 'self' https:\/\/wnba\.propbetedge\.ai/);
  assert.equal(page.headers.get('referrer-policy'), 'same-origin');
  // Real browsers may send Origin: null for this POST (the production regression of 2026-09-15). That must work.
  const form = ({ origin = 'null', withCookie = true, n = nonce } = {}) => new Request(`${API}/v1/auth/verify`, { method: 'POST', headers: { ...(origin ? { origin } : {}), ...(withCookie ? { cookie: `__Host-wnba_verify=${nonce}` } : {}), 'content-type': 'application/x-www-form-urlencoded' }, body: `t=${token}&n=${n}` });
  // Refusals never consume the link.
  assert.equal((await verifyConsume(form({ withCookie: false }), env)).status, 403, 'cross-site POST without the nonce cookie');
  assert.equal((await verifyConsume(form({ n: 'x'.repeat(32) }), env)).status, 403, 'nonce mismatch');
  assert.equal((await verifyConsume(form({ origin: 'https://evil.example' }), env)).status, 403, 'explicit foreign origin');
  assert.ok(env.WNBA_KV.map.has(`auth:link:${await sha256Hex(token)}`), 'refused attempts left the link unconsumed');
  const first = await verifyConsume(form(), env);
  assert.equal(first.status, 303, 'Origin: null with a matching nonce signs in');
  assert.equal(first.headers.get('location'), `${APP}/pbe-picks`);
  const sets = first.headers.getSetCookie();
  const set = sets.find((s) => s.startsWith('__Host-wnba_session='));
  assert.match(set, /^__Host-wnba_session=[^;]+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
  assert.ok(sets.some((s) => /^__Host-wnba_verify=; .*Max-Age=0$/.test(s)), 'nonce cookie cleared');
  const jwt = set.split(';')[0].split('=')[1];
  assert.equal((await verifySession(jwt, SECRET)).email, 'pro@example.com');
  assert.equal((await verifyConsume(form(), env)).status, 410, 'second use');
  assert.equal((await verifyConsume(form({ origin: null }), env)).status, 410, 'no Origin header at all still reaches the token check');
  assert.equal(safeNext('/teams/20'), '/teams/20');
  assert.equal(safeNext('https://evil.example'), '/pbe-picks');
  assert.equal(safeNext('/\\evil'), '/pbe-picks');
});

test('logout revokes the session id', async () => {
  const { env } = authEnv();
  const cookie = await sessionFor('pro@example.com', { sid: 'sid_logout_000000000' });
  const res = await logout(req('/v1/auth/logout', { method: 'POST', cookie }), env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
  assert.ok(env.WNBA_KV.map.has('auth:revoked:sid_logout_000000000'));
});

test('index.js routes the protected paths to exactly these handlers', () => {
  const src = fs.readFileSync(new URL('../workers/wnba-api/src/index.js', import.meta.url), 'utf8');
  for (const [path, fn] of [['/v1/pbe/picks', 'pbePicks'], ['/v1/pbe/games/:id', 'pbeGame'], ['/v1/pbe/teams/:id', 'pbeTeam'], ['/v1/track-record/ledger', 'trackRecordLedger'], ['/v1/account', 'account']]) {
    assert.match(src, new RegExp(`\\['${path.replace(/[/:]/g, (c) => `\\${c}`)}', ${fn}\\]`), path);
  }
  assert.match(src, /'\/v1\/auth\/request': requestLink/);
});
