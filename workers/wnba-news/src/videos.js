// Official WNBA video lane — discovery, normalization, classification and identity linking.
//
// Source policy (data/video-channels.json):
//   * only channels whose EXACT YouTube channel id was proved from a first-party link
//     (wnba.com, or a team's own site on the wnba.com domain) and which are marked
//     source_verified + enabled are ever polled. A display name proves nothing.
//   * nothing is downloaded or rehosted. We store the provider's video id and its
//     metadata; the privacy-enhanced embed URL is built in the browser at click time.
//   * no broad YouTube search, ever. Discovery walks each allowlisted channel's own uploads.
//
// Two discovery paths, both real:
//   YOUTUBE_API_KEY set  -> Data API v3: channels.list -> uploads playlist ->
//                           playlistItems.list (incremental) -> videos.list for
//                           duration, status.embeddable, privacy and live state.
//   no key               -> the channel's public Atom feed (newest ~15 uploads) plus a
//                           per-video oEmbed check. oEmbed answering 200 is what proves
//                           the video is embeddable; duration_sec stays null and
//                           live_broadcast_state stays 'unknown' rather than being guessed.
//
// Nothing is published unless embeddable === true.
//
// Video is source media, never PropBetEdge analysis: no availability, condition,
// tactical or betting inference is ever derived from a title, a thumbnail or the
// mere existence of a video.

import CHANNELS from '../../../data/video-channels.json';

export const VIDEO_VERSION = 'wnba-videos/1.0.0';
export const PROVIDER = 'youtube';
export const KEEP_DAYS = 45;

export const VIDEO_TYPES = ['highlights', 'game_recap', 'preview', 'interview', 'press_conference', 'practice', 'feature', 'analysis', 'postgame', 'live_stream', 'other'];

/** The rows we are allowed to poll. Both flags must be true. */
export const ALLOWED_CHANNELS = (CHANNELS.channels || []).filter((c) => c.source_verified === true && c.enabled === true);
export const CHANNEL_BY_ID = new Map(ALLOWED_CHANNELS.map((c) => [c.channel_id, c]));
export const CHANNELS_GENERATED_AT = CHANNELS.generated_at || null;
export const PENDING_CHANNELS = CHANNELS.pending || [];

const UA = 'PropBetEdge-WNBA-Video/1.0 (+https://wnba.propbetedge.ai/)';

export const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;
export const feedUrl = (channelId) => `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
/** provider + provider video id — the only identity. Makes a duplicate row impossible. */
export const videoKey = (providerVideoId) => `${PROVIDER}:${providerVideoId}`;

// ------------------------------------------------------------------ feed

function tagText(block, name) {
  const m = block.match(new RegExp(String.raw`<${name}(?:\s[^>]*)?>([\s\S]*?)<\/${name}>`, 'i'));
  return m ? decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim() : null;
}
function tagAttr(block, name, attrName) {
  const m = block.match(new RegExp(String.raw`<${name}\b[^>]*\b${attrName}\s*=\s*"([^"]*)"`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (NAMED[k]) return NAMED[k];
    if (k[0] === '#') {
      const code = k[1] === 'x' ? parseInt(k.slice(2), 16) : Number(k.slice(1));
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    }
    return m;
  });
}

/** YouTube channel Atom feed -> { channel, entries }. Newest ~15 uploads. */
export function parseYoutubeFeed(xml) {
  const text = String(xml || '');
  const head = text.split(/<entry[\s>]/i)[0];
  let headId = tagText(head, 'yt:channelId');
  if (headId && !/^UC/.test(headId) && headId.length === 22) headId = `UC${headId}`;
  const channel = { channel_id: headId, title: tagText(head, 'title') };
  const entries = [];
  for (const b of text.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []) {
    const providerVideoId = tagText(b, 'yt:videoId');
    if (!providerVideoId) continue;
    const link = tagAttr(b, 'link', 'href');
    entries.push({
      provider_video_id: providerVideoId,
      channel_id: tagText(b, 'yt:channelId'),
      channel_name: tagText(b, 'name') || channel.title,
      title: tagText(b, 'title') || tagText(b, 'media:title') || '',
      description: tagText(b, 'media:description') || '',
      url: link || watchUrl(providerVideoId),
      is_short: /\/shorts\//i.test(link || ''),
      published_at: tagText(b, 'published'),
      source_updated_at: tagText(b, 'updated'),
      thumbnail_url: tagAttr(b, 'media:thumbnail', 'url'),
      duration_sec: null,
      embeddable: null,
      live_broadcast_state: 'unknown',
      discovery: 'youtube_atom_feed'
    });
  }
  return { channel, entries };
}

