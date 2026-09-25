// Scenario builders for the playoff tests.
//
// REAL: espn-postseason-2025.json / espn-postseason-2026.json / espn-standings-league-*.json /
//       espn-calendar-*.json are trimmed provider captures (see each file's _capture block).
// DERIVED: asOf() replays the real 2025 postseason "as it stood" at an earlier instant — later games
//       revert to scheduled with no score, and rounds not yet set revert to ESPN's TBD placeholder shape
//       (team ids -1/-2, exactly as the live 2026 schedule publishes them).
// SYNTHETIC: synthEvent() builds events for fictional teams (ids 99xx, names starting "Fixture") for
//       fault cases the real captures do not contain. None of it is presented as production data.

import fs from 'node:fs';

const dir = new URL('./', import.meta.url);
export const fx = (name) => JSON.parse(fs.readFileSync(new URL(name, dir), 'utf8'));

export const clone = (v) => JSON.parse(JSON.stringify(v));

const PLACEHOLDER = (homeAway, id) => ({ id: String(id), homeAway, team: { id: String(id), abbreviation: 'TBD', displayName: 'TBD', shortDisplayName: 'TBD', location: 'TBD', name: 'TBD' } });

/** The real 2025 postseason as it stood at `cutoffIso`. `setRounds` = headline prefixes whose matchups were set. */
export function asOf(events, cutoffIso, { setRounds = ['First Round'] } = {}) {
  const cut = Date.parse(cutoffIso);
  return clone(events).map((e) => {
    const c = e.competitions[0];
    const played = Date.parse(e.date) <= cut;
    const label = String(c.notes?.[0]?.headline || '');
    const set = setRounds.some((r) => label.toLowerCase().startsWith(r.toLowerCase()));
    if (!played) {
      e.status = { period: 0, displayClock: '0.0', type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false, detail: 'Scheduled', shortDetail: 'Scheduled' } };
      for (const x of c.competitors) { delete x.score; delete x.winner; }
      if (!set) {
        c.competitors = [PLACEHOLDER('home', -1), PLACEHOLDER('away', -2)];
        c.series = { ...c.series, summary: 'Series starts', completed: false, competitors: [{ id: '-1', wins: 0 }, { id: '-2', wins: 0 }] };
      } else {
        // The source's series record as of the cutoff: wins from games already played in the same pair.
        const ids = c.competitors.map((x) => String(x.team.id));
        c.series = { ...c.series, completed: false, summary: null, competitors: ids.map((id) => ({ id, wins: 0 })) };
      }
    }
    return e;
  }).map((e, _, all) => {
    // Recompute the source series wins on scheduled-but-set games from the finals before the cutoff.
    const c = e.competitions[0];
    if (e.status.type.state !== 'pre' || !c.series?.competitors?.every((x) => /^\d+$/.test(x.id))) return e;
    const ids = c.series.competitors.map((x) => x.id);
    const label = c.notes[0].headline.split(' - ')[0];
    const finals = all.filter((o) => o.status.type.name === 'STATUS_FINAL' && o.competitions[0].notes[0].headline.split(' - ')[0] === label && o.competitions[0].competitors.every((x) => ids.includes(String(x.team.id))));
    for (const s of c.series.competitors) s.wins = finals.filter((o) => o.competitions[0].competitors.some((x) => String(x.team.id) === s.id && x.winner)).length;
    return e;
  });
}

let seq = 9900001;
/** A synthetic postseason event for fictional teams. */
export function synthEvent({ id = String(seq++), date = '2031-09-20T23:00Z', note = 'First Round - Game 1', status = 'STATUS_FINAL', home = ['9901', 'FXA', 'Fixture Alpha'], away = ['9902', 'FXB', 'Fixture Bravo'], hs = 80, as = 70, series = null, year = 2031 } = {}) {
  const state = status === 'STATUS_FINAL' ? 'post' : status === 'STATUS_IN_PROGRESS' ? 'in' : 'pre';
  const team = ([tid, abbr, name]) => ({ id: tid, abbreviation: abbr, displayName: name, shortDisplayName: name.split(' ').at(-1), location: 'Fixture', name: name.split(' ').at(-1) });
  return {
    id,
    date,
    name: `${away[2]} at ${home[2]}`,
    season: { year, type: 3 },
    status: { period: state === 'pre' ? 0 : 4, displayClock: '0.0', type: { name: status, state, completed: status === 'STATUS_FINAL', detail: status, shortDetail: status } },
    competitions: [{
      id,
      date,
      timeValid: true,
      notes: [{ type: 'event', headline: note }],
      series: series || { type: 'playoff', title: 'Playoff Series', summary: null, completed: false, totalCompetitions: 3, competitors: [{ id: home[0], wins: 0 }, { id: away[0], wins: 0 }] },
      competitors: [
        { id: home[0], homeAway: 'home', ...(state === 'pre' ? {} : { score: String(hs), winner: state === 'post' ? hs > as : undefined }), team: team(home) },
        { id: away[0], homeAway: 'away', ...(state === 'pre' ? {} : { score: String(as), winner: state === 'post' ? as > hs : undefined }), team: team(away) }
      ]
    }]
  };
}

/** A synthetic league seed table in the standings?level=1 shape. */
export function synthStandings(year, rows) {
  return {
    seasons: [{ year, types: [
      { id: '2', name: 'Regular Season', startDate: `${year}-05-01T07:00Z`, endDate: `${year}-09-15T06:59Z` },
      { id: '3', name: 'Postseason', startDate: `${year}-09-15T07:00Z`, endDate: `${year}-10-31T06:59Z` },
      { id: '4', name: 'Off Season', startDate: `${year}-10-31T07:00Z`, endDate: `${year + 1}-05-01T06:59Z` }
    ] }],
    standings: { season: year, seasonType: 2, entries: rows.map(([id, abbr, name, seed, w, l, code, desc]) => ({ team: { id, abbreviation: abbr, displayName: name }, stats: [
      { name: 'playoffSeed', value: seed, displayValue: String(seed) }, { name: 'wins', value: w }, { name: 'losses', value: l },
      ...(code ? [{ name: 'clincher', displayValue: code, description: desc }] : [])
    ] })) }
  };
}
