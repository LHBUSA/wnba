// Official game highlights for newsroom stories (wnba-video/1.0.0).
//
// The same pattern as the UFC official-video layer (LHBUSA/UFC docs/videos.md), ported as a pattern — no shared
// runtime, table or Worker:
//   verified channel allowlist (exact channel IDs, data/video-channels.json)
//     → discovery ahead of serving (YouTube Data API v3 uploads playlist when YOUTUBE_API_KEY is set, otherwise the
//       channel's public upload feed + oEmbed embeddability check), bounded, never from the browser, never search
//     → story eligibility (a story about ONE completed game; never injuries, transactions, previews, league news)
//     → deterministic game resolver (both teams, the game date or the tournament round, highlight package title,
//       publication after tip-off, official channel scoped to the namespace) — ambiguity attaches nothing
//     → availability (deleted / private / not embeddable / live / region / unchecked → no player)
//     → article.video, rendered poster-first; the YouTube player loads only on the reader's click.
//
// WNBA games and international games are separate namespaces ("wnba:<game_id>", "intl:<competition>:<game_id>"):
// a WNBA channel can never match an international game and the reverse. A video is enrichment only — nothing in a
// title, thumbnail or description ever becomes an article fact.

// The allowlist (data/video-channels.json) is passed in by the Worker entry, so this module stays pure for tests.

export const VIDEO_VERSION = 'wnba-video/1.0.0';
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[\w-]{22}$/;
const HOUR = 3600e3;
const DAY = 24 * HOUR;

/** Availability states a player may render for. Everything else renders no player. */
export const RENDERABLE = new Set(['playable', 'embeddable_region_unverified']);
/** An embeddability check older than this is uncertain: the player fails closed until it is re-checked. */
export const CHECK_MAX_AGE_MS = 24 * HOUR;

/** Enabled AND verified channels with a well-formed channel ID. Handles are never used for identity. */
export function allowedChannels(doc) {
  return (doc.channels || []).filter((c) => c.provider === 'youtube' && c.enabled === true && c.verified === true && CHANNEL_ID.test(c.channel_id || ''));
}

// ---------------------------------------------------------------------------------------------------------------
// Discovery

const decode = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Parse a channel's public upload feed. The feed must belong to the channel it was requested for. */
export function parseFeed(xml, channelId) {
  const head = String(xml || '').split('<entry>')[0];
  // The feed header names its channel by URL (its own <yt:channelId> omits the "UC" prefix); every entry carries the full ID.
  const feedChannel = head.match(/<uri>https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})<\/uri>/)?.[1] || null;
  if (feedChannel !== channelId) throw new Error('feed_channel_mismatch');
  const channelName = decode(head.match(/<title>([^<]*)<\/title>/)?.[1] || '');
  return String(xml).split('<entry>').slice(1).map((e) => {
    const id = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1] || '';
    const link = e.match(/<link rel="alternate" href="([^"]+)"/)?.[1] || '';
    const thumb = e.match(/<media:thumbnail url="([^"]+)" width="(\d+)" height="(\d+)"/);
    return {
      provider: 'youtube',
      video_id: id,
      channel_id: e.match(/<yt:channelId>([^<]+)<\/yt:channelId>/)?.[1] || null,
      channel_name: channelName,
      title: decode(e.match(/<title>([^<]*)<\/title>/)?.[1] || ''),
      description: decode(e.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] || '').slice(0, 1000),
      published_at: e.match(/<published>([^<]+)<\/published>/)?.[1] || null,
      thumbnail: thumb ? { url: thumb[1], width: Number(thumb[2]), height: Number(thumb[3]) } : null,
      is_short: /\/shorts\//.test(link),
      duration_s: null,
      live_state: null,
      privacy_status: null,
      upload_status: null,
      region_restriction: null,
      discovery: 'channel_feed'
    };
  }).filter((v) => VIDEO_ID.test(v.video_id) && v.channel_id === channelId);
}

const isoDuration = (d) => {
  const m = String(d || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return m ? (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3] || 0) * 60) + Number(m[4] || 0) : null;
};