/**
 * oEmbed: 200 means the embed page exists (the video is public and embedding is on).
 * 401 = embedding disabled, 403 = private, 400/404 = gone. Anything non-200 means
 * "do not render a player". A 200 says nothing about the viewer's country, so it
 * never claims more than embeddability.
 */
export async function checkEmbeddable(providerVideoId, fetchImpl = fetch) {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(providerVideoId))}&format=json`;
  try {
    const r = await fetchImpl(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { embeddable: false, status: r.status, proves: 'not_embeddable' };
    let author = null;
    let thumb = null;
    try {
      const j = await r.json();
      author = j.author_name || null;
      thumb = j.thumbnail_url || null;
    } catch { /* the verdict is the status, not the body */ }
    return { embeddable: true, status: 200, author_name: author, thumbnail_url: thumb, proves: 'embed_page_exists' };
  } catch (e) {
    return { embeddable: null, status: null, error: e.message };
  }
}

// -------------------------------------------------------------- Data API

const API = 'https://www.googleapis.com/youtube/v3';

/** "PT1H2M3S" -> 3723 */
export function isoDurationToSec(s) {
  const m = String(s || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0);
}

async function apiGet(resource, params, key, fetchImpl) {
  const q = new URLSearchParams({ ...params, key });
  const r = await fetchImpl(`${API}/${resource}?${q}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
  const body = await r.text();
  if (!r.ok) throw new Error(`youtube_${resource}_${r.status}:${body.slice(0, 160)}`);
  return JSON.parse(body);
}

