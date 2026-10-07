// PropBetEdge network registry (shape follows LHBUSA/UFC web/lib/network.ts).
// Family parity: sports/products/network URLs must match the vendored canonical registry
// src/ui/family.json (LHBUSA/propbetedge-workers shared/network/family.json); guarded by
// tests/network-family-parity.test.mjs.

import { PROPBETEDGE_X_URL, PROPBETEDGE_X_HANDLE } from '../seo/site.js';

export const CURRENT_SPORT = 'wnba';

export const NETWORK = Object.freeze({
  news: { label: 'Sports News', href: 'https://propbetedge.ai/' },
  // propbetedge.ai/store is not a live store yet (it serves the news homepage);
  // the one live PropBetEdge checkout is the store on ufc.propbetedge.ai.
  store: { label: 'Store', href: 'https://ufc.propbetedge.ai/store' },
  // Network education layer: first-party, canonical, same-tab.
  learn: { label: 'Learn', href: 'https://learn.propbetedge.ai/' },
  // PropBetEdge's own X account: external, so it opens in a new tab (noopener noreferrer).
  x: { label: PROPBETEDGE_X_HANDLE, href: PROPBETEDGE_X_URL, title: 'Follow PropBetEdge on X' },
  sports: [
    { key: 'mlb', label: 'MLB', name: 'Baseball Intelligence', href: 'https://mlb.propbetedge.ai/' },
    { key: 'nfl', label: 'NFL', name: 'Football Intelligence', href: 'https://nfl.propbetedge.ai/' },
    { key: 'nba', label: 'NBA', name: 'Basketball Intelligence', href: 'https://nba.propbetedge.ai/' },
    { key: 'wnba', label: 'WNBA', name: 'WNBA Intelligence', href: '/' },
    { key: 'nhl', label: 'NHL', name: 'Hockey Intelligence', href: 'https://nhl.propbetedge.ai/' },
    { key: 'ufc', label: 'UFC', name: 'Fight Intelligence', href: 'https://ufc.propbetedge.ai/' },
    { key: 'tennis', label: 'Tennis', name: 'Tennis Intelligence', href: 'https://tennis.propbetedge.ai/' },
    { key: 'soccer', label: 'Soccer', name: 'Soccer Intelligence', href: 'https://soccer.propbetedge.ai/' },
    { key: 'golf', label: 'Golf', name: 'Golf Intelligence', href: 'https://golf.propbetedge.ai/' },
    { key: 'f1', label: 'F1', name: 'F1 Intelligence', href: 'https://f1.propbetedge.ai/' }
  ],
  // Non-sport All Access products. Kept OUT of `sports` so nothing that iterates sports picks them up.
  products: [
    { key: 'members', kind: 'product', label: 'Command Center', href: 'https://members.propbetedge.ai/' },
    { key: 'compare', kind: 'product', label: 'Compare', href: 'https://compare.propbetedge.ai/' },
    { key: 'predictions', kind: 'product', label: 'Predictions', href: 'https://predictions.propbetedge.ai/' }
  ]
});