/** Map one YouTube Data API v3 videos.list item. */
export function fromApiItem(it, checkedAt) {
  const sn = it.snippet || {};
  const st = it.status || {};
  const live = sn.liveBroadcastContent === 'none' ? (it.liveStreamingDetails?.actualEndTime ? 'completed' : 'none') : sn.liveBroadcastContent || null;
  const t = sn.thumbnails || {};
  const best = t.maxres || t.standard || t.high || t.medium || t.default || null;
  return {
    provider: 'youtube',
    video_id: it.id,
    channel_id: sn.channelId || null,
    channel_name: sn.channelTitle || null,
    title: sn.title || '',
    description: String(sn.description || '').slice(0, 1000),
    published_at: sn.publishedAt || null,
    thumbnail: best ? { url: best.url, width: best.width, height: best.height } : null,
    is_short: false,
    duration_s: isoDuration(it.contentDetails?.duration),
    live_state: live,
    privacy_status: st.privacyStatus || null,
    upload_status: st.uploadStatus || null,
    region_restriction: it.contentDetails?.regionRestriction || null,
    discovery: 'youtube_data_api_v3',
    embed: { method: 'youtube_data_api', status: st.embeddable === true ? 'embeddable' : st.embeddable === false ? 'not_embeddable' : 'error', checked_at: checkedAt }
  };
}

/**
 * Data API v3 without search.list: channels.list (uploads playlist, cached) → playlistItems.list (newest 50) →
 * videos.list (50 ids). Three units per channel per pass. The key is never echoed in errors.
 */