/** channels.list -> uploads playlist -> playlistItems.list (incremental) -> videos.list. */
export async function discoverViaDataApi(channelId, { key, since, fetchImpl = fetch, maxPages = 3 }) {
  const ch = await apiGet('channels', { part: 'contentDetails,snippet', id: channelId }, key, fetchImpl);
  const item = (ch.items || [])[0];
  if (!item) throw new Error(`channels_list_empty:${channelId}`);
  const uploads = item.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error(`no_uploads_playlist:${channelId}`);
  const ids = [];
  let pageToken;
  for (let page = 0; page < maxPages; page += 1) {
    const pl = await apiGet('playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: 50, ...(pageToken ? { pageToken } : {}) }, key, fetchImpl);
    let allOld = true;
    for (const it of pl.items || []) {
      const vid = it.contentDetails?.videoId;
      const pub = it.contentDetails?.videoPublishedAt;
      if (!vid) continue;
      if (since && pub && new Date(pub) < since) continue;
      allOld = false;
      ids.push(vid);
    }
    pageToken = pl.nextPageToken;
    if (!pageToken || allOld) break;
  }
  const entries = [];
  for (let i = 0; i < ids.length; i += 50) {
    const v = await apiGet('videos', { part: 'snippet,contentDetails,status,liveStreamingDetails', id: ids.slice(i, i + 50).join(',') }, key, fetchImpl);
    for (const it of v.items || []) {
      const sn = it.snippet || {};
      const th = sn.thumbnails || {};
      const thumb = (th.maxres || th.standard || th.high || th.medium || th.default || {}).url || null;
      let live = sn.liveBroadcastContent || 'none';
      if (live === 'none' && it.liveStreamingDetails?.actualEndTime) live = 'completed';
      const duration = isoDurationToSec(it.contentDetails?.duration);
      entries.push({
        provider_video_id: it.id,
        channel_id: sn.channelId,
        channel_name: sn.channelTitle,
        title: sn.title || '',
        description: sn.description || '',
        url: watchUrl(it.id),
        // The Data API does not flag Shorts; <= 60s is the usual proxy and is recorded as such.
        is_short: duration !== null && duration <= 60,
        published_at: sn.publishedAt,
        source_updated_at: null,
        thumbnail_url: thumb,
        duration_sec: duration,
        embeddable: it.status?.embeddable == null ? null : Boolean(it.status.embeddable),
        privacy_status: it.status?.privacyStatus || null,
        live_broadcast_state: live,
        discovery: 'youtube_data_api_v3'
      });
    }
  }
  return { channel: { channel_id: channelId, title: item.snippet?.title || null }, entries };
}

// ------------------------------------------------------------ classification

// Ordered: the first family whose pattern hits the TITLE wins. A press conference
// beats "postgame" on purpose — "Postgame Press Conference" is a press conference.
// Description patterns are consulted only when the title says nothing at all, and
// only for the families whose wording names a format rather than a subject.
const TITLE_RULES = [
  ['press_conference', /\bpress conference\b|\bpresser\b|\bmedia avail(?:ability)?\b|\bpostgame media\b|\bpractice media\b|\bmedia day\b/i],
  ['postgame', /\bpost[\s-]?game\b|\bpost[\s-]?match\b|\breact(?:s|ion|ions)? to (?:the )?(?:win|loss|game)\b|\bafter the (?:win|loss|buzzer)\b/i],
  ['practice', /\bpractice\b|\bshootaround\b|\btraining camp\b|\bworkout\b/i],
  ['highlights', /\bhighlights?\b|\bevery (?:bucket|basket|point|assist|three)\b|\btop (?:plays|\d+ plays)\b|\bbest of\b|\bplay of the (?:game|night|day)\b/i],
  ['game_recap', /\brecap\b|\bcondensed game\b|\bfinal minutes\b|\bfull game\b/i],
  ['preview', /\bpreview\b|\bmatchup\b|\bkeys to (?:the )?(?:game|win)\b|\bwhat to watch\b|\bpregame\b|\bgame day\b/i],
  ['interview', /\binterview\b|\bsits? down\b|\b1[\s-]?on[\s-]?1\b|\bone[\s-]on[\s-]one\b|\bmic(?:'|’)?d up\b|\bq ?& ?a\b|\btakes the mic\b|\bcatch(?:es)? up with\b/i],
  ['analysis', /\bbreakdown\b|\bfilm (?:room|study|session)\b|\banalysis\b|\bby the numbers\b|\bexplained\b/i],
  ['feature', /\ball[\s-]?access\b|\bepisode\b|\bep\.? ?\d+\b|\bbehind the (?:scenes|curtain)\b|\bfeature\b|\bdocumentary\b|\bspotlight\b|\bthe story of\b|\bdiary\b/i]
];
// Titles only. The description is NOT consulted: WNBA team-channel descriptions are
// standing marketing boilerplate that names "highlights", "preview" and "recap" on every
// upload, and typing from it labelled interviews as previews and features as highlights.
// An honest 'other' beats a confident wrong label.

export function classifyVideo(title, _description, { live_broadcast_state: live } = {}) {
  if (live === 'live' || live === 'upcoming') {
    return { video_type: 'live_stream', evidence: [{ video_type: 'live_stream', source: 'live_broadcast_state', match: live }] };
  }
  const evidence = [];
  let type = null;
  for (const [t, re] of TITLE_RULES) {
    const m = String(title || '').match(re);
    if (!m) continue;
    evidence.push({ video_type: t, source: 'title', match: m[0] });
    if (!type) type = t;
  }
  return { video_type: type || 'other', evidence };
}

// ------------------------------------------------------------ identity linking

export function norm(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’`]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const pad = (s) => ` ${norm(s)} `;
const hasPhrase = (hay, phrase) => Boolean(phrase) && (hay.includes(` ${phrase} `) || hay.includes(` ${phrase}'s `) || hay.includes(` ${phrase}' `));

/**
 * Build the identity index from OUR canonical records.
 *   teams:   /v1/teams rows (team_id, name, short_name, location)
 *   players: /v1/players rows (athlete_id, name, team_id)
 * A full player name shared by two rostered players is never text-linked.
 */
export function buildVideoIndex({ teams = [], players = [] }) {
  const teamById = new Map(teams.map((t) => [String(t.team_id), t]));
  const teamFullNames = new Map();   // "atlanta dream" -> team
  const teamNicknames = new Map();   // "dream" -> [teams]  (a nickname alone is never enough)
  for (const t of teams) {
    const id = String(t.team_id);
    const row = { ...t, team_id: id };
    for (const full of [t.name, t.location && t.short_name ? `${t.location} ${t.short_name}` : null].filter(Boolean)) {
      teamFullNames.set(norm(full), row);
    }
    if (t.short_name) {
      const n = norm(t.short_name);
      if (!teamNicknames.has(n)) teamNicknames.set(n, []);
      teamNicknames.get(n).push(row);
    }
  }
  const nameCount = new Map();
  for (const p of players) nameCount.set(norm(p.name), (nameCount.get(norm(p.name)) || 0) + 1);
  const playerByName = new Map();
  for (const p of players) {
    const n = norm(p.name);
    if (n.split(' ').length >= 2 && nameCount.get(n) === 1) {
      playerByName.set(n, { athlete_id: String(p.athlete_id), name: p.name, team_id: p.team_id ? String(p.team_id) : null });
    }
  }
  return { teamById, teamFullNames, teamNicknames, playerByName };
}

// "vs", "at", "@" or "against" immediately before a bare nickname is what makes it an
// opponent rather than an English noun — "Storm", "Sun", "Sky", "Fire", "Dream".
const OPPONENT_CUE = /(?:\bvs\.?|\bversus|\bagainst|\bat|@)\s*$/i;

/**
 * Teams named in a video.
 *   channel_owner                  the team whose own channel published it (definitional)
 *   exact_team_name                "Los Angeles Sparks", "Atlanta Dream"
 *   opponent_cue                   a bare nickname directly after vs / at / @ / against
 *   nickname_with_rostered_player  a bare nickname plus a linked player on that roster
 * Anything weaker links nothing.
 */
export function linkTeams(text, channel, index, players) {
  const out = new Map();
  if (channel?.channel_class === 'team_official' && channel.team_id) {
    const id = String(channel.team_id);
    const t = index.teamById.get(id);
    out.set(id, { team_id: id, name: t?.name || channel.name, method: 'channel_owner' });
  }
  const hay = pad(text);
  for (const [n, t] of index.teamFullNames) {
    if (!hasPhrase(hay, n) || out.has(t.team_id)) continue;
    out.set(t.team_id, { team_id: t.team_id, name: t.name, method: 'exact_team_name' });
  }
  const raw = String(text || '');
  for (const [n, list] of index.teamNicknames) {
    if (list.length !== 1) continue;             // a nickname two teams share links nothing
    const t = list[0];
    if (out.has(t.team_id) || !hasPhrase(hay, n)) continue;
    const m = raw.match(new RegExp(String.raw`([\s\S]{0,14})\b${n}\b`, 'i'));
    if (m && OPPONENT_CUE.test(m[1])) { out.set(t.team_id, { team_id: t.team_id, name: t.name, method: 'opponent_cue' }); continue; }
    const mate = players.find((p) => p.team_id === t.team_id);
    if (mate) out.set(t.team_id, { team_id: t.team_id, name: t.name, method: `nickname_with_rostered_player:${mate.athlete_id}` });
  }
  // A player linked by exact, unique full name carries her current team. This is how a
  // league-channel award clip reaches the right team rail without guessing from a title.
  for (const p of players) {
    if (!p.team_id || out.has(p.team_id)) continue;
    const t = index.teamById.get(p.team_id);
    if (t) out.set(p.team_id, { team_id: p.team_id, name: t.name, method: `rostered_player:${p.athlete_id}` });
  }
  return [...out.values()];
}

/** Players named in a video. Exact, unique, multi-token full name only — never a surname, never a guess. */
export function linkPlayers(text, index) {
  const hay = pad(text);
  const out = [];
  for (const [n, p] of index.playerByName) {
    if (hasPhrase(hay, n)) out.push({ athlete_id: p.athlete_id, name: p.name, team_id: p.team_id, method: 'exact_full_name' });
  }
  return out;
}

/** A date written in the title ("August 30, 2026", "8/30/26", "2026-08-30") -> YYYY-MM-DD. */
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
/**
 * Every date a title states, as YYYY-MM-DD. Forms seen on the allowlisted channels:
 * "August 30, 2026", "August 15", "8/30/26", "8.30.26", "2026-08-30". A form written
 * without a year takes the year that puts it nearest `near` (the publish date), so an
 * upload on 1 January naming "December 28" means the December just gone.
 */
export function datesInText(text, near) {
  const s = String(text || '');
  const out = new Set();
  const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const ref = near ? new Date(near) : null;
  const valid = (y, m, d) => {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? iso(y, m, d) : null;
  };
  const withYear = (m, d) => {
    if (!ref || !Number.isFinite(ref.getTime())) return null;
    const base = ref.getUTCFullYear();
    let best = null;
    for (const y of [base - 1, base, base + 1]) {
      const v = valid(y, m, d);
      if (!v) continue;
      const dist = Math.abs(Date.UTC(y, m - 1, d) - ref.getTime());
      if (!best || dist < best.dist) best = { v, dist };
    }
    return best && best.dist <= 200 * 86400e3 ? best.v : null;
  };
  for (const m of s.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/g)) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (!mo) continue;
    const v = m[3] ? valid(Number(m[3]), mo, Number(m[2])) : withYear(mo, Number(m[2]));
    if (v) out.add(v);
  }
  for (const m of s.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/g)) {
    const y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    const v = valid(y, Number(m[1]), Number(m[2]));
    if (v) out.add(v);
  }
  for (const m of s.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const v = valid(Number(m[1]), Number(m[2]), Number(m[3]));
    if (v) out.add(v);
  }
  return [...out];
}

const etDate = (utc) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(utc));

/**
 * A game is attached only when BOTH of its teams are linked and exactly one scheduled
 * game matches. Candidates are narrowed by an explicit date in the title when there is
 * one, otherwise by a +/-3 day window around publication. If two candidates survive the
 * association stays null — an ambiguous video is unlinked, never attached to the wrong game.
 */
export function linkGame(teamIds, titleText, publishedAt, games) {
  if (teamIds.length < 2 || !games?.length) return { game_id: null, method: null };
  const set = new Set(teamIds.map(String));
  const both = games.filter((g) => set.has(String(g.home?.team_id)) && set.has(String(g.away?.team_id)));
  if (!both.length) return { game_id: null, method: null };
  // A date written in the title wins outright and is never overruled by proximity to
  // publication. Teams re-upload late: "August 15 vs Los Angeles Sparks - Postgame Press
  // Conference" went up on 31 August, and the proximity rule alone attached it to the
  // 29 August game.
  const titleDates = new Set(datesInText(titleText, publishedAt));
  if (titleDates.size) {
    const byDate = both.filter((g) => titleDates.has(etDate(g.start_utc)));
    if (byDate.length === 1) return { game_id: String(byDate[0].game_id), method: 'both_teams_and_title_date' };
    return { game_id: null, method: null, review: byDate.length ? 'multiple_games_same_date' : 'title_date_matches_no_scheduled_game' };
  }
  const at = publishedAt ? Date.parse(publishedAt) : NaN;
  if (!Number.isFinite(at)) return { game_id: null, method: null };
  const near = both
    .map((g) => ({ g, dist: Math.abs(Date.parse(g.start_utc) - at) }))
    .filter((x) => x.dist <= 3 * 86400e3)
    .sort((a, b) => a.dist - b.dist);
  if (near.length === 1) return { game_id: String(near[0].g.game_id), method: 'both_teams_within_3d' };
  // Two meetings of the same pair inside the window: only a clear winner (24h nearer) attaches.
  if (near.length > 1 && near[1].dist - near[0].dist >= 86400e3) return { game_id: String(near[0].g.game_id), method: 'both_teams_nearest_game' };
  return { game_id: null, method: null, review: near.length ? 'multiple_candidate_games' : null };
}

/**
 * high    tied to one scheduled game AND names a player exactly
 * medium  one scheduled game, or a team plus an exactly-named player
 * low     a team or a player, but nothing that pins it further
 * none    nothing attached
 * An official team channel is a definitional team signal, so it counts like any other.
 */
export function confidenceFor({ game_id: gameId, teams, players }) {
  if (gameId && players.length) return 'high';
  if (gameId || (teams.length && players.length)) return 'medium';
  if (teams.length || players.length) return 'low';
  return 'none';
}

/** One video -> the normalized contract's identity fields. */
export function linkVideo(entry, channel, index, { games = [], articles = [] } = {}) {
  const text = `${entry.title}\n${entry.description || ''}`;
  const players = linkPlayers(text, index);
  const teams = linkTeams(text, channel, index, players);
  const teamIds = teams.map((t) => t.team_id);
  const g = linkGame(teamIds, entry.title, entry.published_at, games);
  // An article is attached only when exactly one published article carries the same game.
  let articleSlug = null;
  if (g.game_id) {
    const hits = articles.filter((a) => (a.entities || []).some((e) => e && e.type === 'game' && String(e.id) === g.game_id));
    if (hits.length === 1) articleSlug = hits[0].slug || null;
  }
  return {
    // "Recap" alone names a fan event as often as a game ("Beneath The Baskets Recap"),
    // so a game_recap typed from the bare word needs a linked game to stand on.
    demote_recap: !g.game_id,
    player_ids: players.map((p) => p.athlete_id).sort(),
    team_ids: teamIds.sort(),
    game_id: g.game_id,
    article_slug: articleSlug,
    resolver_confidence: confidenceFor({ game_id: g.game_id, teams, players }),
    linking: { teams, players, game: g.method ? { method: g.method } : null, review: g.review || null }
  };
}

// ------------------------------------------------------------ normalization

/** Discovery entry + channel + linking -> the stored contract row. */
export function normalizeVideo(entry, channel, linked, { capturedAt, previous } = {}) {
  const cls = classifyVideo(entry.title, entry.description, entry);
  if (cls.video_type === 'game_recap' && linked.demote_recap && !/\bgame recap\b|\bcondensed game\b|\bfull game\b/i.test(entry.title || '')) {
    cls.evidence.push({ video_type: 'other', source: 'no_game_link', match: 'recap_without_game' });
    cls.video_type = 'other';
  }
  return {
    id: videoKey(entry.provider_video_id),
    provider: PROVIDER,
    provider_video_id: entry.provider_video_id,
    channel_id: entry.channel_id || channel.channel_id,
    channel_name: channel.name,
    channel_class: channel.channel_class,
    source_verified: true,
    url: entry.url || watchUrl(entry.provider_video_id),
    title: entry.title,
    description: (entry.description || '').slice(0, 600),
    published_at: entry.published_at || previous?.published_at || capturedAt,
    source_updated_at: entry.source_updated_at || null,
    duration_sec: entry.duration_sec ?? null,
    thumbnail_url: entry.thumbnail_url || null,
    embeddable: entry.embeddable,
    live_broadcast_state: entry.live_broadcast_state || 'unknown',
    video_type: cls.video_type,
    video_type_evidence: cls.evidence,
    player_ids: linked.player_ids,
    team_ids: linked.team_ids,
    game_id: linked.game_id,
    article_slug: linked.article_slug,
    resolver_confidence: linked.resolver_confidence,
    linking: linked.linking,
    is_short: Boolean(entry.is_short),
    discovery: entry.discovery,
    captured_at: previous?.captured_at || capturedAt,
    updated_at: capturedAt
  };
}

/** Publishable = allowlisted channel, proven embeddable, not a Short, inside the window. */
export function isPublishable(v, { now = Date.now(), keepDays = KEEP_DAYS } = {}) {
  if (!v || v.provider !== PROVIDER) return false;
  if (!CHANNEL_BY_ID.has(v.channel_id)) return false;
  if (v.embeddable !== true) return false;
  if (v.is_short) return false;
  const pub = Date.parse(v.published_at);
  return Number.isFinite(pub) && now - pub <= keepDays * 86400e3;
}

// ------------------------------------------------------------ read model

/** The public shape. Internal linking evidence and the raw description stay server-side. */
export function publicVideo(v) {
  return {
    id: v.id,
    provider: v.provider,
    provider_video_id: v.provider_video_id,
    channel_id: v.channel_id,
    channel_name: v.channel_name,
    channel_class: v.channel_class,
    source_verified: v.source_verified,
    url: v.url,
    title: v.title,
    description: v.description,
    published_at: v.published_at,
    duration_sec: v.duration_sec,
    thumbnail_url: v.thumbnail_url,
    embeddable: v.embeddable,
    live_broadcast_state: v.live_broadcast_state,
    video_type: v.video_type,
    player_ids: v.player_ids,
    team_ids: v.team_ids,
    game_id: v.game_id,
    article_slug: v.article_slug,
    resolver_confidence: v.resolver_confidence,
    captured_at: v.captured_at,
    updated_at: v.updated_at
  };
}

/** Filter + order a stored video map. Newest first; nothing is invented when empty. */
export function selectVideos(store, { type, player_id: playerId, team_id: teamId, game_id: gameId, limit = 12, now = Date.now() } = {}) {
  const all = Object.values(store || {}).filter((v) => isPublishable(v, { now }));
  const matched = all.filter((v) => (!type || v.video_type === type)
    && (!playerId || v.player_ids.includes(String(playerId)))
    && (!teamId || v.team_ids.includes(String(teamId)))
    && (!gameId || v.game_id === String(gameId)));
  matched.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
  return { items: matched.slice(0, Math.max(0, limit)).map(publicVideo), total: matched.length, pool: all.length };
}
