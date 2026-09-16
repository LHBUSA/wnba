import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedJson } from '../workers/shared/fetcher.js';

function fakeKv() {
  const store = new Map();
  return {
    store,
    async get(key, type) {
      const value = store.get(key) ?? null;
      if (value === null) return null;
      return type === 'json' ? JSON.parse(value) : value;
    },
    async put(key, value) { store.set(key, value); }
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('ESPN site reads fail over from site.web.api to site.api before giving up', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('site.web.api.espn.com')) return new Response('blocked', { status: 503 });
    return new Response(JSON.stringify({ events: [{ id: 'ok' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await cachedJson({
      url: 'https://site.web.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=20260916-20260928',
      ttlS: 60,
      validate: (body) => Array.isArray(body?.events)
    });
    assert.equal(result.cache, 'network');
    assert.equal(result.body.events[0].id, 'ok');
    assert.equal(calls.length, 2);
    assert.match(calls[0], /site\.web\.api\.espn\.com/);
    assert.match(calls[1], /site\.api\.espn\.com/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('successful provider reads persist a per-URL last-good copy used after both ESPN hosts fail', async () => {
  const originalFetch = globalThis.fetch;
  const kv = fakeKv();
  let fail = false;
  globalThis.fetch = async () => fail
    ? new Response('down', { status: 503 })
    : new Response(JSON.stringify({ events: [{ id: 'persisted' }] }), { status: 200, headers: { 'content-type': 'application/json' } });

  const url = 'https://site.web.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=20260917-20260929';
  try {
    const first = await cachedJson({ url, ttlS: 60, kv, validate: (body) => Array.isArray(body?.events) });
    assert.equal(first.cache, 'network');
    assert.equal(first.body.events[0].id, 'persisted');
    assert.ok([...kv.store.keys()].some((key) => key.startsWith('lastgood:v1:')));

    await tick();
    fail = true;
    const second = await cachedJson({ url, ttlS: 60, kv, validate: (body) => Array.isArray(body?.events) });
    assert.equal(second.cache, 'kv-stale');
    assert.equal(second.body.events[0].id, 'persisted');
    assert.match(second.error, /upstream_503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