export async function discoverViaApi(channel, { key, getJson, uploadsCache = {}, now }) {
  const q = (u) => getJson(`${u}&key=${encodeURIComponent(key)}`).catch((e) => { throw new Error(String(e.message || e).replaceAll(key, '***')); });
  let uploads = uploadsCache[channel.channel_id];
  if (!uploads) {
    const ch = await q(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channel.channel_id}`);
    uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) throw new Error('uploads_playlist_missing');
    uploadsCache[channel.channel_id] = uploads;
  }
  const pl = await q(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}`);
  const ids = (pl.items || []).map((i) => i.contentDetails?.videoId).filter((id) => VIDEO_ID.test(id || ''));
  if (!ids.length) return [];
  const vids = await q(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status,liveStreamingDetails&id=${ids.join(',')}`);
  return (vids.items || []).map((it) => fromApiItem(it, now)).filter((v) => v.channel_id === channel.channel_id);
}

/** oEmbed embeddability check (feed discovery). 200 embeddable; 401/403 embedding disabled; 400/404 gone or private. */
export async function oembedCheck(videoId, { fetchImpl = fetch, now, timeoutMs = 8000 }) {
  if (!VIDEO_ID.test(videoId || '')) return { method: 'oembed', status: 'unavailable', http: null, checked_at: now, reason: 'malformed_id' };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`, { signal: ctl.signal });
    const status = r.status === 200 ? 'embeddable' : [401, 403].includes(r.status) ? 'not_embeddable' : [400, 404].includes(r.status) ? 'unavailable' : 'error';
    let author = null;
    if (r.status === 200) author = (await r.json().catch(() => ({}))).author_url || null;
    return { method: 'oembed', status, http: r.status, author_url: author, checked_at: now };
  } catch (e) {
    return { method: 'oembed', status: 'error', http: null, checked_at: now, reason: e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Availability

export function availability(v, { region = 'US', now = Date.now() } = {}) {
  if (!v || !VIDEO_ID.test(v.video_id || '')) return 'invalid';
  if (v.embed?.status === 'unavailable' || (v.privacy_status && v.privacy_status !== 'public') || (v.upload_status && v.upload_status !== 'processed')) return 'unavailable';
  if (v.embed?.status === 'not_embeddable') return 'unembeddable';
  if (v.live_state === 'live' || v.live_state === 'upcoming') return 'live_not_completed';
  const rr = v.region_restriction;
  if (rr && ((rr.blocked || []).includes(region) || (rr.allowed?.length && !rr.allowed.includes(region)))) return 'blocked';
  if (!v.embed || v.embed.status !== 'embeddable') return 'unchecked';
  if (!v.embed.checked_at || now - Date.parse(v.embed.checked_at) > CHECK_MAX_AGE_MS) return 'stale_check';
  return v.embed.method === 'youtube_data_api' ? 'playable' : 'embeddable_region_unverified';
}

// ---------------------------------------------------------------------------------------------------------------
// Title reading (identity only — never facts)

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, accent-insensitive name match. Three-letter country codes match only in capitals. */
export function names(title, name) {
  const n = norm(name);
  if (!n) return false;
  if (/^[A-Z]{3}$/.test(n)) return new RegExp(`(^|[^A-Za-z0-9])${n}([^A-Za-z0-9]|$)`).test(norm(title));
  return new RegExp(`(^|[^a-z0-9])${escapeRe(n.toLowerCase())}([^a-z0-9]|$)`).test(norm(title).toLowerCase());
}

const HIGHLIGHT_TERM = /\b(full game highlights|game highlights|extended highlights|highlights)\b/i;
const NOT_GAME_HIGHLIGHTS = [
  ['short_or_hashtag_clip', /#[A-Za-z]\w*/],
  ['press_conference', /press conference|presser|postgame (media|availability|interview)/i],
  ['interview', /\binterview\b|\bthe pull up\b|sits down with|one[- ]on[- ]one/i],
  ['mic_d_up', /mic'?d up|wired for sound/i],
  ['podcast_or_show', /podcast|\bepisode\b/i],
  ['reaction', /\breact(s|ion|ing)?\b/i],
  ['live_stream', /\blive\b|watch party|chat party|livestream|\bstream\b/i],
  ['montage', /mixtape|montage|career highlights|season highlights|best of (the )?(season|year|career)|top \d+ plays|top plays|every (bucket|point|three)|all[- ]access|behind the scenes/i],
  ['player_package', /best moments|player of the game|\bpts\b|\bpoints?\)|\bmvp\b|\bcooking\b/i],
  ['preview', /\bpreview\b|\bpre-?game\b|\bhype\b|\btrailer\b/i]
];

/** Is this title a game highlight package at all? Returns the reason it is not. */
export function highlightPackage(title) {
  const t = norm(title);
  for (const [reason, re] of NOT_GAME_HIGHLIGHTS) if (re.test(t)) return { ok: false, reason };
  if (!HIGHLIGHT_TERM.test(t)) return { ok: false, reason: 'no_highlight_term' };
  return { ok: true, term: t.match(HIGHLIGHT_TERM)[0] };
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const iso = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);

/** Every calendar date written in a title (Month D, YYYY · D Month YYYY · YYYY-MM-DD · M/D/YYYY). */
export function titleDates(title) {
  const t = norm(title);
  const out = new Set();
  for (const m of t.matchAll(new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, 'gi'))) out.add(iso(Number(m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], Number(m[2])));
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})\\s+${MONTH_RE}\\.?,?\\s+(20\\d{2})\\b`, 'gi'))) out.add(iso(Number(m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()], Number(m[1])));
  for (const m of t.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) out.add(iso(Number(m[1]), Number(m[2]), Number(m[3])));
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g)) out.add(iso(Number(m[3]), Number(m[1]), Number(m[2])));
  out.delete(null);
  return [...out];
}

const ymd = (at, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));

/** Tournament round named in a title. Longer names are read first so "Semi-Finals" is never "Final". */
export function titleRound(title) {
  let t = norm(title).toLowerCase();
  const found = [];
  const take = (code, re) => { if (re.test(t)) { found.push(code); t = t.replace(re, ' '); } };
  take('QQF', /qualification to (the )?quarter[- ]?finals?/g);
  take('QF', /quarter[- ]?finals?/g);
  take('SF', /semi[- ]?finals?/g);
  take('BRONZE', /bronze[- ]medal( game)?|\bbronze\b|third[- ]place( game)?/g);
  take('FINAL', /gold[- ]medal game|\bfinals?\b|\bgold medal\b/g);
  take('GROUP', /\bgroup (phase|stage|[a-h])\b/g);
  return [...new Set(found)];
}

const COMPETITION_FAMILIES = [
  ['world_cup', /world cup/i], ['olympics', /olympic|paris 20|la ?20\d\d|los angeles 20\d\d/i], ['eurobasket', /eurobasket/i],
  ['americup', /americup/i], ['asia_cup', /asia cup/i], ['afrobasket', /afrobasket/i], ['euroleague', /euroleague/i],
  ['qualifiers', /qualif(ier|ying|ication tournament)/i]
];
const familyOf = (s) => COMPETITION_FAMILIES.filter(([, re]) => re.test(norm(s))).map(([k]) => k);

// Common English names national teams go by in official titles, beyond the registry's name, short name and code.
const NATIONAL_ALIASES = { usa: ['USA', 'Team USA', 'United States', 'U.S.'], 'south-korea': ['Korea'], 'puerto-rico': ['Puerto Rico'], czechia: ['Czech Republic'], turkiye: ['Turkey'] };

// ---------------------------------------------------------------------------------------------------------------
// Story eligibility

const INELIGIBLE = {
  injury: 'injury_update_not_tied_to_a_completed_game',
  transaction: 'transaction',
  preview: 'preview_of_a_future_game',
  props: 'market_story_without_a_completed_game',
  market: 'market_story_without_a_completed_game',
  trend: 'trend_spans_many_games',
  brief: 'news_brief_without_a_single_completed_game'
};

/**
 * Which game (if any) a story is about. Only a story whose subject is ONE completed game is eligible, and the game
 * comes from the article's own structured context — never from its prose.
 */
export function videoTargetOf(a, { schedule = null } = {}) {
  if (!a) return { eligible: false, reason: 'missing_article' };
  if (a.status === 'external_coverage' || a.external_coverage || a.quality_state === 'retired_from_index' || a.duplicate_of) return { eligible: false, reason: 'not_in_newsroom_index' };
  if (a.kind === 'result' || a.kind === 'performance') {
    const g = a.context?.game;
    if (!g?.game_id || !g.start_utc || !g.home?.name || !g.away?.name) return { eligible: false, reason: 'no_structured_game' };
    if (!Number.isFinite(g.home.score) || !Number.isFinite(g.away.score)) return { eligible: false, reason: 'game_not_completed' };
    const team = (t) => ({ id: String(t.team_id), names: [...new Set([t.name, t.location && t.short_name ? `${t.location} ${t.short_name}` : null].filter(Boolean))] });
    return { eligible: true, reason: a.kind === 'result' ? 'final_game_recap' : 'single_game_performance', target: { namespace: 'wnba', key: `wnba:${g.game_id}`, game_id: String(g.game_id), start_utc: g.start_utc, teams: [team(g.away), team(g.home)] } };
  }
  if (a.kind === 'international') {
    const i = a.context?.international;
    if (!i?.game_id || !i.competition?.slug) return { eligible: false, reason: 'no_structured_game' };
    const wnbaPlayers = (a.entities || []).filter((e) => e && e.type === 'player').map((e) => String(e.id));
    if (!wnbaPlayers.length) return { eligible: false, reason: 'no_current_wnba_player_in_game' };
    const start = a.provenance?.source_event_at || schedule?.find((g) => g.provider_ids?.espn === String(i.game_id))?.scheduled_at || null;
    if (!start || !Number.isFinite(i.winner?.score) || !Number.isFinite(i.loser?.score)) return { eligible: false, reason: 'game_not_completed' };
    const team = (t) => ({ id: t.slug, names: [...new Set([t.name, t.code, ...(NATIONAL_ALIASES[t.slug] || [])].filter(Boolean))] });
    return { eligible: true, reason: 'international_game_with_current_wnba_players', target: { namespace: 'intl', key: `intl:${i.competition.slug}:${i.game_id}`, game_id: String(i.game_id), competition: { slug: i.competition.slug, name: i.competition.name }, round: i.round?.code || null, start_utc: start, teams: [team(i.winner), team(i.loser)], wnba_player_ids: wnbaPlayers } };
  }
  return { eligible: false, reason: INELIGIBLE[a.kind] || 'not_a_single_game_story' };
}

// ---------------------------------------------------------------------------------------------------------------
// Resolver

/**
 * Evaluate one video against one target game. Every required check must hold; the result lists the evidence (or the
 * first failed check). `universe` = every team name in the namespace, so a title naming a third team is rejected.
 */
export function evaluateVideo(v, target, channel, { universe = [] } = {}) {
  const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  if (!channel) return fail('channel_not_allowlisted');
  if (channel.namespace !== target.namespace) return fail('channel_namespace_mismatch');
  if (channel.team_scope && !target.teams.some((t) => channel.team_scope.includes(t.id))) return fail('channel_team_scope');
  if (channel.competition_scope && !channel.competition_scope.includes(target.competition?.slug)) return fail('channel_competition_scope');
  if (!VIDEO_ID.test(v.video_id || '')) return fail('malformed_video_id');
  const title = v.title || '';
  const named = target.teams.map((t) => t.names.some((n) => names(title, n)));
  const teamsNamed = named.filter(Boolean).length;
  if (teamsNamed < 2) return fail(teamsNamed ? 'only_one_team_named' : 'teams_not_named', { near: teamsNamed === 1 });
  const others = universe.filter((u) => !target.teams.some((t) => t.id === u.id) && u.names.some((n) => names(title, n)));
  if (others.length) return fail('another_team_named', { near: true });
  const pkg = highlightPackage(title);
  if (!pkg.ok) return fail(pkg.reason, { near: true });
  if (v.is_short) return fail('short_or_hashtag_clip', { near: true });
  if (Number.isFinite(v.duration_s) && v.duration_s < 60) return fail('too_short_for_game_highlights', { near: true });
  const published = Date.parse(v.published_at || '');
  const start = Date.parse(target.start_utc);
  if (!Number.isFinite(published)) return fail('no_publication_time', { near: true });
  if (published < start + HOUR) return fail('published_before_the_game_could_end', { near: true });
  if (published > start + 7 * DAY) return fail('published_more_than_7_days_after_the_game', { near: true });
  const evidence = [`channel ${channel.name} (${channel.channel_id}, ${channel.channel_class}, verified ${String(channel.verification?.checked_at || '').slice(0, 10)})`, `teams: ${target.teams.map((t) => t.names[0]).join(' and ')} both named`, `title term: “${pkg.term}”`, `published ${Math.round((published - start) / 36e5 * 10) / 10} h after tip-off`];
  const dates = titleDates(title);
  if (dates.length > 1) return fail('multiple_dates_in_title', { near: true });
  if (target.namespace === 'wnba') {
    if (!dates.length) return fail('no_game_date_in_title', { near: true });
    const gameDate = ymd(target.start_utc, 'America/New_York');
    if (dates[0] !== gameDate) return fail('title_date_is_another_game', { near: true, title_date: dates[0], game_date: gameDate });
    evidence.push(`title date ${dates[0]} = game date (ET)`);
  } else {
    const fam = familyOf(title);
    const targetFam = familyOf(target.competition?.name || '');
    if (fam.length && !fam.some((f) => targetFam.includes(f))) return fail('another_competition_named', { near: true });
    const years = [...new Set((norm(title).match(/\b20\d{2}\b/g) || []))];
    const compYear = (target.competition?.name || '').match(/\b20\d{2}\b/)?.[0];
    if (compYear && years.some((y) => y !== compYear && !dates.some((d) => d.startsWith(y)))) return fail('another_year_named', { near: true });
    const rounds = titleRound(title);
    if (rounds.length > 1) return fail('multiple_rounds_in_title', { near: true });
    if (rounds.length && target.round && rounds[0] !== target.round) return fail('title_round_is_another_game', { near: true, title_round: rounds[0], game_round: target.round });
    if (dates.length) {
      const ok = [ymd(target.start_utc, 'UTC'), ymd(target.start_utc, 'America/New_York')].includes(dates[0]);
      if (!ok) return fail('title_date_is_another_game', { near: true, title_date: dates[0] });
      evidence.push(`title date ${dates[0]} = game date`);
    } else {
      // No date: the round AND the competition must both be named, and the video must follow the game closely.
      if (!rounds.length || !target.round) return fail('no_date_or_round_in_title', { near: true });
      if (!fam.length) return fail('no_date_and_no_competition_in_title', { near: true });
      if (published > start + 3 * DAY) return fail('undated_title_published_too_late', { near: true });
    }
    if (rounds.length) evidence.push(`title round ${rounds[0]} = game round`);
    if (fam.length) evidence.push(`competition named: ${fam.join(', ')}`);
  }
  return { ok: true, evidence };
}

/**
 * Resolve the one primary highlight video for a target game.
 *   attached  — exactly one identity match per channel, a unique best channel, and a renderable availability
 *   review    — two plausible videos (same channel, or equal-priority channels): attach nothing
 *   unplayable— the matching official video cannot be embedded / is gone / live / unchecked
 *   no_match  — no official highlight package for this game (yet)
 */
export function resolveGameVideo(target, videos, { channels = [], universe = [], now = Date.now() } = {}) {
  const byChannel = new Map(channels.map((c) => [c.channel_id, c]));
  const matches = [];
  const rejected = [];
  for (const v of videos) {
    const ch = byChannel.get(v.channel_id);
    const r = evaluateVideo(v, target, ch, { universe });
    if (r.ok) matches.push({ v, ch, evidence: r.evidence });
    else if (r.near) rejected.push({ video_id: v.video_id, channel_id: v.channel_id, title: v.title, reason: r.reason });
  }
  if (!matches.length) return { status: 'no_match', confidence: 'none', reason: rejected.length ? 'official_candidates_rejected' : 'no_official_highlight_package_found', rejected: rejected.slice(0, 6) };
  const perChannel = new Map();
  for (const m of matches) perChannel.set(m.ch.channel_id, [...(perChannel.get(m.ch.channel_id) || []), m]);
  const crowded = [...perChannel.values()].find((list) => new Set(list.map((m) => m.v.video_id)).size > 1);
  const summary = (m) => ({ video_id: m.v.video_id, channel: m.ch.name, title: m.v.title });
  if (crowded) return { status: 'review', confidence: 'ambiguous', reason: 'multiple_matching_videos_on_one_channel', candidates: crowded.map(summary) };
  const ranked = [...matches].sort((x, y) => (x.ch.priority ?? 9) - (y.ch.priority ?? 9));
  if (ranked.length > 1 && (ranked[0].ch.priority ?? 9) === (ranked[1].ch.priority ?? 9)) return { status: 'review', confidence: 'ambiguous', reason: 'equally_plausible_videos_from_equal_priority_channels', candidates: ranked.map(summary) };
  const best = ranked[0];
  const state = availability(best.v, { now });
  const video = {
    provider: 'youtube', video_id: best.v.video_id, title: best.v.title, channel_id: best.ch.channel_id, channel_name: best.ch.name, channel_class: best.ch.channel_class,
    url: `https://www.youtube.com/watch?v=${best.v.video_id}`, published_at: best.v.published_at, duration_s: best.v.duration_s ?? null,
    live_state: best.v.live_state ?? null, region_restriction: best.v.region_restriction ?? null, privacy_status: best.v.privacy_status ?? null, upload_status: best.v.upload_status ?? null,
    discovery: best.v.discovery, embed: best.v.embed || null, availability: state
  };
  const evidence = { namespace: target.namespace, game_key: target.key, game_id: target.game_id, teams: target.teams.map((t) => t.names[0]), game_date: target.start_utc, competition: target.competition?.slug || null, round: target.round || null, checks: best.evidence, also_matched: ranked.slice(1).map(summary) };
  if (!RENDERABLE.has(state)) return { status: 'unplayable', confidence: 'high', reason: state, video, evidence };
  return { status: 'attached', confidence: 'high', reason: 'official_game_highlights', video, evidence };
}

