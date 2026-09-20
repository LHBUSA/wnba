// Official game highlights (wnba-video/1.0.0): allowlist, discovery parsing, eligibility, the game resolver, availability,
// poster-first rendering and the CSP exception. Fixtures are real: the three verified channels' upload feeds and
// production newsroom stories captured read-only on 2026-09-13.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  allowedChannels, parseFeed, fromApiItem, discoverViaApi, oembedCheck, availability, highlightPackage, titleDates, titleRound,
  videoTargetOf, evaluateVideo, resolveGameVideo, servedVideo, runVideoPass, RENDERABLE
} from '../workers/wnba-news/src/video.js';
import { gameHighlights, embedUrl } from '../src/ui/video.js';
import { articleView } from '../src/views/article.js';
import { newsView } from '../src/views/news.js';
import { articleCard } from '../src/ui/articles.js';

const FX = 'tests/fixtures/video/';
const DOC = JSON.parse(fs.readFileSync('data/video-channels.json', 'utf8'));
const CHANNELS = allowedChannels(DOC);
const WNBA = 'UCO9a_ryN_l7DIDS-VIt-zmw';
const FIBA = 'UCtInrnU3QbWqFGsdKT1GZtg';
const USAB = 'UCBo3XgAVBeE74Zw0T77aDhw';
const S = JSON.parse(fs.readFileSync(`${FX}stories-2026-09-13.json`, 'utf8'));
const FEEDS = { [WNBA]: fs.readFileSync(`${FX}feed-wnba-2026-09-13.xml`, 'utf8'), [FIBA]: fs.readFileSync(`${FX}feed-fiba-2026-09-13.xml`, 'utf8'), [USAB]: fs.readFileSync(`${FX}feed-usab-2026-09-13.xml`, 'utf8') };
const NOW = Date.parse('2026-09-13T20:30:00Z');
const CHECKED = { method: 'oembed', status: 'embeddable', http: 200, checked_at: '2026-09-13T20:25:00Z' };
const feedVideos = () => Object.entries(FEEDS).flatMap(([id, xml]) => parseFeed(xml, id)).map((v) => ({ ...v, embed: CHECKED }));
const WNBA_UNIVERSE = S.wnba_teams.map((t) => ({ id: String(t.team_id), names: [t.name, `${t.location} ${t.short_name}`] }));
const INTL_UNIVERSE = [...new Map(S.intl_schedule.flatMap((g) => [g.home_team, g.away_team]).map((t) => [t.slug, { id: t.slug, names: [t.name, t.short_name, t.country_code] }])).values()];
const resolveStory = (a, videos = feedVideos(), extra = {}) => {
  const t = videoTargetOf(a, { schedule: S.intl_schedule });
  assert.equal(t.eligible, true, `eligible: ${t.reason}`);
  return resolveGameVideo(t.target, videos, { channels: CHANNELS, universe: a.kind === 'international' ? INTL_UNIVERSE : WNBA_UNIVERSE, now: NOW, ...extra });
};
const fake = (over) => ({ provider: 'youtube', video_id: 'AbCdEfGhIj0', channel_id: WNBA, channel_name: 'WNBA', title: '', published_at: '2026-08-31T03:00:00Z', is_short: false, duration_s: null, live_state: null, discovery: 'channel_feed', embed: CHECKED, ...over });

test('allowlist: only enabled, verified channels with exact channel IDs; handles are never identity', () => {
  assert.deepEqual(CHANNELS.map((c) => c.channel_id).sort(), [WNBA, FIBA, USAB].sort());
  for (const c of DOC.channels) {
    assert.match(c.channel_id, /^UC[\w-]{22}$/);
    assert.ok(c.verification?.checks?.official_site_link?.pass && c.verification.checks.canonical.pass && c.verification.checks.feed_title.pass, `${c.name} carries its verification evidence`);
  }
  assert.equal(allowedChannels({ channels: [{ ...DOC.channels[0], verified: false }] }).length, 0, 'unverified channel is not allowed');
  assert.equal(allowedChannels({ channels: [{ ...DOC.channels[0], enabled: false }] }).length, 0, 'disabled channel is not allowed');
  assert.equal(allowedChannels({ channels: [{ ...DOC.channels[0], channel_id: '@WNBA' }] }).length, 0, 'a handle is not a channel ID');
});

