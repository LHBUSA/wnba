// Shared PropBetEdge membership contract on the WNBA frontend: the browser only reads the server's verdict,
// members never see a purchase CTA, free visitors get the WNBA plan first and the All Access card beneath it,
// and the copy rules from shared/membership/README.md hold across src/.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT_VERSION, deriveMembership, planText, membershipBadgeHtml, allAccessCardHtml, ALL_ACCESS_OFFER } from '../src/lib/pbe-membership.js';
import { membershipFrom, isMember } from '../src/lib/membership.js';
import { proFeaturePublicView } from '../src/views/pro-intelligence.js';
import { pbeTeaser } from '../src/ui/pbe.js';
import { propEdgeSection } from '../src/ui/prop-edge.js';
import { shellHtml } from '../src/ui/shell.js';
import { PRO_INTELLIGENCE } from '../src/data/pro-features.js';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}
const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));
const SRC = walk(SRC_DIR).filter((p) => !p.endsWith('pbe-membership.js'));
const acct = (data) => ({ ok: true, data });
const serverMembership = (o) => deriveMembership({ sport: 'wnba', ...o });

test('client copy of the contract is the canonical 1.1.0 vocabulary', () => {
  assert.equal(CONTRACT_VERSION, '1.1.0');
  assert.equal(read('src/lib/pbe-membership.js'), read('workers/wnba-api/src/pbe-membership.js'));
  assert.equal(membershipBadgeHtml(serverMembership({ entitled: true, accessSource: 'sport' })), '<span class="pbe-mbr-badge is-sport_pro" data-pbe-membership="sport_pro">WNBA PRO ACTIVE</span>');
  assert.match(membershipBadgeHtml(serverMembership({ entitled: true, accessSource: 'all_access' })), />ALL ACCESS ACTIVE</);
  assert.match(membershipBadgeHtml(serverMembership({ entitled: true, accessSource: 'owner' })), />OWNER</);
  assert.match(membershipBadgeHtml(serverMembership({ entitled: false })), />FREE</);
});

test('membershipFrom reads only the server object; malformed, missing or browser-forged values are FREE', () => {
  assert.equal(membershipFrom(null).state, 'free');
  assert.equal(membershipFrom({ ok: false, data: null }).state, 'free');
  assert.equal(membershipFrom(acct({ state: 'signed_out', membership: serverMembership({ entitled: false }) })).state, 'free');
  // A forged "all_access" without entitled:true cannot widen access.
  assert.equal(membershipFrom(acct({ state: 'free', membership: { state: 'all_access', entitled: false, label: 'ALL ACCESS ACTIVE' } })).state, 'free');
  assert.equal(membershipFrom(acct({ state: 'free', membership: { state: 'owner' } })).state, 'free');
  const aa = membershipFrom(acct({ state: 'pro', entitled: true, membership: serverMembership({ entitled: true, accessSource: 'all_access', productKey: 'pbe_all_access', plan: 'monthly', email: 'a@example.com', currentPeriodEnd: '2099-02-01T00:00:00Z' }) }));
  assert.deepEqual([aa.state, aa.label, aa.plan, aa.show_purchase_cta, aa.show_all_access_upgrade, aa.show_manage], ['all_access', 'ALL ACCESS ACTIVE', 'monthly', false, false, true]);
  assert.equal(planText(aa), 'All Access · every PropBetEdge sport');
  assert.equal(planText(membershipFrom(acct({ state: 'pro', entitled: true, membership: serverMembership({ entitled: true, accessSource: 'sport', plan: 'weekly' }) }))), 'WNBA Pro · weekly');
  assert.equal(planText(membershipFrom(acct({ state: 'pro', entitled: true, membership: serverMembership({ entitled: true, accessSource: 'owner' }) }))), 'Owner access');
});

test('legacy wnba-api without `membership` (deploy window): the server verdict still decides, plan names never widen it', () => {
  const legacyPro = membershipFrom(acct({ state: 'pro', entitled: true, access: 'subscriber', email: 'p@example.com', plan: 'monthly', current_period_end: '2099-01-01T00:00:00Z' }));
  assert.deepEqual([legacyPro.state, legacyPro.label, legacyPro.plan], ['sport_pro', 'WNBA PRO ACTIVE', 'monthly']);
  const legacyOwner = membershipFrom(acct({ state: 'pro', entitled: true, access: 'owner', email: 'o@example.com' }));
  assert.equal(legacyOwner.state, 'owner');
  assert.equal(membershipFrom(acct({ state: 'free', entitled: false, email: 'f@example.com', plan: 'pbe_all_access' })).state, 'free');
  assert.equal(membershipFrom(acct({ state: 'pro', entitled: false })).state, 'free');
  assert.ok(!isMember(membershipFrom(acct({ state: 'free' }))));
});

