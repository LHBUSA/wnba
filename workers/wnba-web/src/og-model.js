// Share-card content models. Pure: decides what each card says from the same API records the pages use.
// Kept separate from og.js (satori/resvg) so it is testable without the renderer.

import { DESKS, SOCIAL_CARD_PATH } from '../../../src/seo/site.js';
import { deskOf, regularSeasonLine } from '../../../src/seo/meta.js';
import { teamColors, logoEntry } from '../../../src/ui/logo.js';
import { careerSummary } from '../../../src/lib/player-career.js';

const TZ = 'America/New_York';
const day = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' });
const dayTime = (iso) => `${new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' })} · ${new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })} ET`;
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const one = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(1) : null);
const color = (c, fb) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : fb);
export const DEFAULT_SHARE = SOCIAL_CARD_PATH;
const SKILL_DIMS = Object.freeze(['scoring', 'efficiency', 'creation', 'playmaking', 'ball_security', 'rebounding', 'defensive_activity', 'shooting_profile', 'ft_pressure']);
const whole = (v) => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString('en-US') : null);

/** PNG twin of a self-hosted team mark (the renderer cannot decode WebP), or null for an unknown team. */
export const teamMarkPath = (team) => { const e = logoEntry(team); return e ? `/media/teams/${e.team_id}/og.png` : null; };

/**
 * The approved newsroom composite (/media/news/players/<id>/og.jpg) exists only for players with a licensed
 * (Commons, identity-verified) portrait. Hotlinked provider headshots (WNBA CDN, ESPN) are never re-published
 * inside a generated card.
 */
export function approvedCardPhoto(athleteId, photo) {
  const selfHosted = !photo?.provider && photo?.license && /^\/media\/players\//.test(photo?.portrait || ''); // pre-resolver shape
  const licensed = photo?.licensed || (photo?.provider === 'commons' ? photo : null) || (photo?.sources || []).find((x) => x?.provider === 'commons' && x?.rights === 'licensed') || (selfHosted ? photo : null);
  return licensed && athleteId ? `/media/news/players/${athleteId}/og.jpg` : null;
}
const FLAG_PATH = /^\/media\/flags\/[a-z]{3}\.svg$/;

