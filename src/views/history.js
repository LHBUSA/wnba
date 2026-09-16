import { html } from '../lib/dom.js';
import { pageHead } from '../ui/components.js';

export const HISTORY_HEAD = {
  eyebrow: 'History Intelligence',
  title: 'WNBA History',
  sub: 'The league story from 1997 to today — founding era, defining moments, franchise change and the archive PropBetEdge is building season by season.'
};

const lanes = [
  ['Seasons', 'A season-by-season archive of schedules, results, standings, playoffs, championships and awards.'],
  ['Champions', 'Finals, title runs and the teams that defined each era of the league.'],
  ['Franchises', 'Team identity and franchise lineage kept separate from provider IDs so relocations and renames stay historically correct.'],
  ['Players & records', 'Career identity, single-game and season records, leaderboards and historical context as each lane is verified.']
];

const milestones = [
  ['1997', 'The WNBA begins', 'The league tipped off its inaugural season with eight teams. Houston won the first championship.'],
  ['1997–2000', 'The first dynasty', 'The Houston Comets won the first four WNBA championships, establishing the league’s first defining era.'],
  ['2002', 'A barrier falls', 'Lisa Leslie recorded the first dunk in a WNBA game, one of the league’s signature early milestones.'],
  ['2020', 'The Wubble season', 'The WNBA played its season at IMG Academy in Bradenton, Florida during the COVID-19 pandemic.'],
  ['2021', 'Twenty-five seasons', 'The league marked its 25th season and formally celebrated the players and moments that shaped its first quarter-century.'],
  ['2025–26', 'Expansion returns', 'A new growth era brought clubs in Golden State, Toronto and Portland into the league.']
];

export function historyView() {
  return html`
    ${pageHead(HISTORY_HEAD)}

    <section class="card card-pad" style="margin-bottom:16px">
      <span class="eyebrow">1997 → Today</span>
      <h2 class="sec-title bc" style="margin-top:8px">One league. Every era.</h2>
      <p style="max-width:72ch;color:var(--paper-2);margin-top:10px">PropBetEdge History Intelligence is being built as a real research archive, not a trivia page. Historical facts are tied to a season, team or player identity and kept separate from current-season data so the past cannot silently contaminate live models or records.</p>
      <div class="pill-row" style="margin-top:14px">
        <a class="pill" href="/teams">Current teams</a>
        <a class="pill" href="/players">Current players</a>
        <a class="pill" href="/stats">Current stats</a>
        <a class="pill" href="/international">International</a>
      </div>
    </section>

    <section class="section">
      <div class="sec-head"><div><span class="eyebrow">Archive</span><h2 class="sec-title bc">What History Intelligence covers</h2></div></div>
      <div class="grid g2">
        ${lanes.map(([title, body]) => html`<article class="card card-pad"><h3 class="card-title">${title}</h3><p class="note" style="margin-top:8px">${body}</p></article>`)}
      </div>
    </section>

    <section class="section">
      <div class="sec-head"><div><span class="eyebrow">Timeline</span><h2 class="sec-title bc">Milestones in WNBA history</h2></div></div>
      <div class="grid g2">
        ${milestones.map(([year, title, body]) => html`
          <article class="card card-pad">
            <span class="eyebrow">${year}</span>
            <h3 class="card-title" style="margin-top:7px">${title}</h3>
            <p class="note" style="margin-top:8px">${body}</p>
          </article>`)}
      </div>
    </section>

    <section class="card card-pad section">
      <span class="eyebrow">The PropBetEdge standard</span>
      <h2 class="sec-title bc" style="margin-top:8px">History without pretending the gaps do not exist</h2>
      <p style="max-width:74ch;color:var(--paper-2);margin-top:10px">The deeper archive is rolling out season by season. When a historical lane is not verified, it stays incomplete instead of being filled with guessed rosters, recycled current-team data or reconstructed statistics. Franchise identity, player identity, game classification and provenance are part of the record.</p>
      <p class="note" style="margin-top:10px">As each historical season clears validation, this page will expand into season pages, championship paths, franchise lineage, player records and searchable historical leaderboards.</p>
    </section>
  `;
}
