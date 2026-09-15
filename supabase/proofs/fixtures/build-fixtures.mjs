#!/usr/bin/env node
// Regenerates the parser fixtures for ProofResult.ps1. The envelope files are produced with JSON.stringify, so
// the proof array inside them is escaped exactly as a JSON API error body escapes it (quotes, backslashes,
// newlines), which is the shape that broke the old manual unescaping.
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const steps = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12a', '12b', '13', '14', '15', '16', '17', '17a', '18', '18a', '18b', '19', '19a', '19b', '20', '21', '22'];
const rows = steps.map((s) => ({ step: s, pass: true, check: `check ${s}`, detail: `detail ${s}` }));
const set = (step, detail) => { rows.find((r) => r.step === step).detail = detail; };
set('00', 'PostgreSQL 17.4 on aarch64-unknown-linux-gnu · db postgres · user postgres · like pattern wnba\\_pbe% [escaped]');
set('03', 'rls=5/5 · policies=0 · anon/authenticated grants=0 · service_role: select+insert only');
set('16', '23505 duplicate key value violates unique constraint "wnba_pbe_lock_one_per_game"');
set('18a', '23514 new row for relation "wnba_pbe_grade_revisions" violates check constraint "wnba_pbe_grade_chain"');
set('22', 'before 50e13b2b9ca0d2e4977cff9c0e181637 · after 50e13b2b9ca0d2e4977cff9c0e181637 · non-wnba_pbe relations 335 → 335');

const arr = JSON.stringify(rows);
const pg = `ERROR:  P0001: WNBA_PBE_PROOF_RESULT ${arr}\nCONTEXT:  PL/pgSQL function inline_code_block line 1 at RAISE\n`;
const write = (name, body) => fs.writeFileSync(path.join(here, name), body);
write('expected-results.json', arr);
write('supabase-error-envelope.json', JSON.stringify({ message: `Failed to run sql query: ${pg}` }));
write('plain-text-error.txt', pg);
write('envelope-trailing-bracket-context.json', JSON.stringify({ message: `Failed to run sql query: ${pg.replace('at RAISE', 'at RAISE [statement 1]')}` }));
// Escaped twice: after the envelope is decoded the message still carries \" — the only shape that reproduces the
// reported "Invalid property identifier character: \. Path '[0]', line 1, position 2."
const once = JSON.stringify(pg).slice(1, -1);
write('supabase-error-envelope-double-escaped.json', JSON.stringify({ message: `Failed to run sql query: ${once}` }));
write('envelope-without-result.json', JSON.stringify({ message: 'Failed to run sql query: ERROR:  42P01: relation "x" does not exist' }));
console.log(`fixtures written (${rows.length} rows)`);
