// PropBetEdge "All Access first" commercial hierarchy on the WNBA app.
//
// FREE: every purchase surface renders the All Access hero FIRST (exact Stripe Payment Link, $29/month, THEEDGE25),
// then the "ONLY WANT WNBA?" seam, then the untouched WNBA Pro plans ($9.99 monthly / $3.99 weekly).
// WNBA PRO ACTIVE: the UPGRADE TO ALL ACCESS hero, no WNBA purchase. ALL ACCESS ACTIVE / OWNER: nothing for sale.
// Chrome: first-class ALL ACCESS header link + drawer first row + footer links, behind a bumped SHELL_REV so the
// publishing Worker's server-rendered shell is reconciled by the new client.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { allAccessHeroHtml, allAccessDividerHtml, allAccessMiniHtml, showsAllAccess, ALL_ACCESS_SPORTS, ALL_ACCESS_NEXT, ALL_ACCESS_BADGE, WNBA_ONLY_LABEL } from '../src/ui/all-access.js';
import { ALL_ACCESS_OFFER, ALL_ACCESS_URL, deriveMembership } from '../src/lib/pbe-membership.js';
import { PLANS, DEFAULT_PLAN, checkoutReady } from '../src/data/pricing.js';
import { shellHtml, SHELL_REV } from '../src/ui/shell.js';
import { proFeaturePublicView } from '../src/views/pro-intelligence.js';
import { pbePicksPublicView } from '../src/views/pbe-picks-public.js';
import { pbeTeaser } from '../src/ui/pbe.js';
import { propEdgeSection } from '../src/ui/prop-edge.js';
import { PRO_INTELLIGENCE } from '../src/data/pro-features.js';

const STRIPE_ALL_ACCESS = 'https://buy.stripe.com/8x2eVdgmOaqy4pv8Ez7wA0N';
const LEARN = 'https://propbetedge.ai/pro';
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const m = (state) => deriveMembership({ sport: 'wnba', entitled: state !== 'free', accessSource: state === 'sport_pro' ? 'sport' : state === 'free' ? null : state, plan: state === 'free' ? null : 'monthly', email: state === 'free' ? null : `${state}@example.com` });
const HERO = 'data-wnba-all-access="hero"';
const before = (s, a, b) => { const i = s.indexOf(a); const j = s.indexOf(b); return i >= 0 && j >= 0 && i < j; };

