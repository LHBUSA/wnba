// Curated historical summaries for international women's basketball.
//
// These are factual tournament records transcribed from the cited official FIBA
// event pages. They are deliberately NOT presented as a live/provider feed and
// do not imply complete game-by-game or box-score coverage. The live
// wnba-international Worker remains separate.
//
// Reviewed: 2026-09-15.
import { html } from '../lib/dom.js';
import { pageHead } from '../ui/components.js';

const source = (url) => Object.freeze({
  name: 'FIBA',
  url,
  retrieved_at: '2026-09-15',
  scope: 'manually curated tournament facts'
});

const leader = (label, name, team, value) => Object.freeze({ label, name, team, value });
const game = (label, winner, loser, winner_score, loser_score, note = null) => Object.freeze({ label, winner, loser, winner_score, loser_score, note });

export const INTERNATIONAL_HISTORY = Object.freeze({
  'womens-olympic-basketball-2024': Object.freeze({
    competition_id: 'womens-olympic-basketball-2024',
    dates: { start: '2024-07-28', end: '2024-08-11', label: 'Jul 28 – Aug 11, 2024' },
    host: { city: 'Paris', country: 'France' },
    teams: 12,
    games: 26,
    champion: 'United States',
    runner_up: 'France',
    third: 'Australia',
    fourth: 'Belgium',
    mvp: { name: "A'ja Wilson", team: 'United States' },
    medal_games: [
      game('Gold medal game', 'United States', 'France', 67, 66),
      game('Bronze medal game', 'Australia', 'Belgium', 85, 81)
    ],
    final_standings: ['United States', 'France', 'Australia', 'Belgium', 'Spain', 'Serbia', 'Germany', 'Nigeria', 'China', 'Puerto Rico', 'Canada', 'Japan'],
    leaders: [
      leader('Points', 'Emma Meesseman', 'Belgium', '23.3 PPG'),
      leader('Rebounds', 'Li Yueru', 'China', '11.0 RPG'),
      leader('Assists', 'Julie Vanloo', 'Belgium', '6.8 APG'),
      leader('Blocks', "A'ja Wilson", 'United States', '2.7 BPG')
    ],
    source: source('https://www.fiba.basketball/en/events/womens-olympic-basketball-tournament-paris-2024')
  }),

  'fiba-womens-eurobasket-2025': Object.freeze({
    competition_id: 'fiba-womens-eurobasket-2025',
    dates: { start: '2025-06-18', end: '2025-06-29', label: 'Jun 18 – Jun 29, 2025' },
    host: { city: 'Brno · Hamburg · Bologna · Piraeus', country: 'Czechia · Germany · Italy · Greece' },
    teams: 16,
    games: 36,
    champion: 'Belgium',
    runner_up: 'Spain',
    third: 'Italy',
    fourth: 'France',
    mvp: { name: 'Emma Meesseman', team: 'Belgium' },
    medal_games: [
      game('Final', 'Belgium', 'Spain', 67, 65),
      game('Third place game', 'Italy', 'France', 69, 54)
    ],
    final_standings: ['Belgium', 'Spain', 'Italy', 'France', 'Germany', 'Czechia', 'Türkiye', 'Lithuania', 'Slovenia', 'Sweden', 'Greece', 'Portugal', 'Serbia', 'Great Britain', 'Montenegro', 'Switzerland'],
    leaders: [
      leader('Points', 'Jessica Shepard', 'Slovenia', '22.7 PPG'),
      leader('Rebounds', 'Jessica Shepard', 'Slovenia', '11.3 RPG'),
      leader('Assists', 'Klara Lundquist', 'Sweden', '7.3 APG'),
      leader('Efficiency', 'Jessica Shepard', 'Slovenia', '30.3 EFF')
    ],
    source: source('https://www.fiba.basketball/en/events/fiba-womens-eurobasket-2025')
  }),

  'fiba-womens-americup-2025': Object.freeze({
    competition_id: 'fiba-womens-americup-2025',
    dates: { start: '2025-06-28', end: '2025-07-06', label: 'Jun 28 – Jul 6, 2025' },
    host: { city: 'Santiago', country: 'Chile' },
    teams: 10,
    games: 32,
    champion: 'United States',
    runner_up: 'Brazil',
    third: 'Canada',
    fourth: 'Argentina',
    mvp: { name: 'Mikayla Blakes', team: 'United States' },
    medal_games: [
      game('Final', 'United States', 'Brazil', 92, 84),
      game('Third place game', 'Canada', 'Argentina', 76, 75)
    ],
    final_standings: ['United States', 'Brazil', 'Canada', 'Argentina', 'Colombia', 'Puerto Rico', 'Mexico', 'Dominican Republic', 'Chile', 'El Salvador'],
    leaders: [
      leader('Points', 'Damiris Dantas', 'Brazil', '21.4 PPG')
    ],
    source: source('https://www.fiba.basketball/en/events/fiba-womens-americup-2025')
  }),

  'fiba-womens-asia-cup-2025': Object.freeze({
    competition_id: 'fiba-womens-asia-cup-2025',
    dates: { start: '2025-07-13', end: '2025-07-20', label: 'Jul 13 – Jul 20, 2025' },
    host: { city: 'Shenzhen', country: 'China' },
    teams: 8,
    games: 20,
    champion: 'Australia',
    runner_up: 'Japan',
    third: 'China',
    fourth: 'South Korea',
    mvp: { name: 'Alexandra Fowler', team: 'Australia' },
    scope_note: 'Championship history on this page is Division A, the top tier of the 2025 FIBA Women’s Asia Cup.',
    medal_games: [
      game('Final', 'Australia', 'Japan', 88, 79),
      game('Third place game', 'China', 'South Korea', 101, 66)
    ],
    final_standings: ['Australia', 'Japan', 'China', 'South Korea', 'New Zealand', 'Philippines', 'Lebanon', 'Indonesia'],
    leaders: [
      leader('Points', 'Rebecca Akl', 'Lebanon', '16.5 PPG')
    ],
    source: source('https://www.fiba.basketball/en/events/fiba-womens-asiacup-2025')
  }),

  'fiba-womens-afrobasket-2025': Object.freeze({
    competition_id: 'fiba-womens-afrobasket-2025',
    dates: { start: '2025-07-26', end: '2025-08-03', label: 'Jul 26 – Aug 3, 2025' },
    host: { city: 'Abidjan', country: "Côte d'Ivoire" },
    teams: 12,
    games: 28,
    champion: 'Nigeria',
    runner_up: 'Mali',
    third: 'South Sudan',
    fourth: 'Senegal',
    mvp: { name: 'Amy Okonkwo', team: 'Nigeria' },
    medal_games: [
      game('Final', 'Nigeria', 'Mali', 78, 64),
      game('Third place game', 'South Sudan', 'Senegal', 66, 65)
    ],
    final_standings: ['Nigeria', 'Mali', 'South Sudan', 'Senegal', 'Cameroon', 'Mozambique', "Côte d'Ivoire", 'Uganda', 'Egypt', 'Angola', 'Rwanda', 'Guinea'],
    leaders: [
      leader('Points', 'Raneem Elgedawy', 'Egypt', '20.3 PPG'),
      leader('Rebounds', 'Maria Teresa Gakdeng', 'South Sudan', '11.7 RPG'),
      leader('Assists', 'Delicia Washington', 'South Sudan', '5.3 APG')
    ],
    source: source('https://www.fiba.basketball/en/events/fiba-womens-afrobasket-2025')
  })
});

