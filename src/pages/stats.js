import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { pageHead, sourceLine, errorState, skeleton, avatar, teamDot } from '../ui/components.js';
import { num } from '../lib/format.js';

export const title = () => 'Stats';
export const description = () => 'WNBA season stats: player leaders and team profiles including estimated pace, from current-season source data.';

const PCOLS = [['avgPoints', 'PPG'], ['avgRebounds', 'RPG'], ['avgAssists', 'APG'], ['avgThreePointFieldGoalsMade', '3PM'], ['fieldGoalPct', 'FG%'], ['threePointFieldGoalPct', '3P%'], ['freeThrowPct', 'FT%'], ['avgSteals', 'STL'], ['avgBlocks', 'BLK'], ['avgMinutes', 'MIN'], ['gamesPlayed', 'GP']];
const TCOLS = [['avgPoints', 'PTS'], ['opp_avgPoints', 'OPP'], ['possessions_per_game', 'PACE*'], ['fieldGoalPct', 'FG%'], ['threePointFieldGoalPct', '3P%'], ['avgThreePointFieldGoalsAttempted', '3PA'], ['avgRebounds', 'REB'], ['avgAssists', 'AST'], ['avgTurnovers', 'TOV']];

export async function mount(root, ctx) {
  render(root, html`${pageHead({ eyebrow: 'Season stats', title: 'Stats' })}${skeleton(420)}`);
  const [pl, tm, teams] = await Promise.all([api.statsPlayers(), api.statsTeams(), api.teams()]);
  if (!ctx.isCurrent()) return;
  const tIdx = new Map((teams.ok ? teams.data.teams : []).map((t) => [t.team_id, t]));
  const state = { tab: ctx.query.view === 'teams' ? 'teams' : 'players', sort: 'avgPoints', tsort: 'avgPoints', dir: -1 };

  render(root, html`
    ${pageHead({ eyebrow: pl.ok && pl.data.is_current ? `${pl.data.season?.year || ''} season to date` : 'Season stats', title: 'Stats', sub: 'Season-to-date numbers straight from the source, with the sample shown. Nothing here is projected.' })}
    <div class="tabs" role="tablist"><button type="button" role="tab" data-tab="players" aria-selected="${state.tab === 'players'}">Player leaders</button><button type="button" role="tab" data-tab="teams" aria-selected="${state.tab === 'teams'}">Team profiles</button></div>
    <div data-body></div>
  `);
  const $b = root.querySelector('[data-body]');

  const th = (cols, key) => cols.map(([k, l]) => html`<th><button type="button" data-sort="${k}" ${state[key] === k ? html`aria-sort="descending"` : ''}>${l}</button></th>`);
  const draw = () => {
    if (state.tab === 'players') {
      if (!pl.ok) return render($b, errorState(pl, 'Player stats'));
      const rows = [...pl.data.rows].sort((a, b) => ((b[state.sort] ?? -1) - (a[state.sort] ?? -1)));
      render($b, html`<section class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Player</th>${th(PCOLS, 'sort')}</tr></thead><tbody>
        ${rows.map((r, i) => html`<tr><td class="faint">${i + 1}</td><td><a class="pname" href="/players/${r.athlete_id}">${avatar({ name: r.name, photo: r.photo }, { size: 'sm', teamColor: tIdx.get(r.team_id)?.color })}${r.name}<span class="note">${r.team || ''}</span></a></td>${PCOLS.map(([k]) => html`<td class="${k === state.sort ? 'hi' : ''}">${num(r[k], k === 'gamesPlayed' ? 0 : 1)}</td>`)}</tr>`)}
      </tbody></table></div><div class="card-body"><p class="note">ESPN’s season leaders list includes qualified players only (${rows.length} this season). Players below the qualification threshold — including some recent acquisitions — appear on their player and team pages instead.</p>${sourceLine(pl.meta)}</div></section>`);
    } else {
      if (!tm.ok) return render($b, errorState(tm, 'Team stats'));
      const rows = [...tm.data.rows].sort((a, b) => ((b[state.tsort] ?? -1) - (a[state.tsort] ?? -1)));
      render($b, html`<section class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Team</th>${th(TCOLS, 'tsort')}</tr></thead><tbody>
        ${rows.map((r) => html`<tr><td><a class="pname" href="/teams/${r.team_id}">${teamDot(tIdx.get(r.team_id))}${r.name}</a></td>${TCOLS.map(([k]) => html`<td class="${k === state.tsort ? 'hi' : ''}">${num(r[k])}</td>`)}</tr>`)}
      </tbody></table></div><div class="card-body"><p class="note">*PACE: ${tm.data.pace_method} OPP = points allowed per game.</p>${sourceLine(tm.meta)}</div></section>`);
    }
    $b.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { state[state.tab === 'players' ? 'sort' : 'tsort'] = b.dataset.sort; draw(); }));
  };
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    draw();
  }));
  draw();
}
