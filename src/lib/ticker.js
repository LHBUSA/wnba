// Top ticker — a live game/status rail first, headlines only as fallback. pbe-ticker/1.0.0.
//
// Pure: built from the canonical layers already on the page (wnba-api /v1/today slate + last results; wnba-international
// /v1/international live, recent finals and each competition's next games). No separate feed.
//
// Priority (per-category caps keep one category from crowding out the rest):
//   live WNBA → live international → next WNBA → next international → recent WNBA finals → recent international finals
//   → only when no game item exists at all: lead story, key injury, key market/trend story.

export const TICKER_VERSION = 'pbe-ticker/1.0.0';
export const TICKER_CAPS = { live_wnba: 8, live_intl: 6, next_wnba: 6, next_intl: 4, final_wnba: 4, final_intl: 4, story: 3, total: 18 };
export const RECENT_FINAL_MS = 36 * 3600e3;

const TZ = 'America/New_York';
const etDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const timeET = (iso) => `${new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })} ET`;
const dayShort = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' });
/** Start time: "7:30 PM ET" today, "Thu 7:30 PM ET" otherwise. */
export const startLabel = (iso, now = Date.now()) => (etDay(iso) === etDay(new Date(now).toISOString()) ? timeET(iso) : `${dayShort(iso)} ${timeET(iso)}`);

/** International display name: the short name when it reads cleanly, else the country code (never a wrapped strip). */
export const intlName = (t) => { const n = t?.short_name || t?.name || t?.country_code || 'TBD'; return n.length > 14 && t?.country_code ? t.country_code : n; };

function wnbaItem(g, now) {
  const s = g.status?.state;
  const away = { name: g.away?.name, abbr: g.away?.abbr };
  const home = { name: g.home?.name, abbr: g.home?.abbr };
  const base = { sport_scope: 'wnba', home_team: home, away_team: away, home_score: g.home?.score ?? null, away_score: g.away?.score ?? null, start_time: g.start_utc, freshness: null };
  if (s === 'in') return { ...base, item_type: 'live_game', game_status: 'live', period: g.status?.period ?? null, clock: g.status?.clock ?? null, label: 'LIVE', text: `${away.abbr} ${g.away?.score ?? 0} – ${g.home?.score ?? 0} ${home.abbr}`, meta: g.status?.short_detail || [g.status?.period ? `Q${g.status.period}` : null, g.status?.clock].filter(Boolean).join(' '), destination_url: `/cast/${g.game_id}` };
  if (s === 'pre') return { ...base, item_type: 'upcoming_game', game_status: 'scheduled', period: null, clock: null, label: 'NEXT', text: `${away.abbr} at ${home.abbr}`, meta: startLabel(g.start_utc, now), destination_url: `/matchups/${g.game_id}` };
  if (s === 'post') return { ...base, item_type: 'final_game', game_status: 'final', period: null, clock: null, label: 'FINAL', text: `${away.abbr} ${g.away?.score} – ${g.home?.score} ${home.abbr}`, meta: null, destination_url: `/cast/${g.game_id}` };
  return null;
}

function intlItem(g, now) {
  const away = { name: g.away_team?.name, abbr: g.away_team?.country_code };
  const home = { name: g.home_team?.name, abbr: g.home_team?.country_code };
  const href = `/international/games/${g.provider_ids?.espn || String(g.game_id).replace(/^g-/, '')}`;
  const base = { sport_scope: 'international', home_team: home, away_team: away, home_score: g.home_score ?? null, away_score: g.away_score ?? null, start_time: g.scheduled_at, freshness: g.fetched_at || null, destination_url: href };
  if (g.status === 'live') return { ...base, item_type: 'live_game', game_status: 'live', period: g.period ?? null, clock: g.clock ?? null, label: 'INTL LIVE', text: `${intlName(g.away_team)} ${g.away_score ?? 0} – ${g.home_score ?? 0} ${intlName(g.home_team)}`, meta: [g.period_label, g.clock].filter(Boolean).join(' ') || null };
  if (g.status === 'scheduled') return { ...base, item_type: 'upcoming_game', game_status: 'scheduled', period: null, clock: null, label: 'INTL NEXT', text: `${intlName(g.away_team)} vs ${intlName(g.home_team)}`, meta: startLabel(g.scheduled_at, now) };
  if (g.status === 'final') return { ...base, item_type: 'final_game', game_status: 'final', period: null, clock: null, label: 'INTL FINAL', text: `${intlName(g.away_team)} ${g.away_score} – ${g.home_score} ${intlName(g.home_team)}`, meta: g.round_name?.split(' · ').pop() || null };
  return null;
}

