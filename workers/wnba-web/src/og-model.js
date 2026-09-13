// Share-card content models. Pure: decides what each card says from the same API records the pages use.
// Kept separate from og.js (satori/resvg) so it is testable without the renderer.

import { DESKS } from '../../../src/seo/site.js';
import { deskOf, regularSeasonLine } from '../../../src/seo/meta.js';
import { teamColors } from '../../../src/ui/logo.js';

const TZ = 'America/New_York';
const day = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' });
const dayTime = (iso) => `${new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' })} · ${new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })} ET`;
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const one = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(1) : null);
const color = (c, fb) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : fb);
export const DEFAULT_SHARE = '/share/propbetedge-wnba-social-v2.jpg';
const FLAG_PATH = /^\/media\/flags\/[a-z]{3}\.svg$/;

export async function cardModel(kind, key, api) {
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
    if (!res?.ok || !res.data.photo) return null;
    const p = res.data.player;
    const s = regularSeasonLine(res.data);
    const photoPath = `/media/news/players/${p.athlete_id}/og.jpg`;
    return {
      kicker: 'Player profile',
      title: p.name,
      titleFont: 'display',
      sub: [p.team?.name, p.position_name].filter(Boolean).join(' · ') || null,
      detail: s ? `${s.year} season · ${one(s.pts)} PTS · ${one(s.reb)} REB · ${one(s.ast)} AST · ${s.games} GP` : null,
      footer: 'wnba.propbetedge.ai · stats, game log, injuries & news',
      photoPath,
      colors: [color(p.team?.color, '#2a241c'), color(p.team?.alt_color, '#3a2f22')],
      fallback: photoPath
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
      footer: 'wnba.propbetedge.ai',
      photoPath: null,
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