test('discovery: feed parsing keeps channel identity; shorts flagged; API mapping; key never echoed', async () => {
  const w = parseFeed(FEEDS[WNBA], WNBA);
  assert.equal(w.length, 15);
  assert.ok(w.every((v) => v.channel_id === WNBA && /^[\w-]{11}$/.test(v.video_id)));
  assert.throws(() => parseFeed(FEEDS[WNBA], FIBA), /feed_channel_mismatch/);
  assert.equal(parseFeed(FEEDS[FIBA], FIBA).filter((v) => v.is_short).length, 12);
  const api = fromApiItem({ id: 'VCl0Hf_yDYM', snippet: { channelId: WNBA, channelTitle: 'WNBA', title: 't', publishedAt: '2026-08-31T03:16:26Z', liveBroadcastContent: 'none' }, contentDetails: { duration: 'PT9M41S', regionRestriction: { blocked: ['CA'] } }, status: { embeddable: true, privacyStatus: 'public', uploadStatus: 'processed' } }, '2026-09-13T20:00:00Z');
  assert.equal(api.duration_s, 581);
  assert.equal(api.embed.status, 'embeddable');
  const calls = [];
  const getJson = async (u) => {
    calls.push(u.replace(/key=[^&]+/, 'key=K'));
    if (u.includes('/channels?')) return { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUO9a_ryN_l7DIDS-VIt-zmw' } } }] };
    if (u.includes('/playlistItems?')) return { items: [{ contentDetails: { videoId: 'VCl0Hf_yDYM' } }] };
    if (u.includes('/videos?')) return { items: [{ id: 'VCl0Hf_yDYM', snippet: { channelId: WNBA, title: 'x', publishedAt: '2026-08-31T03:16:26Z', liveBroadcastContent: 'none' }, contentDetails: { duration: 'PT10M' }, status: { embeddable: true, privacyStatus: 'public', uploadStatus: 'processed' } }] };
    throw new Error('unexpected');
  };
  const found = await discoverViaApi(CHANNELS.find((c) => c.channel_id === WNBA), { key: 'SECRETKEY', getJson, now: '2026-09-13T20:00:00Z' });
  assert.equal(found.length, 1);
  assert.ok(calls.every((u) => !u.includes('search')), 'search.list is never used');
  await assert.rejects(discoverViaApi(CHANNELS[0], { key: 'SECRETKEY', getJson: async (u) => { throw new Error(`403 for ${u}`); }, now: 'x' }), (e) => !e.message.includes('SECRETKEY'));
});

test('titles: highlight packages only; rounds read longest-first; dates parsed', () => {
  assert.equal(highlightPackage('Connecticut Sun vs. Dallas Wings | FULL GAME HIGHLIGHTS | August 30, 2026').ok, true);
  for (const [t, reason] of [
    ['Breanna Stewart and Kara Lawson | USA vs Spain Press Conference | September 12, 2026', 'press_conference'],
    ['Chat Party Powered by SMART ⚡🏀  USA  v France | FIBA Women\'s Basketball World Cup 2026', 'live_stream'],
    ['Iyana Martin (22 PTS) is a STAR! | TCL Player Of The Game | ESP v GER', 'player_package'],
    ['CC12 Wired for Sound | Caitlin Clark Mic\'d Up with the USABWNT', 'mic_d_up'],
    ['This USA play to END THE HALF 🤯🔥 #FIBAWWC', 'short_or_hashtag_clip'],
    ['A\'ja Wilson Career Highlights', 'montage']
  ]) assert.equal(highlightPackage(t).reason, reason, t);
  assert.deepEqual(titleRound('Semi-Finals | Spain v USA | Extended Highlights'), ['SF']);
  assert.deepEqual(titleRound('Final | USA v France | Extended Highlights'), ['FINAL']);
  assert.deepEqual(titleRound('Bronze Medal Game | Germany v Spain'), ['BRONZE']);
  assert.deepEqual(titleDates('HIGHLIGHTS: USA vs Spain | 2026 FIBA Women\'s World Cup | September 12, 2026'), ['2026-09-12']);
  assert.deepEqual(titleDates('Game on 13 September 2026'), ['2026-09-13']);
});

test('A. final game recap → the correct official highlight, with auditable evidence', () => {
  const d = resolveStory(S.stories.result);
  assert.equal(d.status, 'attached');
  assert.equal(d.video.video_id, 'VCl0Hf_yDYM');
  assert.equal(d.video.channel_id, WNBA);
  assert.equal(d.confidence, 'high');
  assert.equal(d.evidence.game_key, `wnba:${S.stories.result.context.game.game_id}`);
  assert.ok(d.evidence.checks.some((c) => /title date 2026-08-30 = game date/.test(c)));
  assert.ok(d.evidence.checks.some((c) => /Connecticut Sun and Dallas Wings both named/.test(c)));
  assert.ok(RENDERABLE.has(d.video.availability));
});

test('B. a big performance tied to that game → the same game highlight', () => {
  const perf = resolveStory(S.stories.performance);
  assert.equal(perf.status, 'attached');
  assert.equal(perf.video.video_id, 'SnVi60cS7FU');
  const sameGame = resolveStory({ ...S.stories.result, kind: 'performance', id: 'perf-same-game' });
  assert.equal(sameGame.video.video_id, 'VCl0Hf_yDYM');
  assert.equal(videoTargetOf({ ...S.stories.result, kind: 'performance' }).reason, 'single_game_performance');
});

test('C/D. same teams on two dates stay distinct; an old highlight with the same teams is rejected', () => {
  const aug15 = fake({ video_id: 'OldSunWings', title: 'Dallas Wings vs. Connecticut Sun | FULL GAME HIGHLIGHTS | August 15, 2026', published_at: '2026-08-16T02:40:00Z' });
  const both = [...feedVideos(), aug15];
  assert.equal(resolveStory(S.stories.result, both).video.video_id, 'VCl0Hf_yDYM', 'Aug 30 story gets the Aug 30 video');
  const earlier = { ...S.stories.result, context: { ...S.stories.result.context, game: { ...S.stories.result.context.game, game_id: '401850001', start_utc: '2026-08-15T23:30Z' } } };
  assert.equal(resolveStory(earlier, both).video.video_id, 'OldSunWings', 'Aug 15 story gets the Aug 15 video');
  // Only the old video exists (re-surfaced late): its title date names another game.
  const d = resolveStory(S.stories.result, [fake({ video_id: 'OldSunWings', title: aug15.title, published_at: '2026-08-31T04:00:00Z' })]);
  assert.equal(d.status, 'no_match');
  assert.equal(d.rejected[0].reason, 'title_date_is_another_game');
});

test('E. a player name match without the game\'s teams and date is rejected', () => {
  const d = resolveStory(S.stories.performance, [fake({ video_id: 'MalongaClip', title: 'Dominique Malonga Highlights | Seattle Storm vs. Dallas Wings | August 30, 2026', published_at: '2026-08-31T01:00:00Z' })]);
  assert.equal(d.status, 'no_match');
  assert.match(d.rejected[0].reason, /only_one_team_named|another_team_named/);
});

test('F/G/H. transactions, generic injury updates and previews get no video', () => {
  assert.deepEqual([videoTargetOf(S.stories.transaction).reason, videoTargetOf(S.stories.injury).reason, videoTargetOf(S.stories.preview).reason, videoTargetOf(S.stories.trend).reason],
    ['transaction', 'injury_update_not_tied_to_a_completed_game', 'preview_of_a_future_game', 'trend_spans_many_games']);
  for (const k of ['transaction', 'injury', 'preview']) {
    assert.equal(videoTargetOf(S.stories[k]).eligible, false);
    assert.doesNotMatch(String(articleView({ article: { ...S.stories[k], media: null, video: null }, related: [] })), /game-highlights|youtube/i);
  }
  assert.equal(videoTargetOf({ ...S.stories.result, quality_state: 'retired_from_index' }).eligible, false);
  assert.equal(videoTargetOf({ ...S.stories.result, context: { ...S.stories.result.context, game: { ...S.stories.result.context.game, home: { ...S.stories.result.context.game.home, score: null } } } }).reason, 'game_not_completed');
});

test('I. deleted / private / unembeddable / live / unchecked / stale videos never produce a player', async () => {
  const cases = [
    [{ status: 'not_embeddable', http: 401 }, 'unembeddable'],
    [{ status: 'unavailable', http: 404 }, 'unavailable'],
    [{ status: 'error', http: null }, 'unchecked']
  ];
  for (const [embed, state] of cases) {
    const videos = feedVideos().map((v) => (v.video_id === 'VCl0Hf_yDYM' ? { ...v, embed: { method: 'oembed', checked_at: '2026-09-13T20:25:00Z', ...embed } } : v));
    const d = resolveStory(S.stories.result, videos);
    assert.equal(d.status, 'unplayable');
    assert.equal(d.reason, state);
    assert.equal(servedVideo(d, { now: NOW }), null);
    const page = String(articleView({ article: { ...S.stories.result, media: null, video: servedVideo(d, { now: NOW }) }, related: [] }));
    assert.doesNotMatch(page, /game-highlights|<iframe/);
    assert.match(page, /The Dallas Wings beat the Connecticut Sun/);
  }
  assert.equal(availability(fake({ live_state: 'live' }), { now: NOW }), 'live_not_completed');
  assert.equal(availability(fake({ privacy_status: 'private' }), { now: NOW }), 'unavailable');
  assert.equal(availability(fake({ region_restriction: { blocked: ['US'] } }), { now: NOW }), 'blocked');
  assert.equal(availability(fake({ video_id: 'bad id' }), { now: NOW }), 'invalid');
  const ok = resolveStory(S.stories.result);
  assert.ok(servedVideo(ok, { now: NOW }));
  assert.equal(servedVideo(ok, { now: NOW + 25 * 3600e3 }), null, 'a check older than 24 h fails closed');
  const mk = (status) => async () => ({ status, json: async () => ({ author_url: 'https://www.youtube.com/@WNBA' }) });
  assert.equal((await oembedCheck('VCl0Hf_yDYM', { fetchImpl: mk(200), now: 'x' })).status, 'embeddable');
  assert.equal((await oembedCheck('VCl0Hf_yDYM', { fetchImpl: mk(401), now: 'x' })).status, 'not_embeddable');
  assert.equal((await oembedCheck('VCl0Hf_yDYM', { fetchImpl: mk(404), now: 'x' })).status, 'unavailable');
  assert.equal((await oembedCheck('VCl0Hf_yDYM', { fetchImpl: () => new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('t'), { name: 'AbortError' })), 5)), now: 'x' })).reason, 'timeout');
  assert.equal((await oembedCheck('../etc', { fetchImpl: mk(200), now: 'x' })).reason, 'malformed_id');
});

