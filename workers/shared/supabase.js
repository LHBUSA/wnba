// Minimal PostgREST client for Workers (service role, server-side only).
// Upserts always pass ?on_conflict=<cols>: without it PostgREST targets the
// primary key and a second run on a unique-but-not-PK key dies with 23505.

export function supabaseConfigured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

async function sb(env, path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  headers.set('accept', 'application/json');
  if (init.body) headers.set('content-type', 'application/json');
  const res = await fetch(`${env.SUPABASE_URL}${path}`, { ...init, headers, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase_${res.status}:${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

export async function upsert(env, table, rows, onConflict, { ignoreDuplicates = false } = {}) {
  if (!supabaseConfigured(env) || !rows?.length) return { skipped: !supabaseConfigured(env), count: 0 };
  let count = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await sb(env, `/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: 'POST',
      headers: { Prefer: `resolution=${ignoreDuplicates ? 'ignore' : 'merge'}-duplicates,return=minimal` },
      body: JSON.stringify(chunk)
    });
    count += chunk.length;
  }
  return { skipped: false, count };
}

export async function insert(env, table, rows) {
  if (!supabaseConfigured(env) || !rows?.length) return { skipped: !supabaseConfigured(env), count: 0 };
  await sb(env, `/rest/v1/${table}`, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
  return { skipped: false, count: rows.length };
}

export async function select(env, table, query) {
  if (!supabaseConfigured(env)) return null;
  return sb(env, `/rest/v1/${table}?${query}`, { method: 'GET' });
}
