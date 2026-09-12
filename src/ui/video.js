// Official video — poster-first player and cards.
//
// Rules this module enforces, so no page has to remember them:
//   * nothing from youtube-nocookie.com is requested until a real user click. The
//     markup a page renders contains a poster image and a button, never an iframe.
//   * the poster is YouTube's own thumbnail, hotlinked from ytimg (never rehosted),
//     inside an explicit 16:9 box so the module reserves its space and shifts nothing.
//   * a thumbnail that 404s steps down through the smaller frames and then disappears
//     into the team composition — a broken image never renders.
//   * playback runs in YouTube's privacy-enhanced player with YouTube's own controls
//     and branding. We add nothing to it and take nothing away.
//   * every card names the channel that published the video. Video is source media:
//     nothing here infers availability, condition, tactics or a betting angle from it.
import { html } from '../lib/dom.js';
import { relTime } from '../lib/format.js';
import { logoEntry, teamColors } from './logo.js';

export const TYPE_LABEL = {
  highlights: 'Highlights',
  game_recap: 'Game recap',
  preview: 'Preview',
  interview: 'Interview',
  press_conference: 'Press conference',
  practice: 'Practice',
  feature: 'Feature',
  analysis: 'Analysis',
  postgame: 'Postgame',
  live_stream: 'Live',
  other: 'Video'
};

const CLASS_LABEL = { league_official: 'Official · WNBA', team_official: 'Official · team', broadcast_partner: 'Broadcast partner' };

const YT_ID = /^[A-Za-z0-9_-]{6,20}$/;

/** Poster candidates, largest first. maxres does not exist for every upload, so the
 *  error handler steps down; hqdefault is 4:3 and is centre-cropped by the 16:9 box,
 *  which removes exactly YouTube's letterbox bars. */