test('the hero carries the approved offer exactly: title, price, sports line, promo, badge, exact Stripe link, learn link', () => {
  const hero = String(allAccessHeroHtml(m('free')));
  assert.match(hero, /<aside class="wnba-aa-hero is-panel" data-wnba-all-access="hero" data-wnba-all-access-state="free" aria-label="PropBetEdge All Access">/);
  assert.match(hero, />PROPBETEDGE NETWORK</);
  assert.match(hero, /<h3 class="wnba-aa-title">ALL ACCESS<\/h3>/);
  assert.match(hero, /<span class="wnba-aa-price" aria-label="\$29\/month"><strong>\$29<\/strong>\/month<\/span>/);
  assert.equal(ALL_ACCESS_OFFER.price, '$29/month');
  assert.match(hero, />Every current and future PropBetEdge Pro sport\.</);
  assert.match(hero, /<b>MLB · NFL · NBA · NHL · WNBA · UFC · Tennis<\/b> <span>plus every Pro sport added next\.<\/span>/);
  assert.equal(ALL_ACCESS_SPORTS, 'MLB · NFL · NBA · NHL · WNBA · UFC · Tennis');
  assert.equal(ALL_ACCESS_NEXT, 'plus every Pro sport added next.');
  assert.match(hero, /Launch offer: 25% off while active with code <b class="wnba-aa-code">THEEDGE25<\/b>/);
  assert.equal(ALL_ACCESS_OFFER.promoCode, 'THEEDGE25');
  assert.match(hero, />BEST VALUE · MOST COMPLETE</);
  assert.equal(ALL_ACCESS_BADGE, 'BEST VALUE · MOST COMPLETE');
  assert.match(hero, new RegExp(`<a class="wnba-aa-cta" href="${STRIPE_ALL_ACCESS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" rel="noopener" data-pbe-placement="all_access_checkout" data-wnba-all-access-cta="checkout">GET ALL ACCESS</a>`));
  assert.equal(ALL_ACCESS_OFFER.checkoutUrl, STRIPE_ALL_ACCESS);
  assert.match(hero, /<a class="wnba-aa-learn" href="https:\/\/propbetedge\.ai\/pro" rel="noopener" data-wnba-all-access-cta="learn">WHAT'S INCLUDED<\/a>/);
  assert.equal(ALL_ACCESS_URL, LEARN);
  assert.doesNotMatch(hero, /Labs|computational/i, 'no Labs / future computational products');
  const links = [...hero.matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(links, [STRIPE_ALL_ACCESS, LEARN], 'exactly two links: the Stripe checkout and the network page');
  assert.equal(String(allAccessDividerHtml()), `<div class="wnba-aa-divider" role="separator" aria-label="ONLY WANT WNBA?" data-wnba-all-access="divider"><span>ONLY WANT WNBA?</span></div>`);
  assert.equal(WNBA_ONLY_LABEL, 'ONLY WANT WNBA?');
});

test('state rules: free -> hero, sport_pro -> UPGRADE TO ALL ACCESS, all_access / owner -> nothing for sale', () => {
  assert.equal(showsAllAccess(m('free')), true);
  assert.equal(showsAllAccess(null), true, 'no verdict yet renders as FREE');
  assert.equal(showsAllAccess(m('sport_pro')), true);
  assert.equal(showsAllAccess(m('all_access')), false);
  assert.equal(showsAllAccess(m('owner')), false);
  const upgrade = String(allAccessHeroHtml(m('sport_pro')));
  assert.match(upgrade, /class="wnba-aa-hero is-panel is-upgrade" data-wnba-all-access="hero" data-wnba-all-access-state="sport_pro"/);
  assert.match(upgrade, /<h3 class="wnba-aa-title">UPGRADE TO ALL ACCESS<\/h3>/);
  assert.match(upgrade, new RegExp(STRIPE_ALL_ACCESS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const state of ['all_access', 'owner']) {
    assert.equal(allAccessHeroHtml(m(state)), '', `${state}: no hero`);
    assert.equal(allAccessMiniHtml(m(state)), '', `${state}: no mini strip`);
  }
  assert.match(String(allAccessHeroHtml(m('free'), { variant: 'compact' })), /class="wnba-aa-hero is-compact"/);
});

test('WNBA Pro plans are unchanged beneath the seam: $9.99 monthly / $3.99 weekly, live ids and links, checkout gating; no WNBA plan claims Best value', () => {
  assert.equal(PLANS.monthly.price, '$9.99');
  assert.equal(PLANS.monthly.per, 'month');
  assert.equal(PLANS.monthly.stripePriceId, 'price_1UEfAmF3CaVzg4OReyWRioNO');
  assert.equal(PLANS.monthly.paymentLinkId, 'plink_1UEfBOF3CaVzg4ORuxdQriRX');
  assert.equal(PLANS.monthly.url, 'https://buy.stripe.com/7sY28rb2u6ai3lr5sn7wA0E');
  assert.equal(PLANS.weekly.price, '$3.99');
  assert.equal(PLANS.weekly.per, 'week');
  assert.equal(PLANS.weekly.stripePriceId, 'price_1UEfAsF3CaVzg4OR7082zM5i');
  assert.equal(PLANS.weekly.paymentLinkId, 'plink_1UEfBTF3CaVzg4ORy1GQeoI5');
  assert.equal(PLANS.weekly.url, 'https://buy.stripe.com/5kQeVd1rUeGO3lr3kf7wA0F');
  assert.equal(DEFAULT_PLAN, 'monthly');
  assert.equal(checkoutReady(PLANS.monthly, { purchase_activation: 'active' }), true);
  assert.equal(checkoutReady(PLANS.monthly, { purchase_activation: 'inactive' }), false);
  for (const p of Object.values(PLANS)) assert.doesNotMatch(String(p.tag), /best value/i, `${p.id}: All Access owns "Best value"`);
  assert.equal(PLANS.monthly.tag, 'Popular');
  const pro = read('src/pages/pro.js');
  assert.doesNotMatch(pro, /Best value/i);
});

test('/pro purchase panel order: hero -> ONLY WANT WNBA? -> plan picker -> WNBA checkout; sport_pro gets the upgrade hero and no WNBA purchase', () => {
  const pro = read('src/pages/pro.js');
  const panel = pro.slice(pro.indexOf('const freePanel = () =>'), pro.indexOf('const successBanner'));
  const iHero = panel.indexOf('allAccessHeroHtml(m)');
  const iSeam = panel.indexOf('allAccessDividerHtml()');
  const iPicker = panel.indexOf('planPicker()');
  const iCheckout = panel.indexOf('checkout()');
  assert.ok(iHero >= 0 && iSeam > iHero && iPicker > iSeam && iCheckout > iPicker, { iHero, iSeam, iPicker, iCheckout });
  assert.doesNotMatch(panel, /Best value/i);
  const member = pro.slice(pro.indexOf('const memberPanel = () =>'), pro.indexOf('const freePanel'));
  assert.match(member, /m\.state === 'sport_pro' \? raw\(allAccessHeroHtml\(m\)\) : ''/);
  assert.doesNotMatch(member, /planPicker|checkout\(\)|Unlock WNBA Pro/, 'members never see a WNBA purchase');
  assert.match(pro, /\['free', 'pro', 'all_access', 'owner'\]\.includes\(ctx\.query\.preview\)/, 'dev preview states survive for QA');
  assert.match(pro, /import\.meta\.env\.DEV/);
  assert.match(pro, /ALL_ACCESS_URL/, 'all_access / owner keep the network link (no purchase CTA)');
});

test('secondary surfaces: the compact hero and the seam precede the WNBA CTA everywhere', () => {
  const pi = String(proFeaturePublicView(PRO_INTELLIGENCE[0]));
  assert.ok(before(pi, HERO, 'ONLY WANT WNBA?') && before(pi, 'ONLY WANT WNBA?', 'Unlock WNBA Pro'), 'pro-intelligence public view');
  assert.match(pi, /wnba-aa-hero is-compact/);
  const teaser = String(pbeTeaser({ team: { team_id: '20' }, opponent: { team_id: '18' }, isHome: true, tipUtc: '2026-09-25T23:00:00Z' }));
  assert.ok(before(teaser, HERO, 'ONLY WANT WNBA?') && before(teaser, 'ONLY WANT WNBA?', 'Unlock WNBA Pro'), 'team teaser');
  const prop = String(propEdgeSection({ account: { ok: true, data: { state: 'signed_out', membership: m('free') } }, edge: null }));
  assert.ok(before(prop, HERO, 'ONLY WANT WNBA?') && before(prop, 'ONLY WANT WNBA?', 'Unlock PBE Prop Edge'), 'Prop Edge teaser');
  const pub = String(pbePicksPublicView());
  assert.ok(before(pub, 'data-wnba-all-access="mini"', 'Unlock WNBA Pro'), 'public PBE Picks flagship: the umbrella strip precedes the WNBA CTA');
  assert.match(pub, /\$9\.99/);
  const picks = read('src/pages/pbe-picks.js');
  const win = picks.slice(picks.indexOf('function teaserView'), picks.indexOf('</section>`;', picks.indexOf('function teaserView')));
  assert.ok(before(win, "allAccessHeroHtml(m, { variant: 'compact' })", 'allAccessDividerHtml()') && before(win, 'allAccessDividerHtml()', 'pbe-public-actions'), '/pbe-picks window: hero -> seam -> WNBA CTA');
  const track = read('src/pages/track-record.js');
  assert.ok(before(track, "allAccessHeroHtml(membershipFrom(acct), { variant: 'compact' })", 'allAccessDividerHtml()') && before(track, 'allAccessDividerHtml()', 'Unlock WNBA Pro'), '/track-record ledger teaser');
  for (const f of ['src/pages/pro.js', 'src/pages/pbe-picks.js', 'src/pages/track-record.js', 'src/ui/pbe.js', 'src/ui/prop-edge.js', 'src/views/pro-intelligence.js']) {
    assert.doesNotMatch(read(f), /allAccessCardHtml/, `${f}: the WNBA hero replaces the shared card`);
  }
});

test('chrome: gold ALL ACCESS header link beside WNBA Pro, drawer first row, footer ALL ACCESS + WHAT\'S INCLUDED, SHELL_REV bumped', () => {
  const doc = String(shellHtml());
  const header = doc.slice(doc.indexOf('<header class="hdr"'), doc.indexOf('</header>'));
  assert.match(header, /<div class="hdr-actions">\s*<a class="btn-aa" href="https:\/\/propbetedge\.ai\/pro" data-nav="all-access" data-all-access-sell rel="noopener" aria-label="[^"]*\$29\/month">ALL ACCESS<\/a>\s*<a class="btn-pro" href="\/pro" data-nav="pro">WNBA Pro<\/a>/);
  assert.ok(!header.slice(header.indexOf('id="nav-more-menu"'), header.indexOf('</nav>')).includes('propbetedge.ai/pro'), 'not inside More');
  const drawer = doc.slice(doc.indexOf('class="drawer-panel"'), doc.indexOf('<main'));
  assert.ok(before(drawer, '<a class="drawer-aa" href="https://propbetedge.ai/pro"', '<a href="/" data-nav="today">'), 'drawer first row');
  assert.match(drawer, /class="drawer-aa"[^>]*>ALL ACCESS <small>\$29\/month · every Pro sport<\/small><\/a>/);
  const footer = doc.slice(doc.indexOf('<footer'), doc.indexOf('</footer>'));
  assert.match(footer, /<a class="foot-aa-link" href="https:\/\/propbetedge\.ai\/pro" rel="noopener" data-all-access-sell data-pbe-footer-all-access>ALL ACCESS <b>\$29\/month<\/b><\/a>/);
  assert.match(footer, /<a class="foot-aa-included" href="https:\/\/propbetedge\.ai\/pro" rel="noopener" data-pbe-footer-all-access-included>WHAT'S INCLUDED →<\/a>/);
  assert.match(footer, /<li><a class="foot-net-aa" href="https:\/\/propbetedge\.ai\/pro" rel="noopener" data-all-access-sell>All Access · \$29\/month<\/a><\/li>/);
  assert.doesNotMatch(doc, /buy\.stripe\.com/, 'the shell never carries a Stripe link (the hero does, per state)');
  assert.notEqual(SHELL_REV, '2026-09-24.1', 'SHELL_REV must move so the publishing Worker\'s SSR shell is reconciled');
  assert.ok(SHELL_REV >= '2026-09-24.2', 'at or after the All Access chrome revision'); // later chrome changes move it forward
  assert.match(doc, new RegExp(`data-shell-rev="${SHELL_REV}"`));
  const shell = read('src/ui/shell.js');
  assert.match(shell, /if \(m\.state === 'all_access' \|\| m\.state === 'owner'\) root\.querySelectorAll\('\[data-all-access-sell\]'\)\.forEach\(\(a\) => a\.classList\.add\('aa-sold'\)\);/, 'umbrella members are never sold the umbrella');
  const css = read('src/styles/all-access.css');
  assert.match(css, /\.aa-sold \{ display: none !important; \}/);
  assert.match(css, /@media \(max-width: 980px\) \{ \.hdr-actions \.btn-aa \{ display: none; \} \}/, 'phones use the drawer row');
  assert.match(css, /\.drawer-panel a\.drawer-aa \{[^}]*min-height: 48px/, '44px+ tap target');
  assert.match(read('src/main.js'), /import '\.\/styles\/all-access\.css';/);
});

test('phone header fit: brand gives way, short member badge <=480px, mark-only <=360px (no horizontal overflow in any state)', () => {
  const shell = read('src/ui/shell.js');
  assert.match(shell, /const SHORT_LABEL = \(m\) => m\.state === 'owner' \? 'OWNER' : m\.state === 'all_access' \? 'ALL ACCESS'/);
  assert.match(shell, /\$\{membershipBadgeHtml\(m\)\}<span class="pbe-mbr-badge is-\$\{m\.state\} pbe-mbr-badge-short" aria-hidden="true">\$\{SHORT_LABEL\(m\)\}<\/span>/, 'full contract badge kept, short badge beside it');
  const comp = read('src/styles/components.css');
  assert.match(comp, /@media \(max-width: 980px\) \{\s*\.brand \{ flex: 0 1 auto; min-width: 0; \}/);
  assert.match(comp, /\.brand-txt b \{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/);
  assert.match(comp, /@media \(max-width: 360px\) \{\s*\.brand-txt \{ display: none; \}/);
  const pbe = read('src/styles/pbe.css');
  assert.match(pbe, /@media \(max-width: 480px\) \{\s*\.hdr-actions \.btn-pro\.is-member \.pbe-mbr-badge:not\(\.pbe-mbr-badge-short\) \{ display: none; \}\s*\.hdr-actions \.btn-pro\.is-member \.pbe-mbr-badge-short \{ display: inline-flex; \}/);
});

test('the shared contract copies are untouched (server and client byte-identical, card still exported)', () => {
  assert.equal(read('src/lib/pbe-membership.js'), read('workers/wnba-api/src/pbe-membership.js'));
  assert.match(read('src/lib/pbe-membership.js'), /export function allAccessCardHtml/);
  assert.match(read('src/ui/all-access.js'), /import \{ ALL_ACCESS_OFFER \} from '\.\.\/lib\/pbe-membership\.js';/, 'the hero reads the shared offer');
  assert.doesNotMatch(read('src/ui/all-access.js'), /buy\.stripe\.com|\$29|THEEDGE25/, 'no second copy of the commercial facts');
});
