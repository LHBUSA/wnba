#!/usr/bin/env node
// Assemble the rollback proof for the wbh (women's basketball history) migrations.
//
//   node supabase/proofs/build-wbh-proof.mjs local   -> wbh.proof.local.sql   (psql; emulates Supabase roles, prints results, ROLLBACK)
//   node supabase/proofs/build-wbh-proof.mjs remote  -> wbh.proof.remote.sql  (one query string for the Supabase SQL endpoint)
//
// Same contract as build-proof.mjs for the PBE ledger: the remote variant can never persist anything,
// because its last statement raises an exception carrying the JSON result table, which aborts the whole
// transaction whatever the client does, and ROLLBACK follows anyway.
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const mode = process.argv[2] || 'local';

const stripTx = (sql) => sql.split('\n').filter((l) => !/^\s*(begin|commit)\s*;\s*$/i.test(l)).join('\n');
const migration = (file) => stripTx(fs.readFileSync(path.join(here, '..', 'migrations', file), 'utf8'));

const core = fs.readFileSync(path.join(here, 'wbh_provenance_v1_proof.core.sql'), 'utf8')
  .split('{{MIGRATION_A}}').join(migration('20260916100000_wbh_provenance_v1.sql'))
  .split('{{MIGRATION_B}}').join(migration('20260916100100_wbh_core_v1.sql'));

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
  out = `\\set ON_ERROR_STOP on\n${localRoles}\nbegin;\n${core}\n\\pset pager off\nselect step, pass, check_name, detail from _proof order by step;\nselect count(*) filter (where pass) as passed, count(*) as total from _proof;\nrollback;\nselect count(*) as wbh_relations_after_rollback from pg_class where relname like 'wbh\\_%';\n`;
} else {
  out = `begin;\n${core}\ndo $done$ begin raise exception 'WBH_PROOF_RESULT %', (select json_agg(json_build_object('step', step, 'pass', pass, 'check', check_name, 'detail', detail) order by step) from _proof); end $done$;\nrollback;\n`;
}
const file = path.join(here, `wbh.proof.${mode}.sql`);
fs.writeFileSync(file, out);
console.log(`wrote ${file} (${out.length} bytes)`);