test('J. two equally plausible videos → review, nothing attached', () => {
  const dup = fake({ video_id: 'ReuploadSun', title: 'Connecticut Sun vs. Dallas Wings | GAME HIGHLIGHTS | August 30, 2026', published_at: '2026-08-31T05:00:00Z' });
  const d = resolveStory(S.stories.result, [...feedVideos(), dup]);
  assert.equal(d.status, 'review');
  assert.equal(d.reason, 'multiple_matching_videos_on_one_channel');
  assert.equal(servedVideo(d), null);
  const twin = { ...CHANNELS.find((c) => c.channel_id === WNBA), channel_id: 'UCzzzzzzzzzzzzzzzzzzzzzz', name: 'Twin official' };
  const e = resolveStory(S.stories.result, [...feedVideos(), { ...dup, channel_id: twin.channel_id }], { channels: [...CHANNELS, twin] });
  assert.equal(e.reason, 'equally_plausible_videos_from_equal_priority_channels');
});

test('K. a perfect-looking fan upload from a channel that is not allowlisted is rejected', () => {
  const fan = fake({ video_id: 'FanUpload01', channel_id: 'UCfanfanfanfanfanfanfanf', channel_name: 'WNBA Highlights HD', title: 'Connecticut Sun vs. Dallas Wings | FULL GAME HIGHLIGHTS | August 30, 2026' });
  const d = resolveStory(S.stories.result, [fan]);
  assert.equal(d.status, 'no_match');
  assert.equal(evaluateVideo(fan, videoTargetOf(S.stories.result).target, undefined).reason, 'channel_not_allowlisted');
});

