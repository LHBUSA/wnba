// Kalshi PERPETUALS partner offer (contract kalshi-partner/2) — ONE footer module per page.
// A commercial partner block in the network footer only: never in picks, game, prop, WNBACast
// or Kalshi market components, and never a model input. Copy, economics and the link all come
// from the vendored canonical client; config is read through the same-origin rewrite
// /go/kalshi-perps/config (vercel.json). Disabled / failed config renders nothing (fail closed).
// The slot is created client-side inside footer.foot (after the shell's chrome reconcile), so the
// publishing Worker's SSR shell is unchanged. Lives outside src/ui|views|lib|seo, which the Worker imports.
import { loadPartnerConfig, partnerOffer } from '../vendor/kalshi/kalshi-partner.js';
import '../styles/kalshi-partner.css';

export const PARTNER_CONFIG_URL = '/go/kalshi-perps/config';
export const PARTNER_CTX = Object.freeze({ placement: 'sport_footer', product: 'wnba', sport: 'wnba' });

function footerSlot(doc) {
  const existing = doc.querySelector('#wnba-kxo');
  if (existing) return existing;
  const footIn = doc.querySelector('footer.foot .foot-in');
  if (!footIn) return null;
  const slot = doc.createElement('div');
  slot.id = 'wnba-kxo';
  slot.className = 'foot-partner';
  slot.setAttribute('aria-label', 'Partner offer');
  slot.hidden = true;
  footIn.insertBefore(slot, footIn.querySelector('.foot-note'));
  return slot;
}

export function mountKalshiPartnerFooter(doc = document) {
  const slot = footerSlot(doc);
  if (!slot || slot.dataset.kxoMounted) return Promise.resolve(false);
  slot.dataset.kxoMounted = '1';
  return loadPartnerConfig(PARTNER_CONFIG_URL)
    .then((cfg) => {
      if (doc.querySelector('.kxo')) return false; // exactly one offer per page
      const html = partnerOffer(cfg, PARTNER_CTX, { variant: 'footer' });
      if (!html) return false;
      slot.innerHTML = html;
      slot.hidden = false;
      return true;
    })
    .catch(() => false);
}
