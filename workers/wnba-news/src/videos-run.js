// One video pass: walk every allowlisted channel, normalize, link to our canonical
// WNBA identities, and store the result in KV (Supabase too, when bound).
//
// The pass is idempotent. Rows are keyed by provider + provider video id, so a video
// discovered five times is one row. Linking is recomputed on every pass so a video
// that could not be tied to a game when it appeared picks the game up once the
// schedule or an article makes the association unambiguous.

import {
  ALLOWED_CHANNELS, CHANNEL_BY_ID, KEEP_DAYS, VIDEO_VERSION, CHANNELS_GENERATED_AT, PENDING_CHANNELS,
  feedUrl, parseYoutubeFeed, discoverViaDataApi, checkEmbeddable,
  buildVideoIndex, linkVideo, normalizeVideo, isPublishable
} from './videos.js';

const UA = 'PropBetEdge-WNBA-Video/1.0 (+https://wnba.propbetedge.ai/)';
// oEmbed calls per pass. Anything left over is checked on the next pass rather than
// spending the Worker's subrequest budget in one go. Shorts are never checked at all.
const EMBED_BUDGET = 120;
const MIN_INTERVAL_MS = 25 * 60e3;

const etCompact = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replaceAll('-', '');
const shiftCompact = (s, n) => {
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + n));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
};