test('international: separate namespace, round/date/competition evidence, federation scope, no guessing', () => {
  const gold = resolveStory(S.stories.intl);
  assert.equal(gold.status, 'no_match', 'no official gold-medal highlight package had been published at capture time');
  assert.ok(gold.rejected.some((r) => r.reason === 'live_stream'), 'the live chat stream is not a highlight');
  const t = videoTargetOf(S.stories.intl).target;
  assert.equal(t.namespace, 'intl');
  assert.equal(t.key, 'intl:world-cup-2026:401917260');
  assert.ok(t.wnba_player_ids.length > 0);
  // The real semi-final USA–Spain (401917257): FIBA extended highlights (undated: round + competition) and USA Basketball's dated package both match; the competition organizer ranks first.
  const sf = S.intl_schedule.find((g) => g.provider_ids.espn === '401917257');
  const sfTarget = { ...t, key: 'intl:world-cup-2026:401917257', game_id: '401917257', round: 'SF', start_utc: sf.scheduled_at, teams: [{ id: 'usa', names: ['United States', 'USA'] }, { id: 'spain', names: ['Spain', 'ESP'] }] };
  const d = resolveGameVideo(sfTarget, feedVideos(), { channels: CHANNELS, universe: INTL_UNIVERSE, now: NOW });
  assert.equal(d.status, 'attached');
  assert.equal(d.video.video_id, 'aR9KZRCy17I');
  assert.equal(d.evidence.also_matched[0].video_id, 'OgZmJl_EGmo');
  assert.ok(d.evidence.checks.includes('title round SF = game round'));
  // A WNBA channel video can never match an international game, and the reverse.
  assert.equal(evaluateVideo(fake({ title: 'United States vs. Spain | FULL GAME HIGHLIGHTS | September 12, 2026', published_at: '2026-09-12T21:00:00Z' }), sfTarget, CHANNELS.find((c) => c.channel_id === WNBA)).reason, 'channel_namespace_mismatch');
  assert.equal(evaluateVideo(fake({ channel_id: FIBA }), videoTargetOf(S.stories.result).target, CHANNELS.find((c) => c.channel_id === FIBA)).reason, 'channel_namespace_mismatch');
  // USA Basketball is scoped to USA games; a final-round video does not match a semi-final.
  const bronze = { ...sfTarget, round: 'BRONZE', teams: [{ id: 'germany', names: ['Germany', 'GER'] }, { id: 'spain', names: ['Spain', 'ESP'] }] };
  assert.equal(evaluateVideo(parseFeed(FEEDS[USAB], USAB)[0], bronze, CHANNELS.find((c) => c.channel_id === USAB)).reason, 'channel_team_scope');
  assert.equal(evaluateVideo(fake({ channel_id: FIBA, title: 'Final | Spain v USA | Extended Highlights | FIBA Women\'s Basketball World Cup 2026', published_at: '2026-09-13T20:00:00Z' }), sfTarget, CHANNELS.find((c) => c.channel_id === FIBA), { universe: INTL_UNIVERSE }).reason, 'title_round_is_another_game');
  assert.equal(evaluateVideo(fake({ channel_id: FIBA, title: 'USA v Spain | Highlights | Olympic Basketball Tournament Paris 2024', published_at: '2026-09-13T20:00:00Z' }), sfTarget, CHANNELS.find((c) => c.channel_id === FIBA), { universe: INTL_UNIVERSE }).reason, 'another_competition_named');
  // Generic international story with no current WNBA player is not eligible.
  assert.equal(videoTargetOf({ ...S.stories.intl, entities: S.stories.intl.entities.filter((e) => e.type !== 'player') }).reason, 'no_current_wnba_player_in_game');
});

