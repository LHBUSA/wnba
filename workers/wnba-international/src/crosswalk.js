// Deterministic international ↔ WNBA player identity.
//
// A national-team player links to a PropBetEdge WNBA player only on a strong key:
//   1. exact_name_dob      — normalized full name AND date of birth both equal (confidence: high)
//   2. exact_name_team_unique — no DOB on one side, normalized full name equal, exactly one WNBA player with
//                              that name, and the WNBA player's recorded birthplace country equals the national
//                              team's country (confidence: medium) — never used when either side has a DOB that differs
// Anything else stays unlinked. There is no fuzzy matching, no nickname guessing and no "closest name".

const COMBINING = /[̀-ͯ]/g;

/** "Gabby  Williams-Diallo Jr." → "gabby williams diallo" (accents stripped, punctuation/suffixes dropped). */
export function normalizeName(name) {
  return String(name || '')
    .normalize('NFKD').replace(COMBINING, '')
    .toLowerCase()
    .replace(/[’'`.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** YYYY-MM-DD or null. Accepts ISO timestamps; rejects anything unparseable. */
export function normalizeDob(dob) {
  const m = String(dob || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Country name → ISO-3166 alpha-3 as used by FIBA team codes, for the birthplace fallback only. */
const COUNTRY_ALPHA3 = {
  'united states': 'USA', usa: 'USA', france: 'FRA', belgium: 'BEL', spain: 'ESP', australia: 'AUS', canada: 'CAN', germany: 'GER', japan: 'JPN', china: 'CHN',
  nigeria: 'NGR', serbia: 'SRB', 'czech republic': 'CZE', czechia: 'CZE', italy: 'ITA', turkey: 'TUR', turkiye: 'TUR', 'puerto rico': 'PUR', argentina: 'ARG', brazil: 'BRA',
  mali: 'MLI', senegal: 'SEN', 'south korea': 'KOR', korea: 'KOR', 'new zealand': 'NZL', hungary: 'HUN', slovenia: 'SLO', latvia: 'LAT', sweden: 'SWE', greece: 'GRE',
  'great britain': 'GBR', england: 'GBR', 'united kingdom': 'GBR', cameroon: 'CMR', montenegro: 'MNE', portugal: 'POR', lithuania: 'LTU', philippines: 'PHI', mexico: 'MEX',
  'dominican republic': 'DOM', colombia: 'COL', venezuela: 'VEN', netherlands: 'NED', finland: 'FIN', denmark: 'DEN', poland: 'POL', croatia: 'CRO', ukraine: 'UKR', israel: 'ISR',
  'bosnia and herzegovina': 'BIH', 'ivory coast': 'CIV', "cote d'ivoire": 'CIV', angola: 'ANG', egypt: 'EGY', mozambique: 'MOZ', 'south sudan': 'SSD', uganda: 'UGA', 'chinese taipei': 'TPE', taiwan: 'TPE', lebanon: 'LBN', iran: 'IRI', india: 'IND', russia: 'RUS', austria: 'AUT', switzerland: 'SUI', ireland: 'IRL'
};
export const birthCountryCode = (birthplace) => {
  const parts = String(birthplace || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const last = normalizeName(parts[parts.length - 1]);
  // US births are recorded as "City, ST" (a two-letter state) in the source roster.
  if (/^[a-z]{2}$/.test(last)) return 'USA';
  return COUNTRY_ALPHA3[last] || null;
};

/**
 * Build a lookup over the WNBA roster (wnba-api /v1/players rows).
 * @returns {(player:{name:string,dob?:string|null,team_code?:string|null}) => null | {wnba_player_id, wnba_name, wnba_team, mapping_method, mapping_confidence, mapping_provenance}}
 */
export function wnbaCrosswalk(wnbaPlayers, { capturedAt = null } = {}) {
  const byName = new Map();
  for (const p of wnbaPlayers || []) {
    const key = normalizeName(p.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(p);
  }
  const link = (p, method, confidence, detail) => ({
    wnba_player_id: String(p.athlete_id),
    wnba_name: p.name,
    wnba_team: p.team ? { team_id: String(p.team.team_id), abbr: p.team.abbr, name: p.team.name } : null,
    mapping_method: method,
    mapping_confidence: confidence,
    mapping_provenance: { source: 'wnba-api /v1/players (ESPN athlete ids)', captured_at: capturedAt, ...detail }
  });
  return (intl) => {
    const key = normalizeName(intl?.name);
    const candidates = key ? byName.get(key) || [] : [];
    if (!candidates.length) return null;
    const dob = normalizeDob(intl.dob);
    if (dob) {
      const hit = candidates.filter((p) => normalizeDob(p.dob) === dob);
      return hit.length === 1 ? link(hit[0], 'exact_name_dob', 'high', { name_key: key, dob }) : null;
    }
    // No DOB from the international source: accept only a unique name whose WNBA birthplace country matches.
    if (candidates.length !== 1) return null;
    const [p] = candidates;
    const country = birthCountryCode(p.birthplace);
    if (!intl.team_code || !country || country !== String(intl.team_code).toUpperCase()) return null;
    return link(p, 'exact_name_team_unique', 'medium', { name_key: key, birth_country: country, national_team: intl.team_code });
  };
}

/**
 * Attach `wnba` links to international players. Strongest key first: the same ESPN athlete id in the WNBA
 * roster with an identical normalized name (provider ids are global across ESPN leagues); otherwise the
 * name+DOB / unique-name rules above. Returns the number linked.
 */
export function linkInternationalPlayers(intlPlayers, wnbaRoster, { capturedAt = null } = {}) {
  const link = wnbaCrosswalk(wnbaRoster || [], { capturedAt });
  const byId = new Map((wnbaRoster || []).map((p) => [String(p.athlete_id), p]));
  const photoOf = (p) => (p?.photo ? { square: p.photo.square, portrait: p.photo.portrait, attribution: p.photo.attribution } : null);
  let linked = 0;
  for (const p of intlPlayers) {
    const same = byId.get(String(p.provider_ids?.espn || ''));
    if (same && normalizeName(same.name) === normalizeName(p.name)) {
      p.wnba = { wnba_player_id: String(same.athlete_id), wnba_name: same.name, wnba_team: same.team ? { team_id: String(same.team.team_id), abbr: same.team.abbr, name: same.team.name } : null, photo: photoOf(same), mapping_method: 'provider_athlete_id', mapping_confidence: 'high', mapping_provenance: { source: 'ESPN athlete id shared by wnba-api /v1/players and the ESPN FIBA box score', espn_athlete_id: String(p.provider_ids.espn), captured_at: capturedAt } };
    } else {
      const hit = link({ name: p.name, dob: p.dob || null, team_code: p.team?.country_code });
      if (hit) p.wnba = { ...hit, photo: photoOf(byId.get(hit.wnba_player_id)) };
    }
    if (p.wnba) linked += 1;
  }
  return linked;
}