async function fetchFeed(channelId) {
  const r = await fetch(feedUrl(channelId), { headers: { 'user-agent': UA, accept: 'application/atom+xml, application/xml' }, signal: AbortSignal.timeout(12000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`feed_http_${r.status}`);
  return parseYoutubeFeed(text);
}

/**
 * @param env      Worker env (NEWS_KV, optional YOUTUBE_API_KEY)
 * @param apiGet   (path) => data, against the owned wnba-api
 * @param force    ignore the minimum interval
 */
export async function runVideos(env, { apiGet, force = false } = {}) {
  const startedAt = new Date().toISOString();
  const last = await env.NEWS_KV.get('vid:v1:last_run', 'json');
  if (!force && last?.at && Date.now() - Date.parse(last.at) < MIN_INTERVAL_MS) {
    return { ...last, skipped: 'min_interval' };
  }

  // Canonical identities and the schedule window come from our own Worker, never from YouTube.
  const [teamsRes, playersRes, scheduleRes] = await Promise.allSettled([
    apiGet('/v1/teams'),
    apiGet('/v1/players'),
    (() => { const t = etCompact(new Date()); return apiGet(`/v1/schedule?from=${shiftCompact(t, -KEEP_DAYS)}&to=${shiftCompact(t, 14)}`); })()
  ]);
  const teams = teamsRes.status === 'fulfilled' ? teamsRes.value.teams || [] : [];
  const players = playersRes.status === 'fulfilled' ? playersRes.value.players || [] : [];
  const games = scheduleRes.status === 'fulfilled' ? scheduleRes.value.games || [] : [];
  const identityErrors = [teamsRes, playersRes, scheduleRes].filter((r) => r.status === 'rejected').map((r) => String(r.reason?.message || r.reason));
  if (!teams.length) {
    // Without canonical teams there is no identity layer, so nothing may be linked.
    const status = { at: startedAt, version: VIDEO_VERSION, status: 'FAIL', error: 'no_canonical_teams', identity_errors: identityErrors, channels: [] };
    await env.NEWS_KV.put('vid:v1:last_run', JSON.stringify(status));
    return status;
  }
  const index = buildVideoIndex({ teams, players });
  const articles = (await env.NEWS_KV.get('art:v1:index', 'json')) || [];

  const store = (await env.NEWS_KV.get('vid:v1:items', 'json')) || {};
  const key = env.YOUTUBE_API_KEY || null;
  const since = new Date(Date.now() - KEEP_DAYS * 86400e3);
  const runs = [];
  let embedBudget = EMBED_BUDGET;

  for (const channel of ALLOWED_CHANNELS) {
    const run = { channel_id: channel.channel_id, name: channel.name, channel_class: channel.channel_class, status: 'PASS', discovered: 0, shorts: 0, new: 0, updated: 0, published: 0, not_embeddable: 0, pending_embed_check: 0 };
    try {
      const { entries } = key
        ? await discoverViaDataApi(channel.channel_id, { key, since })
        : await fetchFeed(channel.channel_id);
      run.discovery = key ? 'youtube_data_api_v3' : 'youtube_atom_feed';
      run.discovered = entries.length;

      for (const raw of entries) {
        // A feed may only ever speak for its own channel.
        if (raw.channel_id && raw.channel_id !== channel.channel_id) continue;
        const entry = { ...raw, channel_id: channel.channel_id };
        if (entry.published_at && Date.parse(entry.published_at) < since.getTime()) continue;
        if (entry.is_short) { run.shorts += 1; continue; }

        const id = `youtube:${entry.provider_video_id}`;
        const previous = store[id];
        if (entry.embeddable === null || entry.embeddable === undefined) {
          // Atom path: reuse a verdict we already have, else spend a budgeted oEmbed call.
          if (previous && previous.embeddable !== null && previous.embeddable !== undefined) entry.embeddable = previous.embeddable;
          else if (embedBudget > 0) { embedBudget -= 1; entry.embeddable = (await checkEmbeddable(entry.provider_video_id)).embeddable; }
          else { run.pending_embed_check += 1; continue; }
        }
        if (entry.embeddable !== true) { run.not_embeddable += 1; if (previous) delete store[id]; continue; }

        const linked = linkVideo(entry, channel, index, { games, articles });
        store[id] = normalizeVideo(entry, channel, linked, { capturedAt: startedAt, previous });
        if (previous) run.updated += 1; else run.new += 1;
        run.published += 1;
      }
    } catch (e) {
      run.status = 'FAIL';
      run.error = e.message;
    }
    runs.push(run);
  }

  // Re-link everything still in the window so late schedule/article facts attach,
  // and drop anything that has aged out or whose channel left the allowlist.
  const now = Date.now();
  for (const [id, v] of Object.entries(store)) {
    const channel = CHANNEL_BY_ID.get(v.channel_id);
    if (!channel || !isPublishable(v, { now })) { delete store[id]; continue; }
    const linked = linkVideo({ title: v.title, description: v.description, published_at: v.published_at }, channel, index, { games, articles });
    Object.assign(store[id], {
      player_ids: linked.player_ids, team_ids: linked.team_ids, game_id: linked.game_id,
      article_slug: linked.article_slug, resolver_confidence: linked.resolver_confidence, linking: linked.linking
    });
  }

  const items = Object.values(store);
  await env.NEWS_KV.put('vid:v1:items', JSON.stringify(store));

  const byType = {};
  for (const v of items) byType[v.video_type] = (byType[v.video_type] || 0) + 1;
  const status = {
    at: startedAt,
    version: VIDEO_VERSION,
    status: runs.every((r) => r.status === 'PASS') ? 'PASS' : runs.some((r) => r.status === 'PASS') ? 'DEGRADED' : 'FAIL',
    discovery: key ? 'youtube_data_api_v3' : 'youtube_atom_feed+oembed',
    api_key_present: Boolean(key),
    allowlist_generated_at: CHANNELS_GENERATED_AT,
    identity: { teams: teams.length, players: players.length, games_in_window: games.length, errors: identityErrors },
    channels: runs,
    pending_channels: PENDING_CHANNELS.map((p) => ({ name: p.name, channel_id: p.channel_id, reason: p.reason })),
    totals: {
      channels_allowlisted: ALLOWED_CHANNELS.length,
      channels_ok: runs.filter((r) => r.status === 'PASS').length,
      videos_live: items.length,
      with_team: items.filter((v) => v.team_ids.length).length,
      with_player: items.filter((v) => v.player_ids.length).length,
      with_game: items.filter((v) => v.game_id).length,
      by_type: byType
    },
    embed_budget_left: embedBudget
  };
  await env.NEWS_KV.put('vid:v1:last_run', JSON.stringify(status));
  const hist = (await env.NEWS_KV.get('vid:v1:runs', 'json')) || [];
  await env.NEWS_KV.put('vid:v1:runs', JSON.stringify([status, ...hist].slice(0, 24)));
  await persistVideos(env, items).catch((e) => { status.supabase_error = e.message; });
  return status;
}

async function persistVideos(env, items) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !items.length) return;
  const up = async (table, rows, onConflict) => {
    if (!rows.length) return;
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows)
    });
    if (!res.ok) throw new Error(`supabase_${table}_${res.status}:${(await res.text()).slice(0, 200)}`);
  };
  await up('wnba_video_channels', ALLOWED_CHANNELS.map((c) => ({
    provider: 'youtube', channel_id: c.channel_id, name: c.name, channel_class: c.channel_class, team_id: c.team_id,
    source_verified: true, enabled: true, verification: c.verification, updated_at: new Date().toISOString()
  })), 'provider,channel_id');
  await up('wnba_videos', items.map((v) => ({
    id: v.id, provider: v.provider, provider_video_id: v.provider_video_id, channel_id: v.channel_id, channel_name: v.channel_name,
    source_verified: v.source_verified, url: v.url, title: v.title, description: v.description, published_at: v.published_at,
    duration_sec: v.duration_sec, thumbnail_url: v.thumbnail_url, embeddable: v.embeddable, live_broadcast_state: v.live_broadcast_state,
    video_type: v.video_type, player_ids: v.player_ids, team_ids: v.team_ids, game_id: v.game_id, article_slug: v.article_slug,
    resolver_confidence: v.resolver_confidence, source_metadata: { linking: v.linking, discovery: v.discovery, type_evidence: v.video_type_evidence },
    captured_at: v.captured_at, updated_at: v.updated_at
  })), 'id');
}