test('L. a valid official video → youtube-nocookie embed only; poster markup loads nothing from YouTube', () => {
  const v = servedVideo(resolveStory(S.stories.result), { now: NOW });
  assert.equal(v.embed_url, 'https://www.youtube-nocookie.com/embed/VCl0Hf_yDYM');
  assert.equal(embedUrl('VCl0Hf_yDYM', 'https://wnba.propbetedge.ai'), 'https://www.youtube-nocookie.com/embed/VCl0Hf_yDYM?rel=0&autoplay=1&playsinline=1&enablejsapi=1&origin=https%3A%2F%2Fwnba.propbetedge.ai');
  const block = String(gameHighlights({ ...S.stories.result, video: v }));
  assert.match(block, /class="game-highlights"/);
  assert.match(block, /data-gh-play="VCl0Hf_yDYM"/);
  assert.match(block, /Official video · <b>WNBA<\/b> on YouTube/);
  assert.equal(String(gameHighlights({ ...S.stories.result, video: { ...v, video_id: '"><script>' } })), '', 'malformed ID renders nothing');
});

test('M. page load without a click requests nothing from YouTube; the CSP exception is frame-src only', () => {
  const v = servedVideo(resolveStory(S.stories.result), { now: NOW });
  const page = String(articleView({ article: { ...S.stories.result, media: null, video: v }, related: [] }));
  assert.doesNotMatch(page, /<iframe/);
  assert.doesNotMatch(page, /(src|srcset|poster)="[^"]*(youtube|ytimg|googlevideo)/i);
  for (const m of page.matchAll(/<img[^>]+src="([^"]+)"/g)) assert.match(m[1], /^\//, `self-hosted image: ${m[1]}`);
  // The highlight sits after the opening section, inside the story body.
  assert.ok(page.indexOf('game-highlights') > page.indexOf('<h2>') && page.indexOf('game-highlights') < page.indexOf('story-aside'));
  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8')).headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
  const web = fs.readFileSync('workers/wnba-web/src/index.js', 'utf8').match(/'content-security-policy': "([^"]+)"/)[1];
  assert.equal(web, vercel, 'SSR and static CSP agree');
  assert.match(vercel, /frame-src https:\/\/www\.youtube-nocookie\.com;/);
  assert.match(vercel, /default-src 'self';/);
  assert.match(vercel, /img-src 'self' data:;/);
  assert.match(vercel, /script-src 'self';/);
  assert.doesNotMatch(vercel, /youtube\.com(?!-)|ytimg/);
  const css = fs.readFileSync('src/styles/newsroom.css', 'utf8');
  assert.match(css, /\.gh-frame \{[^}]*aspect-ratio: 16 \/ 9/);
  assert.match(css, /\.gh-frame \{[^}]*max-width: 100%/);
});