const PAGE_CARDS = Object.freeze({
  home: ['WNBA intelligence', 'PropBetEdge WNBA', 'Live scores, sourced injuries, matchup research, player intelligence and original newsroom coverage.'],
  news: ['WNBA newsroom', 'WNBA News & Analysis', 'Original, source-grounded WNBA coverage with injuries, transactions, previews, recaps and market context.'],
  injuries: ['Availability desk', 'WNBA Injuries Today', 'Player availability, reported injury detail and source freshness — with no invented return dates.'],
  props: ['Market intelligence', 'WNBA Player Props', 'Best available prices, market consensus and capture time across the current WNBA slate.'],
  standings: ['League table', 'WNBA Standings', 'Conference seeds, records, games back, streaks, last 10 and point differential.'],
  playoffs: ['Postseason', 'WNBA Playoffs & Bracket', 'Live bracket, series status, schedule and results — built from verified postseason games.'],
  stats: ['League leaders', 'WNBA Stats Leaders', 'Current-season player leaders and team profiles with sourced sample sizes.'],
  teams: ['Team directory', 'WNBA Teams', 'Every team linked to its roster, schedule, player profiles, injuries and newsroom coverage.'],
  players: ['Player directory', 'WNBA Players', 'Current rosters linked to player profiles, stats, career totals, game logs, WinBA and news.'],
  matchups: ['Game research', 'WNBA Matchups', 'Upcoming games with form, rest, rotation, availability and stored market context.'],
  cast: ['Live game center', 'WNBACast', 'Live WNBA score, play-by-play, shot locations and persisted replay.'],
  'pbe-picks': ['PropBetEdge model', 'PBE Picks', 'Independent WNBA win probabilities, locked calls and model-vs-market context.'],
  'pbe-model': ['Methodology', 'How the PBE WNBA Model Works', 'Features, validation, calibration, lock policy and known limits.'],
  'track-record': ['Transparency', 'PBE WNBA Track Record', 'Every official locked call stays on the board and is graded from the final score.'],
  pro: ['WNBA Pro', 'PropBetEdge WNBA Pro', 'The full WNBA research desk: premium intelligence, model context and deeper player research.'],
  'winba-score': ['PropBetEdge original metric', 'WinBA Score', 'The 0–100 WNBA winning-impact metric: formula, current rankings, qualification rules and limits.'],
  sources: ['Trust layer', 'WNBA Data Sources', 'Source registry, freshness and the methodology behind PropBetEdge WNBA.'],
  about: ['About', 'PropBetEdge WNBA Newsroom', 'Independent WNBA intelligence and an automated newsroom inside the PropBetEdge network.'],
  'editorial-policy': ['Trust', 'Editorial Policy', 'How PropBetEdge WNBA verifies, attributes and publishes source-grounded coverage.'],
  corrections: ['Trust', 'Corrections & Revisions', 'How PropBetEdge WNBA preserves publication history and handles corrections.'],
  methodology: ['Trust', 'WNBA Methodology', 'How form, rotations, pace, markets and newsroom decisions are calculated and disclosed.'],
  international: ['Global basketball', 'International Women’s Basketball', 'World Cup, Olympics and FIBA competition intelligence with WNBA player connections.'],
  history: ['Historical intelligence', 'WNBA History', 'Eras, championships, franchise lineage, milestones and the PropBetEdge historical archive.'],
  'player-load': ['WNBA Pro · Player intelligence', 'Player Load', 'Workload, rest, recent minutes, schedule density and rotation pressure in one player-level research surface.'],
  brief: ['Free intelligence', 'WNBA Daily Brief', 'Today’s slate, PBE coverage, sourced availability changes and the public model track record.'],
  'edge-timeline': ['WNBA Pro · Model movement', 'PBE Edge Timeline', 'Follow model, market, confidence and call movement from first read through lock.'],
  'rotation-impact': ['WNBA Pro · Rotation research', 'Rotation Impact', 'Player Load, availability and recent minutes combined into a team-by-team opportunity pressure desk.'],
  'scenario-lab': ['WNBA Pro · Game paths', 'PBE Scenario Lab', 'Base case, supporting drivers, counter-drivers and model-market disagreement for current calls.'],
  watchlist: ['WNBA Pro · Alerts', 'Watchlist & Live Alerts', 'Organize teams and surface current PBE, Player Load and availability signals in one live board.']
});

function pageModel(key) {
  if (key.startsWith('news-')) {
    const desk = key.slice(5);
    return { kicker: 'WNBA newsroom', title: DESKS[desk] || 'WNBA News', titleFont: 'display', detail: 'Source-grounded PropBetEdge WNBA coverage.', tag: 'News', footer: 'wnba.propbetedge.ai/news', colors: ['#35270f', '#1b2230'], fallback: DEFAULT_SHARE };
  }
  const p = PAGE_CARDS[key];
  if (!p) return null;
  return { kicker: p[0], title: p[1], titleFont: 'display', detail: p[2], tag: PAGE_TAGS[key] || null, footer: 'wnba.propbetedge.ai', colors: ['#35270f', '#1b2230'], fallback: DEFAULT_SHARE };
}

const PAGE_TAGS = Object.freeze({ cast: 'WNBACast', 'pbe-picks': 'PBE Picks', 'pbe-model': 'PBE Picks', 'track-record': 'PBE Picks', news: 'News', international: 'International', matchups: 'Matchups', players: 'Players', teams: 'Teams', injuries: 'Availability', props: 'Markets', standings: 'Standings', playoffs: 'Playoffs', stats: 'Stats', history: 'History', pro: 'WNBA Pro', 'player-load': 'WNBA Pro', 'edge-timeline': 'WNBA Pro', 'rotation-impact': 'WNBA Pro', 'scenario-lab': 'WNBA Pro', watchlist: 'WNBA Pro', brief: 'Daily Brief' });

