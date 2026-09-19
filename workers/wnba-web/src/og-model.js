// Share-card content models. Pure: decides what each card says from the same API records the pages use.
// Kept separate from og.js (satori/resvg) so it is testable without the renderer.

import { DESKS } from '../../../src/seo/site.js';
import { deskOf, regularSeasonLine } from '../../../src/seo/meta.js';
import { teamColors, logoEntry } from '../../../src/ui/logo.js';
import { careerSummary } from '../../../src/lib/player-career.js';

const TZ = 'America/New_York';
const day = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' });
const dayTime = (iso) => `${new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' })} · ${new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })} ET`;
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const one = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(1) : null);
const color = (c, fb) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : fb);
export const DEFAULT_SHARE = '/share/propbetedge-wnba-social-v2.jpg';
const FLAG_PATH = /^\/media\/flags\/[a-z]{3}\.svg$/;

const PAGE_CARDS = Object.freeze({
  home: ['WNBA intelligence', 'PropBetEdge WNBA', 'Live scores, sourced injuries, matchup research, player intelligence and original newsroom coverage.'],
  news: ['WNBA newsroom', 'WNBA News & Analysis', 'Original, source-grounded WNBA coverage with injuries, transactions, previews, recaps and market context.'],
  injuries: ['Availability desk', 'WNBA Injuries Today', 'Player availability, reported injury detail and source freshness — with no invented return dates.'],
  props: ['Market intelligence', 'WNBA Player Props', 'Best available prices, market consensus and capture time across the current WNBA slate.'],
  standings: ['League table', 'WNBA Standings', 'Conference seeds, records, games back, streaks, last 10 and point differential.'],
  stats: ['League leaders', 'WNBA Stats Leaders', 'Current-season player leaders and team profiles with sourced sample sizes.'],
  teams: ['Team directory', 'WNBA Teams', 'Every team linked to its roster, schedule, player profiles, injuries and newsroom coverage.'],
  players: ['Player directory', 'WNBA Players', 'Current rosters linked to player profiles, stats, career totals, game logs, WinBA and news.'],
  matchups: ['Game research', 'WNBA Matchups', 'Upcoming games with form, rest, rotation, availability and stored market context.'],
  cast: ['Live game center', 'WNBACast', 'Live WNBA score, play-by-play, shot locations and persisted replay.'],
  'pbe-picks': ['PropBetEdge model', 'PBE Picks', 'Independent WNBA win probabilities, locked calls and model-vs-market context.'],
  'pbe-model': ['Methodology', 'How the PBE WNBA Model Works', 'Features, validation, calibration, lock policy and known limits.'],
  'track-record': ['Transparency', 'PBE WNBA Track Record', 'Every official locked call stays on the board and is graded from the final score.'],
  pro: ['WNBA Pro', 'PropBetEdge WNBA Pro', 'The full WNBA research desk: premium intelligence, model context and deeper player research.'],
  sources: ['Trust layer', 'WNBA Data Sources', 'Source registry, freshness and the methodology behind PropBetEdge WNBA.'],
  about: ['About', 'PropBetEdge WNBA Newsroom', 'Independent WNBA intelligence and an automated newsroom inside the PropBetEdge network.'],
  'editorial-policy': ['Trust', 'Editorial Policy', 'How PropBetEdge WNBA verifies, attributes and publishes source-grounded coverage.'],
  corrections: ['Trust', 'Corrections & Revisions', 'How PropBetEdge WNBA preserves publication history and handles corrections.'],
  methodology: ['Trust', 'WNBA Methodology', 'How form, rotations, pace, markets and newsroom decisions are calculated and disclosed.'],
  international: ['Global basketball', 'International Women’s Basketball', 'World Cup, Olympics and FIBA competition intelligence with WNBA player connections.']
});

function pageModel(key) {
  if (key.startsWith('news-')) {
    const desk = key.slice(5);
    return { kicker: 'WNBA newsroom', title: DESKS[desk] || 'WNBA News', detail: 'Source-grounded PropBetEdge WNBA coverage.', footer: 'wnba.propbetedge.ai · newsroom', colors: ['#35270f', '#1b2230'], fallback: DEFAULT_SHARE };
  }
  const p = PAGE_CARDS[key];
  if (!p) return null;
  return { kicker: p[0], title: p[1], titleFont: 'display', detail: p[2], footer: 'wnba.propbetedge.ai · PropBetEdge WNBA', colors: ['#35270f', '#1b2230'], fallback: DEFAULT_SHARE };
}