test('N. the newsroom recap desk is video-first but poster-only until a reader clicks play', () => {
  const now = Date.now();
  const recap = {
    id: 'video-recap-1',
    slug: 'dream-beat-sky-video-recap',
    kind: 'result',
    category: 'Results',
    headline: 'The Atlanta Dream beat the Chicago Sky, 106–81',
    deck: 'Final-score recap with official game highlights.',
    status: 'published',
    published_at: new Date(now - 30 * 60e3).toISOString(),
    first_published_at: new Date(now - 30 * 60e3).toISOString(),
    entities: [{ type: 'game', id: '401999001', name: 'CHI @ ATL', start_utc: new Date(now - 2 * 3600e3).toISOString() }],
    media: null,
    video: { provider: 'youtube', video_id: 'VCl0Hf_yDYM', title: 'Chicago Sky vs Atlanta Dream | GAME HIGHLIGHTS', channel_name: 'WNBA', duration_s: 581 }
  };
  const out = String(newsView({
    arts: { ok: true, data: { items: [recap], total: 1 }, meta: { last_run_at: new Date(now).toISOString() } },
    wire: { ok: true, data: { items: [] } },
    teams: [],
    archive: { ok: false },
    previews: { ok: false },
    today: { ok: false }
  }).body);
  assert.match(out, /class="video-recap-stage"/);
  assert.match(out, /data-gh-play="VCl0Hf_yDYM"/);
  assert.match(out, /Watch highlights/);
  assert.match(out, /href="\/news\/dream-beat-sky-video-recap">Read recap →<\/a>/);
  assert.doesNotMatch(out, /<iframe/);
  assert.doesNotMatch(out, /(src|srcset|poster)="[^"]*(youtube|ytimg|googlevideo)/i);
});

test('O. a story without a video renders exactly as before, with no empty media box; cards stay iframe-free', () => {
  const a = { ...S.stories.result, media: null };
  const without = String(articleView({ article: a, related: [] }));
  assert.equal(String(articleView({ article: { ...a, video: null }, related: [] })), without);
  assert.doesNotMatch(without, /game-highlights|gh-frame/);
  const card = { id: 'x', slug: 's', kind: 'result', headline: 'h', deck: 'd', entities: [], media: null, published_at: '2026-09-01T00:00:00Z' };
  assert.doesNotMatch(String(articleCard(card)), /Highlights/);
  const withVideo = String(articleCard({ ...card, video: { title: 'Connecticut Sun vs. Dallas Wings | FULL GAME HIGHLIGHTS', channel_name: 'WNBA' } }));
  assert.match(withVideo, /class="scard-video"/);
  assert.doesNotMatch(withVideo, /iframe|youtube/i);
});