export const internationalHistoryFor = (competitionId) => INTERNATIONAL_HISTORY[competitionId] || null;

export function historicalCardMeta(c) {
  const h = internationalHistoryFor(c?.competition_id);
  if (!h) return null;
  return {
    host_city: h.host.city,
    note: `${h.dates.label} · historical · ${h.champion} champion`
  };
}

function podiumCard(label, team, cls = '') {
  return html`<div class="tile ${cls}"><small>${label}</small><b>${team}</b><span>2025 tournament finish</span></div>`;
}

function resultCard(g) {
  return html`<article class="card card-pad">
    <span class="eyebrow">${g.label}</span>
    <div class="igame-row"><span class="igame-team"><b>${g.winner}</b></span><span class="igame-score">${g.winner_score}</span></div>
    <div class="igame-row lost"><span class="igame-team">${g.loser}</span><span class="igame-score">${g.loser_score}</span></div>
    ${g.note ? html`<p class="note">${g.note}</p>` : ''}
  </article>`;
}

export function historicalCompetitionView(c, h) {
  const year = c.season || new Date(`${h.dates.start}T12:00:00Z`).getUTCFullYear();
  return html`
    ${pageHead({
      eyebrow: `${c.governing_body} · Historical archive`,
      title: c.name,
      sub: `${h.dates.label} · ${h.host.city}, ${h.host.country} · verified tournament result and statistical leaders.`
    })}

    <section class="section">
      <div class="sec-head"><div><h2 class="sec-title bc">Tournament result</h2><p class="desk-sub">Verified historical summary. This page does not claim complete box-score or play-by-play coverage.</p></div></div>
      <div class="tiles">
        ${podiumCard('Champion', h.champion, 'hi')}
        ${podiumCard('Runner-up', h.runner_up)}
        ${podiumCard('Third', h.third)}
        ${podiumCard('Fourth', h.fourth)}
      </div>
    </section>

    <section class="section">
      <div class="sec-head"><h2 class="sec-title bc">Medal games</h2></div>
      <div class="grid g2">${h.medal_games.map(resultCard)}</div>
    </section>

    <section class="section">
      <div class="sec-head"><h2 class="sec-title bc">Tournament snapshot</h2></div>
      <div class="tiles">
        <div class="tile"><small>Teams</small><b>${h.teams}</b><span>national teams</span></div>
        <div class="tile"><small>Games</small><b>${h.games}</b><span>tournament games</span></div>
        <div class="tile"><small>MVP</small><b>${h.mvp.name}</b><span>${h.mvp.team}</span></div>
        <div class="tile"><small>Host</small><b>${h.host.city}</b><span>${h.host.country}</span></div>
      </div>
      ${h.scope_note ? html`<p class="note" style="margin-top:10px">${h.scope_note}</p>` : ''}
    </section>

    ${h.leaders.length ? html`<section class="section">
      <div class="sec-head"><h2 class="sec-title bc">Statistical leaders</h2></div>
      <div class="grid g2">${h.leaders.map((l) => html`<article class="card card-pad"><span class="eyebrow">${l.label}</span><b class="icomp-name">${l.name}</b><p class="note">${l.team} · <span class="hi">${l.value}</span></p></article>`)}</div>
    </section>` : ''}

    <section class="section card">
      <div class="card-head"><span class="card-title">Final standings</span><span class="note">${h.final_standings.length} teams</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Team</th></tr></thead><tbody>
        ${h.final_standings.map((team, i) => html`<tr><td class="mono faint">${i + 1}</td><td class="l ${i < 3 ? 'hi' : ''}">${team}</td></tr>`)}
      </tbody></table></div>
    </section>

    <p class="ifresh">Historical source: <a href="${h.source.url}" target="_blank" rel="noopener">${h.source.name} official ${year} event record ↗</a> · facts reviewed ${h.source.retrieved_at}. PropBetEdge stores the factual summary and citation; this is not a live FIBA feed.</p>
  `;
}