function posterCandidates(v) {
  const id = v.provider_video_id;
  const list = [`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`];
  // Whatever the provider itself handed us, normalised onto the canonical image host.
  if (v.thumbnail_url) {
    const norm = String(v.thumbnail_url).replace(/^https:\/\/i\d\.ytimg\.com/, 'https://i.ytimg.com');
    if (/^https:\/\/i\.ytimg\.com\//.test(norm) && !list.includes(norm)) list.push(norm);
  }
  return list;
}

export function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

const PLAY = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>`;

/** The team composition a card falls back to when there is no usable thumbnail. */
function teamBackdrop(v) {
  const tid = (v.team_ids || [])[0];
  const e = tid ? logoEntry(tid) : null;
  const c = teamColors({ team_id: tid });
  return html`<span class="vid-fallback" style="--tc:${c.color || '#d4af37'}">${e ? html`<img src="${e.files['320']}" alt="" width="320" height="320" loading="lazy" decoding="async" />` : ''}</span>`;
}

/**
 * The 16:9 media box: poster + play control, or, for a video we could not prove
 * embeddable, a link out with no player at all.
 *
 * slot: 'feature' | 'card' | 'rail'.  eager: the one intentional above-fold poster.
 */
export function videoMedia(v, { slot = 'card', eager = false } = {}) {
  const ok = v.embeddable === true && YT_ID.test(String(v.provider_video_id || ''));
  const cands = posterCandidates(v);
  const dur = fmtDuration(v.duration_sec);
  const live = v.live_broadcast_state === 'live';
  const poster = html`${teamBackdrop(v)}<img class="vid-poster" data-vid-poster src="${cands[0]}" data-alt="${cands.slice(1).join('|')}" alt="" width="1280" height="720" ${eager ? html`fetchpriority="high"` : html`loading="lazy"`} decoding="async" />
    <span class="vid-scrim" aria-hidden="true"></span>
    ${live ? html`<span class="vid-live">Live</span>` : html`<span class="vid-kind">${TYPE_LABEL[v.video_type] || TYPE_LABEL.other}</span>`}
    ${dur ? html`<span class="vid-dur mono">${dur}</span>` : ''}`;

  if (!ok) {
    return html`<div class="vid-frame vid-frame--off">${poster}
      <a class="vid-out" href="${v.url}" rel="noopener nofollow" target="_blank">Watch on YouTube ↗<small>This upload cannot be embedded</small></a>
    </div>`;
  }
  return html`<div class="vid-frame" data-vid="${v.provider_video_id}" data-vid-title="${v.title}">
    ${poster}
    <button class="vid-play" type="button" data-vid-play aria-label="Play: ${v.title}">${PLAY}</button>
  </div>`;
}

const sourceLabel = (v) => `${CLASS_LABEL[v.channel_class] || 'Official'} · ${v.channel_name}`;

/** Attribution + timestamp line. Shown on every surface a video appears on. */
export function videoCredit(v) {
  return html`<span class="vid-cred"><b>${v.channel_name}</b><span class="vid-cred-sep">·</span>${CLASS_LABEL[v.channel_class] || 'Official channel'}<span class="vid-cred-sep">·</span>${relTime(v.published_at)}<span class="vid-cred-sep">·</span><a href="${v.url}" rel="noopener nofollow" target="_blank">YouTube ↗</a></span>`;
}

/** Standard card. size: 'feature' | 'card' | 'rail'. */
export function videoCard(v, { size = 'card', eager = false } = {}) {
  return html`<article class="vcard vcard--${size}">
    ${videoMedia(v, { slot: size, eager })}
    <div class="vcard-body">
      <div class="vcard-kicker"><span class="cat">${TYPE_LABEL[v.video_type] || TYPE_LABEL.other}</span><span class="vcard-src">${sourceLabel(v)}</span></div>
      <h3 class="vcard-h">${v.title}</h3>
      ${videoCredit(v)}
    </div>
  </article>`;
}

/** One strong video plus a short list of secondary ones. */
export function videoFeature(v, rest = [], { eager = false } = {}) {
  return html`<div class="vfeature">
    ${videoCard(v, { size: 'feature', eager })}
    ${rest.length ? html`<div class="vfeature-side">${rest.map((x) => videoRow(x))}</div>` : ''}
  </div>`;
}

/** Compact row for sidebars and expandable rails. */
export function videoRow(v) {
  return html`<article class="vrow">
    ${videoMedia(v, { slot: 'rail' })}
    <div class="vrow-body">
      <div class="vcard-kicker"><span class="cat">${TYPE_LABEL[v.video_type] || TYPE_LABEL.other}</span><span class="scard-time">${relTime(v.published_at)}</span></div>
      <h3 class="vrow-h">${v.title}</h3>
      <span class="vid-cred"><b>${v.channel_name}</b></span>
    </div>
  </article>`;
}

/** Horizontal scroll rail (team pages, player pages with enough content). */
export function videoRail(items) {
  return html`<div class="vrail">${items.map((v) => videoCard(v, { size: 'rail' }))}</div>`;
}

/** Shared footer note. Says exactly what the module is and is not. */
export const VIDEO_NOTE = 'Official WNBA, WNBA team and league-authorised channels only, played in YouTube’s privacy-enhanced player. PropBetEdge does not host or edit this video and draws no availability, condition or betting conclusion from it.';

// ------------------------------------------------------------ behaviour

let wired = false;

/**
 * One document-level pair of listeners for the whole app: a click that swaps a poster
 * for the player, and a capture-phase error that steps a failed poster down its
 * candidates. Registered once, so a router re-render never leaks a handler.
 */
export function wireVideo() {
  if (wired || typeof document === 'undefined') return;
  wired = true;

  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-vid-play]');
    if (!btn) return;
    e.preventDefault();
    const frame = btn.closest('.vid-frame');
    const id = frame?.dataset.vid;
    if (!frame || !id || !YT_ID.test(id) || frame.querySelector('iframe')) return;

    const p = new URLSearchParams({ rel: '0', playsinline: '1', modestbranding: '0' });
    // autoplay is attached ONLY to a frame created by a trusted user gesture; it is
    // never present in rendered markup, so a page load never plays anything.
    if (e.isTrusted) p.set('autoplay', '1');
    const iframe = document.createElement('iframe');
    iframe.className = 'vid-iframe';
    iframe.src = `https://www.youtube-nocookie.com/embed/${id}?${p}`;
    iframe.title = frame.dataset.vidTitle || 'WNBA video';
    iframe.width = '1280';
    iframe.height = '720';
    iframe.allow = 'accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.classList.add('vid-frame--playing');
    frame.append(iframe);
    btn.remove();
  });

  // `error` does not bubble, so this listens in the capture phase.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.hasAttribute('data-vid-poster')) return;
    const alts = (img.dataset.alt || '').split('|').filter(Boolean);
    if (alts.length) {
      img.dataset.alt = alts.slice(1).join('|');
      img.src = alts[0];
      return;
    }
    // Out of candidates: drop the image so a broken frame can never render. The team
    // composition underneath it becomes the poster.
    img.closest('.vid-frame')?.classList.add('vid-frame--noposter');
    img.remove();
  }, true);
}