test('scheduled pass: bounded discovery, a decision with a reason for every story, one video per game', async () => {
  const mem = new Map();
  const kv = { get: async (k, t) => (mem.has(k) ? (t === 'json' ? JSON.parse(mem.get(k)) : mem.get(k)) : null), put: async (k, v) => { mem.set(k, v); } };
  const stories = { r1: S.stories.result, p1: S.stories.performance, i1: S.stories.intl, t1: S.stories.transaction, j1: S.stories.injury, v1: S.stories.preview };
  mem.set('art:v1:index', JSON.stringify(Object.entries(stories).map(([id, a]) => ({ id, slug: a.slug, kind: a.kind }))));
  for (const [id, a] of Object.entries(stories)) mem.set(`art:v1:item:${id}`, JSON.stringify({ ...a, id }));
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    const id = url.match(/channel_id=(UC[\w-]{22})/)?.[1];
    if (id) return { ok: true, status: 200, text: async () => FEEDS[id] };
    if (url.includes('/oembed?')) return { ok: true, status: 200, json: async () => ({ author_url: 'https://www.youtube.com/@WNBA' }) };
    throw new Error(`unexpected ${url}`);
  };
  const status = await runVideoPass({ NEWS_KV: kv }, { channelsDoc: DOC, teams: S.wnba_teams, intlGet: async () => ({ games: S.intl_schedule }), fetchImpl, force: true, now: NOW });
  assert.equal(status.discovery, 'channel_feed+oembed');
  assert.ok(requested.every((u) => /^https:\/\/www\.youtube\.com\/(feeds\/videos\.xml|oembed)\?/.test(u)), 'only the feed and oEmbed endpoints are called');
  assert.ok(requested.filter((u) => u.includes('/oembed?')).length <= 25);
  const { decisions } = JSON.parse(mem.get('video:v1:links'));
  assert.equal(decisions.r1.status, 'attached');
  assert.equal(decisions.p1.status, 'attached');
  assert.equal(decisions.i1.status, 'no_match');
  assert.deepEqual([decisions.t1.status, decisions.j1.status, decisions.v1.status], ['ineligible', 'ineligible', 'ineligible']);
  assert.ok(Object.values(decisions).every((d) => d.reason));
  assert.ok(servedVideo(decisions.r1, { now: NOW }));
  // One video cannot illustrate two different games: a same-day same-teams second game makes both stories review.
  const twin = { ...S.stories.result, id: 'r2', context: { ...S.stories.result.context, game: { ...S.stories.result.context.game, game_id: '401899999' } } };
  mem.set('art:v1:index', JSON.stringify([...JSON.parse(mem.get('art:v1:index')), { id: 'r2', slug: 'twin', kind: 'result' }]));
  mem.set('art:v1:item:r2', JSON.stringify(twin));
  await runVideoPass({ NEWS_KV: kv }, { channelsDoc: DOC, teams: S.wnba_teams, fetchImpl, force: true, now: NOW });
  const again = JSON.parse(mem.get('video:v1:links')).decisions;
  assert.deepEqual([again.r1.status, again.r2.status, again.r1.reason], ['review', 'review', 'video_matches_more_than_one_game']);
  assert.equal(servedVideo(again.r1, { now: NOW }), null);
  mem.set('art:v1:index', JSON.stringify(JSON.parse(mem.get('art:v1:index')).filter((c) => c.id !== 'r2')));
  await runVideoPass({ NEWS_KV: kv }, { channelsDoc: DOC, teams: S.wnba_teams, fetchImpl, force: true, now: NOW });
  // Cadence: a second pass inside the window is skipped (no extra requests).
  const before = requested.length;
  assert.equal((await runVideoPass({ NEWS_KV: kv }, { channelsDoc: DOC, teams: S.wnba_teams, fetchImpl, now: NOW + 60e3 })).skipped, 'cadence');
  assert.equal(requested.length, before);
});
