export const INTELLIGENCE_FEATURES = Object.freeze([
  {
    id: 'daily-brief',
    routeId: 'daily-brief',
    name: 'WNBA Daily Brief',
    tier: 'free',
    href: '/brief',
    badge: 'FREE',
    eyebrow: 'Free intelligence',
    short: 'The daily slate, PBE coverage window, availability changes and the live public track record in one fast read.',
    pitch: 'The free front door to PropBetEdge WNBA. Useful on its own, with clear paths into the deeper Pro research layers.'
  },
  {
    id: 'edge-timeline',
    routeId: 'edge-timeline',
    name: 'PBE Edge Timeline',
    tier: 'pro',
    href: '/edge-timeline',
    badge: 'PRO',
    eyebrow: 'Model movement',
    short: 'See how the model probability, market benchmark, call and confidence changed from first read to lock.',
    pitch: 'Turns every PBE call into a living research file instead of a flat prediction.'
  },
  {
    id: 'rotation-impact',
    routeId: 'rotation-impact',
    name: 'Rotation Impact',
    tier: 'pro',
    href: '/rotation-impact',
    badge: 'PRO',
    eyebrow: 'Opportunity pressure',
    short: 'Player Load, availability and recent baseline minutes combined into a team-by-team rotation pressure desk.',
    pitch: 'Shows where minutes pressure is concentrated and which active players carry the biggest recent workload baseline.'
  },
  {
    id: 'scenario-lab',
    routeId: 'scenario-lab',
    name: 'PBE Scenario Lab',
    tier: 'pro',
    href: '/scenario-lab',
    badge: 'PRO',
    eyebrow: 'Game paths',
    short: 'Base case, supporting drivers, counter-drivers and the market disagreement for every current PBE call.',
    pitch: 'A transparent evidence-path view. No invented Monte Carlo outputs and no fake certainty.'
  },
  {
    id: 'watchlist',
    routeId: 'watchlist',
    name: 'Watchlist & Live Alerts',
    tier: 'pro',
    href: '/watchlist',
    badge: 'PRO',
    eyebrow: 'Monitor what matters',
    short: 'Save WNBA teams and surface current PBE, Player Load and availability signals in one live alert board.',
    pitch: 'Turns WNBA Pro from a site you check into a desk that keeps your teams organized for you.'
  }
]);

export const FREE_INTELLIGENCE = INTELLIGENCE_FEATURES.filter((f) => f.tier === 'free');
export const PRO_INTELLIGENCE = INTELLIGENCE_FEATURES.filter((f) => f.tier === 'pro');

export function intelligenceFeature(id) {
  return INTELLIGENCE_FEATURES.find((f) => f.id === id || f.routeId === id) || null;
}
