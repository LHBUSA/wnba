#!/usr/bin/env node
// Static truth guards. Runs before every build (npm run check / vercel-build).
// Fails the build on: synthetic data generators, browser->provider calls,
// NBA identifiers leaking into WNBA code, Vercel Functions / Actions runtime,
// secrets in source, unverified photo entries, and half-activated checkout.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const fails = [];
const fail = (rule, where) => fails.push(`${rule}: ${where}`);

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', '.wrangler'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).replaceAll('\\', '/');
const read = (p) => fs.readFileSync(p, 'utf8');

const src = walk(path.join(ROOT, 'src'), ['.js', '.css', '.html']);
const workers = walk(path.join(ROOT, 'workers'), ['.js']);
const code = [...src, ...workers];

// 1. No randomness anywhere in production paths (sports data must be real).
for (const f of code) if (/Math\.random\s*\(/.test(read(f))) fail('no-math-random', rel(f));

// 2. Browser code never talks to a provider or database directly.
const PROVIDER_HOSTS = [/site\.web\.api\.espn\.com/, /site\.api\.espn\.com/, /sports\.core\.api\.espn\.com/, /api\.the-odds-api\.com/, /supabase\.co/, /cdn\.wnba\.com/, /stats\.wnba\.com/, /a\.espncdn\.com/, /upload\.wikimedia\.org/];
for (const f of src) {
  const t = read(f).replace(/^\s*\/\/.*$/gm, '');
  for (const re of PROVIDER_HOSTS) if (re.test(t)) fail('no-browser-provider-call', `${rel(f)} -> ${re}`);
}
const html = read(path.join(ROOT, 'index.html'));
for (const re of PROVIDER_HOSTS) if (re.test(html)) fail('no-browser-provider-call', `index.html -> ${re}`);

// 3. No NBA identifiers / endpoints in WNBA code.
const NBA = [/basketball\/nba\b/, /stats\.nba\.com/, /cdn\.nba\.com/, /LeagueID=00\b/, /nba-live-feed/, /leagues\/nba\b/];
for (const f of code) for (const re of NBA) if (re.test(read(f))) fail('no-nba-identifiers', `${rel(f)} -> ${re}`);

// 4. Vercel presents only; GitHub Actions never run production.
if (fs.existsSync(path.join(ROOT, 'api'))) fail('no-vercel-functions', 'api/ directory exists');
const vj = JSON.parse(read(path.join(ROOT, 'vercel.json')));
if (vj.functions || vj.crons) fail('no-vercel-functions', 'vercel.json declares functions/crons');
for (const f of walk(path.join(ROOT, '.github'), ['.yml', '.yaml'])) if (/schedule\s*:|cron\s*:/.test(read(f))) fail('no-actions-scheduler', rel(f));

// 5. No secrets in source.
const SECRET = [/sk_live_[0-9a-zA-Z]{10,}/, /sk_test_[0-9a-zA-Z]{10,}/, /whsec_[0-9a-zA-Z]{10,}/, /eyJhbGciOiJIUzI1NiIs[0-9a-zA-Z._-]{40,}/, /apiKey=[0-9a-f]{32}/];
for (const f of [...code, ...walk(path.join(ROOT, 'supabase'), ['.sql']), ...walk(path.join(ROOT, 'docs'), ['.md'])]) for (const re of SECRET) if (re.test(read(f))) fail('no-secrets', `${rel(f)} -> ${re}`);

// 6. Every approved photo is complete, licensed, identity-verified and present on disk.
const manifest = JSON.parse(read(path.join(ROOT, 'data', 'player-photos.json')));
const OK_LICENSE = /^(cc0|public domain|pd|cc by(-sa)? \d(\.\d)?|cc by(-sa)?|cc-by(-sa)?-\d(\.\d)?)/i;
for (const p of manifest.players || []) {
  if (p.status !== 'approved') continue;
  const i = p.image || {};
  const where = `player ${p.espn_athlete_id} ${p.display_name}`;
  if (!p.espn_athlete_id || !p.display_name) fail('photo-identity', where);
  if (i.identity_confidence !== 'high') fail('photo-identity-confidence', where);
  if (!i.source_page_url || !i.license_short || !i.attribution_text || !i.verified_at) fail('photo-provenance', where);
  if (!OK_LICENSE.test(String(i.license_short).trim()) || /\bnc\b|\bnd\b|non-?commercial|no-?deriv/i.test(i.license_short)) fail('photo-license', `${where} (${i.license_short})`);
  for (const v of ['portrait.webp', 'square.webp']) if (!fs.existsSync(path.join(ROOT, 'public', 'media', 'players', String(p.espn_athlete_id), v))) fail('photo-derivative-missing', `${where} ${v}`);
}
// every derivative on disk must belong to an approved manifest entry (no orphan/wrong-person files)
const mediaDir = path.join(ROOT, 'public', 'media', 'players');
if (fs.existsSync(mediaDir)) {
  const approved = new Set((manifest.players || []).filter((p) => p.status === 'approved').map((p) => String(p.espn_athlete_id)));
  for (const d of fs.readdirSync(mediaDir)) if (!approved.has(d)) fail('photo-orphan-derivative', `public/media/players/${d}`);
}

// 6a. Newsroom story media: every derivative is built from the SAME approved ledger file, credited, on disk,
// never upscaled past 1.3x, and no newsroom folder exists for a player who is not approved.
const news = JSON.parse(read(path.join(ROOT, 'data', 'newsroom-media.json')));
const ledgerById = new Map((manifest.players || []).map((p) => [String(p.espn_athlete_id), p]));
for (const [pid, e] of Object.entries(news.players || {})) {
  const lp = ledgerById.get(pid);
  const where = `newsroom media ${pid} ${e.name}`;
  if (!lp || lp.status !== 'approved') { fail('news-media-unapproved', where); continue; }
  if (e.commons_file !== lp.image?.commons_file) fail('news-media-source-mismatch', `${where}: ${e.commons_file} != ${lp.image?.commons_file}`);
  if (!e.attribution || !e.license || !e.source_page_url) fail('news-media-credit', where);
  if (!e.slots?.wide?.length || !e.slots?.half?.length) fail('news-media-slots', where);
  for (const f of Object.values(e.slots || {}).flat()) {
    if (!/^\/media\/news\/players\/\d+\/[a-z0-9-]+\.(webp|jpg)$/.test(f.src)) fail('news-media-origin', `${where} ${f.src}`);
    else if (!fs.existsSync(path.join(ROOT, 'public', f.src))) fail('news-media-missing', `${where} ${f.src}`);
    if (!(f.scale <= 1.3)) fail('news-media-upscaled', `${where} ${f.src} scale ${f.scale}`);
  }
}
const newsDir = path.join(ROOT, 'public', 'media', 'news', 'players');
if (fs.existsSync(newsDir)) for (const d of fs.readdirSync(newsDir)) if (!news.players?.[d] || ledgerById.get(d)?.status !== 'approved') fail('news-media-orphan', `public/media/news/players/${d}`);

// 6c. The shipped page shell references no third-party host (fonts are self-hosted; data comes from owned Workers).
const shell = read(path.join(ROOT, 'index.html')).replace(/<meta[^>]+>/g, '').replace(/<link rel="canonical"[^>]*>/g, '');
if (/(src|href)="https?:\/\//i.test(shell)) fail('third-party-host', 'index.html loads an outside host');

// 6b. Team logos: every manifest entry is served from our origin and present on disk.
const logos = JSON.parse(read(path.join(ROOT, 'data', 'team-logos.json')));
for (const t of logos.teams || []) {
  for (const [size, f] of Object.entries(t.files || {})) {
    if (!f.startsWith('/media/teams/')) fail('logo-origin', `${t.abbr} ${size} -> ${f}`);
    if (!fs.existsSync(path.join(ROOT, 'public', f))) fail('logo-missing', `${t.abbr} ${f}`);
  }
}
if ((logos.teams || []).length < 15) fail('logo-coverage', `${(logos.teams || []).length} team logos`);

// 7. Checkout activation is atomic: links and the server flag flip together.
const pricing = read(path.join(ROOT, 'src', 'data', 'pricing.js'));
const hasUrls = /url:\s*'https:\/\/buy\.stripe\.com\//.test(pricing);
const apiToml = read(path.join(ROOT, 'workers', 'wnba-api', 'wrangler.toml'));
const active = /WNBA_PURCHASE_ACTIVE\s*=\s*"true"/.test(apiToml);
if (hasUrls !== active) fail('checkout-atomic', `payment links ${hasUrls ? 'set' : 'unset'} but WNBA_PURCHASE_ACTIVE=${active}`);
if (/localStorage[^\n]*(pro|entitle|premium)/i.test(src.map(read).join('\n'))) fail('no-client-entitlement', 'localStorage used for entitlement');

// 8. Volatile Worker routes carry source/freshness metadata.
const apiSrc = read(path.join(ROOT, 'workers', 'wnba-api', 'src', 'index.js'));
const okCalls = apiSrc.match(/return ok\(/g)?.length || 0;
const withMeta = apiSrc.match(/return ok\([\s\S]*?(base\(path|gameMeta\(path)/g)?.length || 0;
if (okCalls !== withMeta) fail('envelope-meta', `wnba-api: ${okCalls} ok() responses, ${withMeta} with meta`);

if (fails.length) {
  console.error(`guard-truth: ${fails.length} failure(s)`);
  for (const f of fails) console.error('  ✗', f);
  process.exit(1);
}
console.log(`guard-truth: PASS (${code.length} source files, ${(manifest.players || []).filter((p) => p.status === 'approved').length} approved photos)`);
