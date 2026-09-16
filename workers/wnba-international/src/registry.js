// Competition registry for PropBetEdge international women's basketball.
//
// Generic by design: a competition is a (competition_type, season) with provider bindings. Coverage is declared,
// never implied — `coverage: 'full'` means a structured provider binding exists and pages are built from data;
// `coverage: 'historical'` means a verified, cited historical summary exists but there is no live/provider feed;
// `registry_only` competitions are listed for navigation but their pages stay noindex until data exists.
// Facts here are limited to what is verified. Qualification relationships are recorded only when confirmed.

export const COMPETITION_TYPES = Object.freeze({
  world_cup: 'FIBA Women’s Basketball World Cup',
  olympics: 'Women’s Olympic Basketball Tournament',
  olympic_pre_qualifying: 'FIBA Women’s Olympic Pre-Qualifying Tournament',
  olympic_qualifying: 'FIBA Women’s Olympic Qualifying Tournament',
  americup: 'FIBA Women’s AmeriCup',
  eurobasket: 'FIBA Women’s EuroBasket',
  asia_cup: 'FIBA Women’s Asia Cup',
  afrobasket: 'FIBA Women’s AfroBasket'
});

export const COMPETITIONS = Object.freeze([
  {
    competition_id: 'fiba-womens-world-cup-2026',
    slug: 'world-cup-2026',
    alias_slugs: ['world-cup'],
    name: 'FIBA Women’s Basketball World Cup 2026',
    short_name: 'World Cup 2026',
    competition_type: 'world_cup',
    governing_body: 'FIBA',
    region: 'World',
    season: 2026,
    host: { city: 'Berlin', country: 'Germany', country_code: 'GER' },
    start_date: '2026-09-04',
    end_date: '2026-09-13',
    coverage: 'full',
    provider_ids: { espn: { sport: 'basketball', league: 'fiba', league_id: '53', dates: '20260904-20260914', note_prefix: 'FIBA Women' } },
    qualification_relationships: []
  },
  // Registry-only future edition: navigation exists, but no data is claimed yet.
  { competition_id: 'womens-olympic-basketball-2028', slug: 'olympics-2028', alias_slugs: [], name: 'Women’s Olympic Basketball Tournament — Los Angeles 2028', short_name: 'Olympics 2028', competition_type: 'olympics', governing_body: 'IOC / FIBA', region: 'World', season: 2028, host: { city: 'Los Angeles', country: 'United States', country_code: 'USA' }, start_date: null, end_date: null, coverage: 'registry_only', provider_ids: {}, qualification_relationships: [] },

  // Verified historical editions. Facts are rendered from src/views/international-history.js;
  // no provider id is attached and none of these entries is treated as a live/full feed.
  { competition_id: 'womens-olympic-basketball-2024', slug: 'olympics-2024', alias_slugs: [], name: 'Women’s Olympic Basketball Tournament — Paris 2024', short_name: 'Olympics 2024', competition_type: 'olympics', governing_body: 'IOC / FIBA', region: 'World', season: 2024, host: { city: 'Paris', country: 'France', country_code: 'FRA' }, start_date: '2024-07-28', end_date: '2024-08-11', coverage: 'historical', provider_ids: {}, qualification_relationships: [] },
  { competition_id: 'fiba-womens-eurobasket-2025', slug: 'eurobasket-2025', alias_slugs: [], name: 'FIBA Women’s EuroBasket 2025', short_name: 'EuroBasket 2025', competition_type: 'eurobasket', governing_body: 'FIBA Europe', region: 'Europe', season: 2025, host: { city: 'Brno / Hamburg / Bologna / Piraeus', country: 'Czechia / Germany / Italy / Greece', country_code: null }, start_date: '2025-06-18', end_date: '2025-06-29', coverage: 'historical', provider_ids: {}, qualification_relationships: [] },
  { competition_id: 'fiba-womens-americup-2025', slug: 'americup-2025', alias_slugs: [], name: 'FIBA Women’s AmeriCup 2025', short_name: 'AmeriCup 2025', competition_type: 'americup', governing_body: 'FIBA Americas', region: 'Americas', season: 2025, host: { city: 'Santiago', country: 'Chile', country_code: 'CHI' }, start_date: '2025-06-28', end_date: '2025-07-06', coverage: 'historical', provider_ids: {}, qualification_relationships: [] },
  { competition_id: 'fiba-womens-asia-cup-2025', slug: 'asia-cup-2025', alias_slugs: [], name: 'FIBA Women’s Asia Cup 2025', short_name: 'Asia Cup 2025', competition_type: 'asia_cup', governing_body: 'FIBA Asia', region: 'Asia and Oceania', season: 2025, host: { city: 'Shenzhen', country: 'China', country_code: 'CHN' }, start_date: '2025-07-13', end_date: '2025-07-20', coverage: 'historical', provider_ids: {}, qualification_relationships: [] },
  { competition_id: 'fiba-womens-afrobasket-2025', slug: 'afrobasket-2025', alias_slugs: [], name: 'FIBA Women’s AfroBasket 2025', short_name: 'AfroBasket 2025', competition_type: 'afrobasket', governing_body: 'FIBA Africa', region: 'Africa', season: 2025, host: { city: 'Abidjan', country: 'Côte d’Ivoire', country_code: 'CIV' }, start_date: '2025-07-26', end_date: '2025-08-03', coverage: 'historical', provider_ids: {}, qualification_relationships: [] }
]);

export const competitionById = (id) => COMPETITIONS.find((c) => c.competition_id === id || c.slug === id || (c.alias_slugs || []).includes(id)) || null;

/** active | upcoming | recent (ended within 30 days) | historical — from dates, at a given instant. */
export function competitionStatus(c, now = Date.now()) {
  if (!c.start_date) return c.season > new Date(now).getUTCFullYear() ? 'upcoming' : 'historical';
  const start = Date.parse(`${c.start_date}T00:00:00Z`);
  // End of the host-local final day, conservatively +1 day in UTC.
  const end = Date.parse(`${c.end_date}T23:59:59Z`) + 12 * 3600e3;
  if (now < start) return 'upcoming';
  if (now <= end) return 'active';
  return now - end <= 30 * 86400e3 ? 'recent' : 'historical';
}

/** The competition a bare alias like /world-cup should resolve to: the most recent edition with live/full coverage. */
export function currentEdition(type, now = Date.now()) {
  const eds = COMPETITIONS.filter((c) => c.competition_type === type && c.coverage === 'full').sort((a, b) => b.season - a.season);
  return eds.find((c) => competitionStatus(c, now) !== 'upcoming') || eds[0] || null;
}
