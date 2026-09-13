// Competition registry for PropBetEdge international women's basketball.
//
// Generic by design: a competition is a (competition_type, season) with provider bindings. Coverage is declared,
// never implied — `coverage: 'full'` means a structured provider binding exists and pages are built from data;
// `registry_only` competitions are listed for navigation but their pages stay noindex until data exists.
// Facts here are limited to what is verified (governing body, type, season, and dates/host only where the
// provider publishes them). Qualification relationships are recorded only when confirmed.

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
  }
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

/** The competition a bare alias like /world-cup should resolve to: the most recent edition with coverage. */
export function currentEdition(type, now = Date.now()) {
  const eds = COMPETITIONS.filter((c) => c.competition_type === type && c.coverage === 'full').sort((a, b) => b.season - a.season);
  return eds.find((c) => competitionStatus(c, now) !== 'upcoming') || eds[0] || null;
}
