// Game Highlights — the official video a newsroom story may carry (decided by wnba-news, src/video.js).
//
// Poster-first: the page renders our own poster (team marks or flags, the final score, the video title and its
// official source) from this domain. Nothing is requested from YouTube until the reader presses play; then a
// privacy-enhanced youtube-nocookie.com player is inserted (autoplay only because the reader just asked to play).
// If the player reports that the video cannot be played here, the player is removed and the reader gets a plain
// link to watch it on YouTube. A story without a verified video renders nothing at all.

import { html } from '../lib/dom.js';
import { logoEntry } from './logo.js';

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The only embed URL this site builds. */
export const embedUrl = (id, origin = '') => `https://www.youtube-nocookie.com/embed/${id}?rel=0&autoplay=1&playsinline=1&enablejsapi=1${origin ? `&origin=${encodeURIComponent(origin)}` : ''}`;

const flagSrc = (f) => (/^\/media\/flags\/[a-z]{3}\.svg$/.test(String(f || '')) ? f : null);
const duration = (s) => (Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : null);

function side(t) {
  if (t.flag !== undefined) {
    const f = flagSrc(t.flag);
    return html`<span class="gh-side">${f ? html`<img class="gh-flag" src="${f}" alt="" width="60" height="40" loading="lazy" decoding="async" />` : ''}<span class="gh-name">${t.name}</span><b class="gh-score">${t.score ?? ''}</b></span>`;
  }
  const e = logoEntry({ team_id: t.team_id, abbr: t.abbr });
  return html`<span class="gh-side">${e ? html`<img class="gh-mark" src="${e.files['320']}" alt="" width="320" height="320" loading="lazy" decoding="async" />` : ''}<span class="gh-name">${t.short_name || t.name}</span><b class="gh-score">${t.score ?? ''}</b></span>`;
}

/** Poster art from the story's own structured game (never from the video's thumbnail). */
function posterArt(a) {
  const g = a.context?.game;
  const i = a.context?.international;
  const pair = g?.home && g?.away ? [g.away, g.home] : i?.winner && i?.loser ? [i.winner, i.loser] : null;
  if (!pair) return '';
  return html`<span class="gh-art" aria-hidden="true">${side(pair[0])}<span class="gh-vs">Final</span>${side(pair[1])}</span>`;
}

export function gameHighlights(a) {
  const v = a?.video;
  if (!v || v.provider !== 'youtube' || !VIDEO_ID.test(v.video_id || '')) return '';
  const len = duration(v.duration_s);
  const watch = `https://www.youtube.com/watch?v=${v.video_id}`;
  return html`<section class="game-highlights" aria-labelledby="gh-h-${v.video_id}">
    <div class="gh-head"><span class="module-kicker">Game Highlights</span><h2 id="gh-h-${v.video_id}">${v.title}</h2></div>
    <div class="gh-frame" data-gh-frame>
      <button class="gh-poster" type="button" data-gh-play="${v.video_id}" data-gh-title="${v.title}" aria-label="${`Play video: ${v.title}. Loads the YouTube player.`}">
        ${posterArt(a)}
        <span class="gh-play" aria-hidden="true"><svg viewBox="0 0 68 48" width="68" height="48"><path d="M66.5 7.7a8.5 8.5 0 0 0-6-6C55.3.3 34 .3 34 .3s-21.3 0-26.5 1.4a8.5 8.5 0 0 0-6 6C.1 13 .1 24 .1 24s0 11 1.4 16.3a8.5 8.5 0 0 0 6 6C12.7 47.7 34 47.7 34 47.7s21.3 0 26.5-1.4a8.5 8.5 0 0 0 6-6C67.9 35 67.9 24 67.9 24s0-11-1.4-16.3Z" fill="currentColor"/><path d="M27 34V14l18 10-18 10Z" fill="#0b0b0d"/></svg></span>
        <span class="gh-meta"><span>Play highlights</span>${len ? html`<span class="gh-len">${len}</span>` : ''}</span>
      </button>
    </div>
    <p class="gh-credit">Official video · <b>${v.channel_name}</b> on YouTube · plays in YouTube’s privacy-enhanced mode when you press play · <a href="${watch}" rel="noopener" target="_blank">Watch on YouTube ↗</a></p>
  </section>`;
}

/** Wire click-to-load for every highlight block inside root. Idempotent. */
export function attachVideo(root, { win = typeof window === 'undefined' ? null : window } = {}) {
  if (!root || !win) return;
  for (const btn of root.querySelectorAll('[data-gh-play]')) {
    if (btn.dataset.ghBound) continue;
    btn.dataset.ghBound = '1';
    btn.addEventListener('click', () => {
      const id = btn.dataset.ghPlay;
      if (!VIDEO_ID.test(id || '')) return;
      const frame = btn.closest('[data-gh-frame]');
      const iframe = win.document.createElement('iframe');
      iframe.src = embedUrl(id, win.location.origin);
      iframe.title = btn.dataset.ghTitle || 'Game highlights';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.className = 'gh-iframe';
      const poster = btn;
      poster.hidden = true;
      frame.appendChild(iframe);
      iframe.focus?.();
      // The player reports playback errors over postMessage (enablejsapi=1): 100 not found / private,
      // 101 and 150 embedding not allowed, 2 and 5 bad request / HTML5 error. Any of them removes the player.
      let tries = 0;
      const hello = win.setInterval(() => {
        if (++tries > 50 || !iframe.isConnected) return win.clearInterval(hello);
        iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id, channel: 'widget' }), 'https://www.youtube-nocookie.com');
      }, 400);
      const onMessage = (e) => {
        if (e.source !== iframe.contentWindow || !/^https:\/\/www\.youtube-nocookie\.com$/.test(e.origin)) return;
        let data;
        try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
        if (data?.event === 'onReady' || data?.event === 'initialDelivery') win.clearInterval(hello);
        if (data?.event !== 'onError') return;
        win.clearInterval(hello);
        win.removeEventListener('message', onMessage);
        iframe.remove();
        poster.hidden = false;
        poster.disabled = true;
        const note = win.document.createElement('p');
        note.className = 'gh-unavailable';
        note.setAttribute('role', 'status');
        note.textContent = 'This video can’t be played here. ';
        const a = win.document.createElement('a');
        a.href = `https://www.youtube.com/watch?v=${id}`;
        a.rel = 'noopener';
        a.target = '_blank';
        a.textContent = 'Watch on YouTube ↗';
        note.appendChild(a);
        frame.after(note);
      };
      win.addEventListener('message', onMessage);
    }, { once: true });
  }
}
