#!/usr/bin/env node
// Assemble the rollback proof for the WNBA PBE ledger migration.
//
//   node supabase/proofs/build-proof.mjs local   -> proof.local.sql   (psql; emulates Supabase roles, prints results, ROLLBACK)
//   node supabase/proofs/build-proof.mjs remote  -> proof.remote.sql  (one query string for the Supabase SQL endpoint)
//
// The remote variant can never persist anything: its last statement raises an exception whose message is the
// JSON result table, which aborts the whole transaction whatever the client does, and ROLLBACK follows anyway.
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const mode = process.argv[2] || 'local';
const migration = fs.readFileSync(path.join(here, '..', 'migrations', '20260915200000_wnba_pbe_ledger_v1.sql'), 'utf8')
  .split('\n').filter((l) => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n');
const core = fs.readFileSync(path.join(here, 'wnba_pbe_ledger_v1_proof.core.sql'), 'utf8').split('{{MIGRATION}}').join(migration);

const localRoles = `-- LOCAL ONLY: emulate the Supabase roles and their default privileges on schema public
do $r$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $r$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

let out;
if (mode === 'local') {
  out = `\\set ON_ERROR_STOP on\n${localRoles}\nbegin;\n${core}\n\\pset pager off\nselect step, pass, check_name, detail from _proof order by step;\nselect count(*) filter (where pass) as passed, count(*) as total from _proof;\nrollback;\nselect count(*) as wnba_pbe_relations_after_rollback from pg_class where relname like 'wnba\\_pbe%';\n`;
} else {
  out = `begin;\n${core}\ndo $done$ begin raise exception 'WNBA_PBE_PROOF_RESULT %', (select json_agg(json_build_object('step', step, 'pass', pass, 'check', check_name, 'detail', detail) order by step) from _proof); end $done$;\nrollback;\n`;
}
const file = path.join(here, `proof.${mode}.sql`);
fs.writeFileSync(file, out);
console.log(`wrote ${file} (${out.length} bytes)`);