const byStart = (a, b) => Date.parse(a.start_time || 0) - Date.parse(b.start_time || 0);
const byRecent = (a, b) => Date.parse(b.start_time || 0) - Date.parse(a.start_time || 0);

/**
 * The normalized, ordered rail. `wnbaGames` = today's (or the next) slate, `wnbaRecent` = last results, `intlLive`,
 * `intlUpcoming`, `intlRecent` from wnba-international; `stories` are newsroom cards (fallback only).
 */
export function buildTicker({ wnbaGames = [], wnbaRecent = [], intlLive = [], intlUpcoming = [], intlRecent = [], stories = [], now = Date.now() } = {}) {
  const w = [...wnbaGames, ...wnbaRecent].map((g) => wnbaItem(g, now)).filter(Boolean);
  const dedupe = (xs) => { const seen = new Set(); return xs.filter((x) => { const k = `${x.sport_scope}:${x.destination_url}:${x.item_type}`; if (seen.has(k)) return false; seen.add(k); return true; }); };
  const iAll = dedupe([...intlLive, ...intlUpcoming, ...intlRecent].map((g) => intlItem(g, now)).filter(Boolean));
  const recent = (x) => now - Date.parse(x.start_time || 0) <= RECENT_FINAL_MS;
  const groups = [
    ['live_wnba', dedupe(w.filter((x) => x.item_type === 'live_game')).sort(byStart), 10],
    ['live_intl', iAll.filter((x) => x.item_type === 'live_game').sort(byStart), 20],
    ['next_wnba', dedupe(w.filter((x) => x.item_type === 'upcoming_game')).sort(byStart), 30],
    ['next_intl', iAll.filter((x) => x.item_type === 'upcoming_game').sort(byStart), 40],
    ['final_wnba', dedupe(w.filter((x) => x.item_type === 'final_game' && recent(x))).sort(byRecent), 50],
    ['final_intl', iAll.filter((x) => x.item_type === 'final_game' && recent(x)).sort(byRecent), 60]
  ];
  const items = groups.flatMap(([k, xs, p]) => xs.slice(0, TICKER_CAPS[k]).map((x, i) => ({ ...x, priority: p + i / 100 })));
  if (items.length) return { version: TICKER_VERSION, mode: items.some((x) => x.item_type === 'live_game') ? 'live' : items.some((x) => x.item_type === 'upcoming_game') ? 'next' : 'final', items: items.slice(0, TICKER_CAPS.total) };
  // Fallback content only when there is no game state at all.
  const lead = stories[0];
  const injury = stories.find((c) => c.kind === 'injury' && c !== lead);
  const market = stories.find((c) => ['preview', 'trend', 'market', 'props'].includes(c.kind) && c !== lead && c !== injury);
  const fallback = [lead, injury, market].filter(Boolean).slice(0, TICKER_CAPS.story).map((c, i) => ({ item_type: c.kind === 'trend' || c.kind === 'market' ? 'market' : 'story', sport_scope: c.kind === 'international' ? 'international' : 'wnba', home_team: null, away_team: null, home_score: null, away_score: null, game_status: null, period: null, clock: null, start_time: c.first_published_at || c.published_at || null, label: c.kind === 'injury' ? 'INJURY' : c.kind === 'trend' || c.kind === 'market' ? 'MARKET' : 'NEWS', text: c.headline, meta: null, destination_url: `/news/${c.slug}`, priority: 90 + i, freshness: c.updated_at || null }));
  return { version: TICKER_VERSION, mode: fallback.length ? 'headlines' : 'empty', items: fallback };
}