export async function cardModel(kind, key, api) {
  if (kind === 'pages') return pageModel(key);
  if (kind === 'news') {
    const res = await api.article(key);
    if (!res?.ok) return null;
    const a = res.data.article;
    const v = a.media?.visual?.kind === 'intl_scoreboard' ? a.media.visual : null;
    if (v) {
      // International stories share the same scoreboard identity as the article hero and cards.
      const photoPath = a.media.layout === 'intl_photo' ? a.media.og || null : null;
      return {
        kicker: [v.medal ? `${v.medal === 'gold' ? 'Gold' : 'Bronze'} medal` : v.round, 'International'].filter(Boolean).join(' · '),
        title: clip(a.headline, 150),
        footer: `wnba.propbetedge.ai · Published ${day(a.first_published_at || a.published_at)}`,
        photoPath,
        scoreboard: { competition: v.competition_name || v.competition, rows: v.teams.map((t) => ({ name: t.name, score: t.score, flagPath: FLAG_PATH.test(t.flag || '') ? t.flag : null })) },
        colors: [color(v.teams[0].color, '#2a241c'), color(v.teams[1].color, '#3a2f22')],
        fallback: photoPath || DEFAULT_SHARE
      };
    }
    const photoPath = a.media?.og || null;
    const teams = (a.media?.teams || []).map((t) => teamColors({ team_id: t }).color);
    return {
      kicker: `${DESKS[deskOf(a.kind)] || 'Newsroom'}`,
      title: clip(a.headline, 150),
      footer: `wnba.propbetedge.ai · Published ${day(a.first_published_at || a.published_at)}`,
      photoPath,
      colors: [color(teams[0], '#2a241c'), color(teams[1] || teams[0], '#3a2f22')],
      fallback: photoPath || DEFAULT_SHARE
    };
  }
  if (kind === 'players') {
    const res = await api.player(key);
    if (!res?.ok) return null;
    const p = res.data.player;
    const s = regularSeasonLine(res.data);
    const career = careerSummary(res.data.career);
    const photoPath = res.data.photo ? `/media/news/players/${p.athlete_id}/og.jpg` : null;
    const whole = (v) => Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : null;
    const careerDetail = career.available
      ? [career.games !== null ? `${whole(career.games)} GP` : null, career.points !== null ? `${whole(career.points)} PTS` : null, career.rebounds !== null ? `${whole(career.rebounds)} REB` : null, career.assists !== null ? `${whole(career.assists)} AST` : null].filter(Boolean).join(' · ')
      : null;
    const current = s ? `${s.year} · ${one(s.pts)} PPG · ${one(s.reb)} RPG · ${one(s.ast)} APG` : null;
    const winba = res.data.winba?.score !== null && res.data.winba?.score !== undefined ? `WinBA ${one(res.data.winba.score)}` : null;
    return {
      kicker: 'WNBA player profile',
      title: p.name,
      titleFont: 'display',
      sub: [p.team?.name, p.position_name].filter(Boolean).join(' · ') || null,
      detail: careerDetail || current,
      footer: [current, winba, 'wnba.propbetedge.ai'].filter(Boolean).join(' · '),
      photoPath,
      markPath: photoPath ? null : logoEntry(p.team)?.files?.['320'] || null,
      colors: [color(p.team?.color, '#2a241c'), color(p.team?.alt_color, '#3a2f22')],
      fallback: photoPath || DEFAULT_SHARE
    };
  }
  if (kind === 'teams') {
    const res = await api.team(key);
    if (!res?.ok) return null;
    const t = res.data.team;
    const st = res.data.standing;
    const c = teamColors(t);
    return {
      kicker: 'Team',
      title: t.name,
      titleFont: 'display',
      sub: st ? `${st.wins}-${st.losses}${st.seed ? ` · No. ${st.seed} seed` : ''}${st.conference_name ? ` · ${st.conference_name}` : ''}` : null,
      detail: 'Roster, schedule, observed rotation, injuries & news',
      footer: 'wnba.propbetedge.ai · team profile',
      photoPath: null,
      markPath: logoEntry(t)?.files?.['320'] || null,
      colors: [color(c.color, '#2a241c'), color(c.alt, '#3a2f22')],
      fallback: DEFAULT_SHARE
    };
  }
  if (kind === 'matchups') {
    const res = await api.game(key);
    if (!res?.ok) return null;
    const g = res.data.game;
    const a = teamColors(g.away);
    const hc = teamColors(g.home);
    return {
      kicker: g.status?.state === 'post' ? 'Final · matchup' : 'Matchup',
      title: `${g.away?.short_name || g.away?.name} at ${g.home?.short_name || g.home?.name}`,
      titleFont: 'display',
      sub: g.status?.state === 'post' && Number.isFinite(g.away?.score) ? `${g.away.abbr} ${g.away.score} · ${g.home.abbr} ${g.home.score}` : dayTime(g.start_utc),
      detail: g.venue?.name ? `${g.venue.name}${g.venue.city ? `, ${g.venue.city}` : ''}` : 'Form, rest, rotations & availability',
      footer: 'wnba.propbetedge.ai · matchup research',
      photoPath: null,
      colors: [color(a.color, '#2a241c'), color(hc.color, '#3a2f22')],
      fallback: DEFAULT_SHARE
    };
  }
  if (kind === 'intl-comps') {
    const [slug, section = 'overview'] = String(key).split('--');
    const view = section === 'overview' ? null : section;
    const res = await api.intlCompetition(slug, view);
    if (!res?.ok) return null;
    const c = res.data.competition;
    const labels = { overview: 'Tournament center', games: 'Schedule & results', bracket: 'Bracket', standings: 'Standings', leaders: 'Stat leaders', teams: 'Teams', players: 'Players' };
    return {
      kicker: 'International women’s basketball',
      title: c.short_name || c.name,
      titleFont: 'display',
      sub: labels[section] || section,
      detail: [c.host?.city, c.season].filter(Boolean).join(' · ') || c.name,
      footer: 'wnba.propbetedge.ai · international',
      colors: ['#17243a', '#35270f'],
      fallback: DEFAULT_SHARE
    };
  }
  if (kind === 'intl-teams') {
    const res = await api.intlTeam(key);
    if (!res?.ok) return null;
    const d = res.data;
    const t = d.team;
    const c0 = d.competitions?.[0];
    return {
      kicker: 'Women’s national team',
      title: t.name,
      titleFont: 'display',
      sub: c0 ? `${c0.competition.short_name} · ${c0.record.wins}-${c0.record.losses}` : null,
      detail: c0 ? `${one(c0.averages.pts)} PPG · ${one(c0.averages.reb)} RPG · ${one(c0.averages.ast)} APG` : 'Roster, schedule, results and WNBA connections',
      footer: 'wnba.propbetedge.ai · international team profile',
      markPath: FLAG_PATH.test(t.flag || '') ? t.flag : null,
      colors: [color(t.color, '#17243a'), '#35270f'],
      fallback: DEFAULT_SHARE
    };
  }
  if (kind === 'intl-players') {
    const res = await api.intlPlayer(key);
    if (!res?.ok) return null;
    const d = res.data;
    const p = d.player;
    const c0 = d.competitions?.[0];
    const wnbaId = p.wnba?.wnba_player_id;
    return {
      kicker: 'International player profile',
      title: p.name,
      titleFont: 'display',
      sub: p.team?.name || null,
      detail: c0 ? `${c0.competition.short_name} · ${one(c0.averages.pts)} PPG · ${one(c0.averages.reb)} RPG · ${one(c0.averages.ast)} APG` : 'International stats and game log',
      footer: p.wnba?.wnba_team?.name ? `${p.wnba.wnba_team.name} · WNBA connection · wnba.propbetedge.ai` : 'wnba.propbetedge.ai · international player profile',
      photoPath: wnbaId && p.wnba?.photo?.portrait ? `/media/news/players/${wnbaId}/og.jpg` : null,
      markPath: wnbaId && p.wnba?.photo?.portrait ? null : (FLAG_PATH.test(p.team?.flag || '') ? p.team.flag : null),
      colors: [color(p.team?.color, '#17243a'), '#35270f'],
      fallback: DEFAULT_SHARE
    };
  }
  if (kind === 'intl-games') {
    const res = await api.intlGame(key);
    if (!res?.ok) return null;
    const g = res.data.game;
    const c = res.data.competition;
    const line = `${g.away_team.country_code} ${g.away_score} – ${g.home_score} ${g.home_team.country_code}`;
    return {
      kicker: `${c.short_name} · ${g.round_name}`,
      title: `${g.away_team.name} vs ${g.home_team.name}`,
      titleFont: 'display',
      sub: g.status === 'final' ? `Final · ${line}` : g.status === 'live' ? `Live · ${line}` : dayTime(g.scheduled_at),
      detail: g.venue?.name ? `${g.venue.name}${g.venue.city ? `, ${g.venue.city}` : ''}` : c.name,
      footer: 'wnba.propbetedge.ai · international game center',
      photoPath: null,
      colors: [color(g.away_team.color, '#2a241c'), color(g.home_team.color, '#3a2f22')],
      fallback: DEFAULT_SHARE
    };
  }
  return null;
}