test('free teasers: WNBA CTA first, All Access card beneath; members: no purchase CTA', () => {
  const free = String(proFeaturePublicView(PRO_INTELLIGENCE[1]));
  assert.ok(free.indexOf('Unlock WNBA Pro') < free.indexOf('pbe-mbr-aa'), 'WNBA plan CTA precedes the All Access card');
  assert.match(free, /Get All Access →/);
  assert.match(free, new RegExp(ALL_ACCESS_OFFER.checkoutUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(free, /One Pro entitlement|separate from|Stripe/);

  const teaser = String(pbeTeaser({ team: { team_id: '20' }, opponent: { team_id: '18' }, isHome: true, tipUtc: '2026-09-25T23:00:00Z' }));
  assert.match(teaser, /Unlock WNBA Pro/);
  assert.match(teaser, /pbe-mbr-aa/);
  const memberTeaser = String(pbeTeaser({ team: { team_id: '20' }, opponent: { team_id: '18' }, isHome: true, tipUtc: '2026-09-25T23:00:00Z', member: true }));
  assert.doesNotMatch(memberTeaser, /Unlock|pbe-mbr-aa|buy\.stripe\.com/);
  assert.match(memberTeaser, /Open PBE Picks/);

  const propFree = String(propEdgeSection({ account: acct({ state: 'free', membership: serverMembership({ entitled: false, email: 'f@example.com' }) }), edge: null }));
  assert.match(propFree, /Upgrade to WNBA Pro/);
  assert.match(propFree, /pbe-mbr-aa is-compact/);
  assert.equal(allAccessCardHtml(serverMembership({ entitled: true, accessSource: 'all_access' })), '');
  assert.equal(allAccessCardHtml(serverMembership({ entitled: true, accessSource: 'owner' })), '');
  assert.match(allAccessCardHtml(serverMembership({ entitled: true, accessSource: 'sport' })), /Upgrade to All Access/);
});

test('shell stays neutral until the verdict arrives and no longer sells one entitlement', () => {
  const doc = String(shellHtml());
  assert.match(doc, /<a class="btn-pro" href="\/pro" data-nav="pro">WNBA Pro<\/a>/);
  assert.doesNotMatch(doc, /one WNBA Pro entitlement/);
  assert.match(doc, /included with WNBA Pro and PropBetEdge All Access/);
  const shell = read('src/ui/shell.js');
  assert.match(shell, /setMembership/);
  assert.match(shell, /if \(!isMember\(m\)\) return;/, 'free visitors keep the static link (no flicker)');
  assert.match(read('src/main.js'), /api\.account\(\)\.then\(\(res\) => shell\.setMembership\(membershipFrom\(res\)\)\)/);
});

test('/pro: badge from the contract, plan text from the contract, manage link, checkout=success handling', () => {
  const pro = read('src/pages/pro.js');
  assert.match(pro, /membershipBadgeHtml\(m\)/);
  assert.match(pro, /planText\(m\)/);
  assert.match(pro, /manageLinkHtml\(m\)/);
  assert.match(pro, /networkLinksHtml\(SPORT\)/);
  assert.match(pro, /ctx\.query\.checkout === 'success'/);
  assert.match(pro, /WNBA Pro is active/);
  assert.match(pro, /sign in with your checkout email/i);
  assert.match(pro, /m\.state === 'sport_pro' \? raw\(allAccessCardHtml\(m\)\)/, 'All Access upgrade only for sport_pro members');
  assert.doesNotMatch(pro, /Member sign-in opens with WNBA Pro checkout|separate from NBA|Manage or cancel from your Stripe receipt email|Founding Season checkout/);
  assert.match(pro, /Founding Season rate/, 'Founding Season survives only as the rate label');
});

test('copy rules: no Stripe as a state word, no "separate from other sports", no Founding as a state, no browser-side entitlement', () => {
  for (const f of SRC) {
    const t = fs.readFileSync(f, 'utf8');
    const where = path.relative(SRC_DIR, f);
    assert.doesNotMatch(t, /Stripe (subscription )?active|verified against Stripe|Stripe subscription active/i, where);
    assert.doesNotMatch(t, /separate from (NBA|NHL|UFC|other sports)/i, where);
    assert.doesNotMatch(t, /One Pro entitlement/, where);
    assert.doesNotMatch(t, /'Founding Season'\s*\)|FOUNDING SEASON ACTIVE/, where);
    assert.doesNotMatch(t, /localStorage[^\n]*(membership|entitle|all_access)/i, where);
  }
});