/** The reader-facing video block for an article, re-checked at serve time (fails closed on stale checks). */
export function servedVideo(decision, { now = Date.now() } = {}) {
  if (decision?.status !== 'attached' || !decision.video) return null;
  const v = decision.video;
  const state = availability(v, { now });
  if (!RENDERABLE.has(state) || !VIDEO_ID.test(v.video_id)) return null;
  return { provider: 'youtube', video_id: v.video_id, title: v.title, channel_name: v.channel_name, channel_id: v.channel_id, url: v.url, embed_url: `https://www.youtube-nocookie.com/embed/${v.video_id}`, published_at: v.published_at, duration_s: v.duration_s, availability: state, match: { confidence: decision.confidence, game_key: decision.evidence?.game_key || null } };
}

// ---------------------------------------------------------------------------------------------------------------
// Scheduled pass (Cloudflare Cron inside wnba-news)

export const VIDEO_PASS_MINUTES = 20;
const CATALOG_DAYS = 45;
const CATALOG_CAP = 900;
const OEMBED_PER_PASS = 25;
const RECHECK_MS = 6 * HOUR;

async function getJsonBounded(url, fetchImpl, timeoutMs = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`http_${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function getTextBounded(url, fetchImpl, timeoutMs = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { signal: ctl.signal, headers: { 'user-agent': 'PropBetEdge-WNBA-News/1.0 (+https://wnba.propbetedge.ai)' } });
    if (!r.ok) throw new Error(`http_${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

/**
 * One bounded discovery + resolution pass. Reads the article index and items, writes `video:v1:catalog`,
 * `video:v1:links` (a decision with its evidence for EVERY story, so omissions are auditable) and `video:v1:status`.
 */
export async function runVideoPass(env, { channelsDoc, teams = [], intlGet = null, fetchImpl = fetch, force = false, now = Date.now() } = {}) {
  const kv = env.NEWS_KV;
  const prevStatus = await kv.get('video:v1:status', 'json');
  if (!force && prevStatus?.at && now - Date.parse(prevStatus.at) < (VIDEO_PASS_MINUTES - 1) * 60e3) return { skipped: 'cadence' };
  const at = new Date(now).toISOString();
  const channels = allowedChannels(channelsDoc);
  const catalog = (await kv.get('video:v1:catalog', 'json')) || { videos: {}, uploads: {} };
  const key = env.YOUTUBE_API_KEY || null;
  const channelRuns = [];
  for (const ch of channels) {
    try {
      const found = key
        ? await discoverViaApi(ch, { key, getJson: (u) => getJsonBounded(u, fetchImpl), uploadsCache: (catalog.uploads ||= {}), now: at })
        : parseFeed(await getTextBounded(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.channel_id}`, fetchImpl), ch.channel_id);
      for (const v of found) {
        const prev = catalog.videos[v.video_id];
        // Feed entries carry no embeddability: keep the last check. API entries bring their own.
        catalog.videos[v.video_id] = { ...prev, ...v, embed: v.embed || prev?.embed || null, first_seen_at: prev?.first_seen_at || at, last_seen_at: at };
      }
      channelRuns.push({ channel_id: ch.channel_id, name: ch.name, status: 'PASS', method: key ? 'youtube_data_api_v3' : 'channel_feed', videos: found.length });
    } catch (e) {
      channelRuns.push({ channel_id: ch.channel_id, name: ch.name, status: 'FAIL', error: String(e.message || e).slice(0, 120) });
    }
  }
  // Prune: recent uploads only, newest first, capped.
  const keep = Object.values(catalog.videos).filter((v) => now - Date.parse(v.published_at || 0) <= CATALOG_DAYS * DAY).sort((x, y) => String(y.published_at).localeCompare(String(x.published_at))).slice(0, CATALOG_CAP);
  catalog.videos = Object.fromEntries(keep.map((v) => [v.video_id, v]));

  // Every story gets a decision with its reason; eligible stories get their target game from structured context.
  const index = (await kv.get('art:v1:index', 'json')) || [];
  const universeWnba = teams.map((t) => ({ id: String(t.team_id), names: [t.name, t.location && t.short_name ? `${t.location} ${t.short_name}` : null].filter(Boolean) }));
  const schedules = new Map();
  const intlUniverse = (schedule) => [...new Map((schedule || []).flatMap((g) => [g.home_team, g.away_team]).filter((x) => x?.slug).map((x) => [x.slug, { id: x.slug, names: [x.name, x.short_name, x.country_code, ...(NATIONAL_ALIASES[x.slug] || [])].filter(Boolean) }])).values()];
  const base = {};
  const targets = [];
  for (const card of index) {
    if (!['result', 'performance', 'international'].includes(card.kind)) { base[card.id] = { status: 'ineligible', reason: videoTargetOf(card).reason, kind: card.kind }; continue; }
    const a = await kv.get(`art:v1:item:${card.id}`, 'json');
    const merged = a ? { ...a, status: card.status || a.status, quality_state: card.quality_state || null, duplicate_of: card.duplicate_of || null } : null;
    let schedule = null;
    const slug = merged?.context?.international?.competition?.slug;
    if (card.kind === 'international' && slug && intlGet) {
      if (!schedules.has(slug)) schedules.set(slug, (await intlGet(`/v1/international/competitions/${slug}/schedule`).catch(() => null))?.games || []);
      schedule = schedules.get(slug);
    }
    const t = videoTargetOf(merged, { schedule });
    if (!t.eligible) { base[card.id] = { status: 'ineligible', reason: t.reason, kind: card.kind }; continue; }
    targets.push({ id: card.id, kind: card.kind, t, universe: card.kind === 'international' ? intlUniverse(schedule) : universeWnba });
  }
  const decide = () => {
    const out = { ...base };
    for (const x of targets) out[x.id] = { kind: x.kind, eligibility: x.t.reason, ...resolveGameVideo(x.t.target, Object.values(catalog.videos), { channels, universe: x.universe, now }) };
    return out;
  };
  let decisions = decide();

  // Embeddability (feed discovery): check the identity-matched videos that are unchecked or due, bounded per pass,
  // then decide again with the checks in hand.
  if (!key) {
    const due = [...new Set(Object.values(decisions).filter((d) => d.video && ['attached', 'unplayable'].includes(d.status)).map((d) => d.video.video_id))]
      .filter((id) => { const e = catalog.videos[id]?.embed; return !e || e.status === 'error' || now - Date.parse(e.checked_at || 0) > RECHECK_MS; })
      .slice(0, OEMBED_PER_PASS);
    for (const id of due) catalog.videos[id] = { ...catalog.videos[id], embed: await oembedCheck(id, { fetchImpl, now: at }) };
    if (due.length) decisions = decide();
  }

  // One video can illustrate one game only. A video matched to two different games is held for review on both.
  const gamesOf = new Map();
  for (const d of Object.values(decisions)) if (d.video && d.evidence?.game_key) gamesOf.set(d.video.video_id, new Set([...(gamesOf.get(d.video.video_id) || []), d.evidence.game_key]));
  for (const d of Object.values(decisions)) if (d.video && gamesOf.get(d.video.video_id)?.size > 1) Object.assign(d, { status: 'review', confidence: 'ambiguous', reason: 'video_matches_more_than_one_game' });

  const counts = {};
  for (const d of Object.values(decisions)) counts[d.status] = (counts[d.status] || 0) + 1;
  const status = { at, version: VIDEO_VERSION, discovery: key ? 'youtube_data_api_v3' : 'channel_feed+oembed', channels: channelRuns, catalog_videos: keep.length, decisions: counts };
  await kv.put('video:v1:catalog', JSON.stringify(catalog));
  await kv.put('video:v1:links', JSON.stringify({ at, version: VIDEO_VERSION, decisions }));
  await kv.put('video:v1:status', JSON.stringify(status));
  return status;
}