/** WinBA Score page: the metric's own card with the current top of the canonical board. */
async function winbaPageModel(api) {
  const [res, teams] = await Promise.all([Promise.resolve(api.statsWinba?.()).catch(() => null), Promise.resolve(api.teams?.()).catch(() => null)]);
  const d = res?.ok ? res.data : null;
  const rows = (d?.rows || []).filter((r) => r.qualified && Number.isFinite(Number(r.score))).sort((a, b) => a.rank - b.rank).slice(0, 3);
  const teamName = new Map((teams?.ok ? teams.data.teams : []).map((t) => [String(t.team_id), t.name]));
  return {
    winbaBoard: true,
    title: 'WinBA Score',
    board: rows.map((r) => ({ rank: r.rank, name: r.name, team: teamName.get(String(r.team_id)) || null, score: one(r.score) })),
    boardLabel: d?.season ? `${d.season} leaders · ${d.qualified_count} qualified` : 'Current leaders',
    footer: 'wnba.propbetedge.ai/winba-score',
    fallback: DEFAULT_SHARE
  };
}

export async function cardModel(kind, key, api) {
  if (kind === 'pages' && key === 'winba-score') return winbaPageModel(api);
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
        footer: `PropBetEdge WNBA News · ${day(a.first_published_at || a.published_at)}`,
        photoPath,
        scoreboard: { competition: v.competition_name || v.competition, rows: v.teams.map((t) => ({ name: t.name, score: t.score, flagPath: FLAG_PATH.test(t.flag || '') ? t.flag : null })) },
        colors: [color(v.teams[0].color, '#2a241c'), color(v.teams[1].color, '#3a2f22')],
        fallback: photoPath || DEFAULT_SHARE
      };
    }
    // The WinBA Index gets its own card: the series and period as the kicker,
    // the board's top three with their frozen scores, and the leader's approved
    // photograph. Every value comes from the frozen board on the article, so an
    // old month's card keeps that month's leaders.
    if (a.kind === 'winba_index' && a.winba_board?.rows?.length) {
      const top = a.winba_board.rows.slice(0, 3);
      const lead = top[0];
      return {
        kicker: `The WinBA Index · ${a.winba_board.period_label || a.period_label || ''}`.trim(),
        period: a.winba_board.period_label || a.period_label || '',
        title: `The WNBA's top players by WinBA Score`,
        titleFont: 'display',
        sub: top.map((r) => `${r.rank}. ${r.player_name} ${Math.round(r.score)}`).join(' · '),
        detail: `${a.winba_board.qualified_count || ''} qualified players ranked`.trim(),
        footer: `PropBetEdge WNBA News · ${day(a.first_published_at || a.published_at)}`,
        // The premium treatment: the board's top three, each with her own
        // approved photograph. The generator only attaches a podium when ALL
        // three resolve to approved subjects, so there is never a blank cell
        // and never a stand-in; otherwise this falls back to the leader photo.
        podium: (a.winba_podium || []).length === 3
          ? (a.winba_podium || []).map((r) => ({
            rank: r.rank,
            name: r.name,
            score: r.score,
            teamColor: color(teamColors({ team_id: r.team_id }).color, '#2a241c'),
            photoPath: (r.podium || []).find((x) => x.w === 600)?.src || (r.podium || []).slice(-1)[0]?.src || null
          }))
          : null,
        // CC BY-SA obliges us to credit each photograph, and a podium prints
        // three, so the card carries one combined credit line.
        credits: (a.winba_podium || []).length === 3
          ? `Photos: ${[...new Set((a.winba_podium || []).map((r) => r.credit?.author).filter(Boolean))].join(', ')} · CC BY-SA via Wikimedia Commons`
          : null,
        photoPath: (a.winba_podium || []).length === 3 ? null : a.media?.og || null,
        colors: [color(teamColors({ team_id: lead.team_id }).color, '#2a241c'), color(teamColors({ team_id: top[1]?.team_id || lead.team_id }).color, '#3a2f22')],
        fallback: a.media?.og || DEFAULT_SHARE
      };
    }
    // A commissioned feature gets a restrained data treatment over its subject's
    // approved photograph: the frozen rank and rating, and the monthly rank motif
    // read straight off the article's own frozen chart payload. The text sits in
    // the card's dark left panel, so it never covers the subject.
    if (a.kind === 'commissioned_feature' && a.winba_reference && a.commission?.presentation !== 'natural_news') {
      const ref = a.winba_reference;
      const climb = (a.visuals || []).find((v) => v.type === 'line_series');
      const ranks = (climb?.series || []).map((pt) => pt.rank).filter((r) => r !== null && r !== undefined);
      const photo = a.media?.og || null;
      const teamColor = teamColors({ team_id: a.lead_team_id }).color;
      return {
        kicker: 'PropBetEdge Features · WinBA Score',
        title: clip(a.headline, 150),
        sub: `No. ${ref.rank} · ${one(ref.score)} WinBA`,
        detail: ranks.length >= 2 ? `Monthly ranks ${ranks.join(' · ')}` : null,
        footer: `PropBetEdge WNBA News · ${day(a.first_published_at || a.published_at)}`,
        photoPath: photo,
        colors: [color(teamColor, '#2a241c'), color(teamColor, '#3a2f22')],
        fallback: photo || DEFAULT_SHARE
      };
    }
    const photoPath = a.media?.og || null;
    const teams = (a.media?.teams || []).map((t) => teamColors({ team_id: t }).color);
    const naturalNews = a.commission?.presentation === 'natural_news';
    return {
      kicker: naturalNews ? (a.category || 'Game Analysis') : `${DESKS[deskOf(a.kind)] || 'Newsroom'}`,
      title: clip(a.headline, 140),
      footer: `PropBetEdge WNBA News · ${day(a.first_published_at || a.published_at)}`,
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
    const photoPath = approvedCardPhoto(p.athlete_id, res.data.photo);
    const w = res.data.winba;
    const winba = w && w.score !== null && w.score !== undefined && Number.isFinite(Number(w.score)) ? one(w.score) : null;
    const stats = s
      ? [{ label: 'PPG', value: one(s.pts) }, { label: 'RPG', value: one(s.reb) }, { label: 'APG', value: one(s.ast) }]
      : career.available ? [{ label: 'Career GP', value: whole(career.games) }, { label: 'Career PTS', value: whole(career.points) }].filter((x) => x.value) : [];
    if (winba) stats.push({ label: w.qualified && w.rank ? `WinBA · No. ${w.rank}` : 'WinBA', value: winba, accent: true });
    const sample = s ? `${s.year} regular season · ${s.games} games` : null;
    const careerLine = career.available ? [career.games !== null ? `${whole(career.games)} career GP` : null, career.points !== null ? `${whole(career.points)} PTS` : null].filter(Boolean).join(' · ') : null;
    const markPath = teamMarkPath(p.team);
    return {
      kicker: 'WNBA player profile',
      title: p.name,
      sub: [p.team?.name, p.position_name].filter(Boolean).join(' · ') || null,
      stats,
      detail: [sample, careerLine].filter(Boolean).join('  ·  ') || null,
      footer: 'wnba.propbetedge.ai/players',
      photoPath,
      markPath: photoPath ? null : markPath,
      fallbackMarkPath: markPath,
      colors: [color(p.team?.color, '#2a241c'), color(p.team?.alt_color, '#3a2f22')],
      fallback: DEFAULT_SHARE
    };
  }
  if (kind === 'dna') {
    const [dres, pres] = await Promise.all([api.dna(key), api.player(key)]);
    const d = dres?.ok ? dres.data : null;
    if (!d?.player) return null;
    const season = d.scopes?.season;
    // The card names her three strongest SKILL dimensions: descriptive ones (volatility), context (role, form,
    // availability) and WinBA itself (shown on its own) are not strengths. Directly measured dimensions lead;
    // proxies only fill the set.
    const dims = season?.calculated
      ? SKILL_DIMS
        .map((k) => season.dimensions?.[k])
        .filter((x) => x && !x.descriptive && x.status !== 'UNAVAILABLE' && x.score !== null && x.score !== undefined && Number.isFinite(Number(x.score)))
        .sort((a, b) => Number(Boolean(a.proxy)) - Number(Boolean(b.proxy)) || b.score - a.score)
        .slice(0, 3)
        .sort((a, b) => b.score - a.score)
        .map((x) => ({ label: x.label, score: Math.round(x.score) }))
      : [];
    const w = d.winba;
    const winba = w && w.score !== null && w.score !== undefined && Number.isFinite(Number(w.score))
      ? { score: one(w.score), context: w.status === 'QUALIFIED' ? (w.rank ? `No. ${w.rank} in the WNBA · ${d.season}` : `Qualified · ${d.season}`) : `Provisional · ${d.season}` }
      : null;
    if (!dims.length && !winba) return null;
    const p = pres?.ok ? pres.data.player : null;
    const team = p?.team || d.team || null;
    const photoPath = approvedCardPhoto(d.player.id, d.player.headshot);
    const markPath = teamMarkPath(team);
    const smp = season?.calculated ? season.sample : null;
    const pop = season?.population?.n;
    return {
      kicker: 'Player DNA',
      title: d.player.name,
      sub: [team?.name, p?.position_name || d.player.position].filter(Boolean).join(' · ') || null,
      winba,
      dims,
      detail: smp ? `${d.season} season · ${smp.games} GP · ${whole(smp.minutes)} MIN${pop ? ` · vs ${pop} qualified players` : ''}` : null,
      footer: 'wnba.propbetedge.ai · Player DNA',
      photoPath,
      markPath: photoPath ? null : markPath,
      fallbackMarkPath: markPath,
      colors: [color(team?.color, '#2a241c'), color(team?.alt_color, '#3a2f22')],
      fallback: DEFAULT_SHARE
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
      tag: 'Team',
      footer: 'wnba.propbetedge.ai/teams',
      photoPath: null,
      markPath: teamMarkPath(t),
      colors: [color(c.color, '#2a241c'), color(c.alt, '#3a2f22')],
      fallback: DEFAULT_SHARE
    };
  }
  if (kind === 'matchups' || kind === 'cast') {
    const res = await api.game(key);
    if (!res?.ok) return null;
    return versusModel(res.data.game, kind);
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
      footer: 'wnba.propbetedge.ai/international',
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

/** WNBACast and matchup cards: both teams with their marks; the score only once the game has one. */
export function versusModel(g, kind) {
  if (!g?.away || !g?.home) return null;
  const state = g.status?.state;
  const scored = (state === 'in' || state === 'post') && Number.isFinite(g.away.score) && Number.isFinite(g.home.score);
  const status = state === 'in' ? 'live' : state === 'post' ? (kind === 'cast' ? 'replay' : 'final') : 'pre';
  const row = (t, other) => ({
    name: t.name || t.short_name || t.abbr,
    abbr: t.abbr,
    record: t.record ? `${t.record} · ${t.home_away === 'home' ? 'Home' : 'Away'}` : null,
    score: scored ? t.score : null,
    win: scored && t.score > other.score,
    color: color(teamColors(t).color, null),
    logoPath: teamMarkPath(t)
  });
  const when = state === 'pre' ? dayTime(g.start_utc) : day(g.start_utc);
  const live = state === 'in' && g.status?.short_detail ? g.status.short_detail : null;
  return {
    versus: {
      status,
      rows: [row(g.away, g.home), row(g.home, g.away)],
      when: live ? `${live} · ${when}` : when,
      context: [g.season?.label && /post/i.test(g.season.label) ? g.season.label : null, g.venue?.name || null].filter(Boolean).join(' · ') || null
    },
    tag: kind === 'cast' ? 'WNBACast' : 'Matchup',
    footer: kind === 'cast' ? 'wnba.propbetedge.ai/cast' : 'wnba.propbetedge.ai/matchups',
    fallback: DEFAULT_SHARE
  };
}
