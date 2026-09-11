// Story media — renders the photograph decision the newsroom Worker attached to an article (`media`).
//
// Every photo here is a deliberate, pre-composed derivative (scripts/media/newsroom_media.py): the image's
// own aspect ratio equals its box, so the browser never crops, stretches or top-centres anything. Files are
// served from this domain. Every photo shows its credit (author · license · source) and who is pictured.
// Stories without an approved subject get a team composition — never a stand-in player.

import { html } from '../lib/dom.js';
import { logoEntry, teamColors } from './logo.js';

const SIZES = {
  lead: '(max-width: 900px) 100vw, 860px',
  hero: '(max-width: 900px) 100vw, 1000px',
  card: '(max-width: 640px) 100vw, 420px',
  small: '(max-width: 640px) 45vw, 240px'
};

const srcset = (files) => files.map((f) => `${f.src} ${f.w}w`).join(', ');

function pick(files, want) {
  const sorted = [...files].sort((a, b) => a.w - b.w);
  return sorted.find((f) => f.w >= want) || sorted[sorted.length - 1];
}

function wideImg(s, slot, eager) {
  const f = pick(s.wide, slot === 'card' || slot === 'small' ? 640 : 1280);
  return html`<img class="sm-img" src="${f.src}" srcset="${srcset(s.wide)}" sizes="${SIZES[slot] || SIZES.card}" width="${f.w}" height="${f.h}" alt="${s.name}" ${eager ? html`fetchpriority="high"` : html`loading="lazy"`} decoding="async" />`;
}

function halfImg(s, slot, eager) {
  const files = s.half.length ? s.half : null;
  if (!files) return null;
  const f = pick(files, slot === 'card' || slot === 'small' ? 480 : 640);
  const sz = slot === 'lead' || slot === 'hero' ? '(max-width: 900px) 50vw, 500px' : '(max-width: 640px) 50vw, 210px';
  return html`<img class="sm-img" src="${f.src}" srcset="${srcset(files)}" sizes="${sz}" width="${f.w}" height="${f.h}" alt="${s.name}" ${eager ? html`fetchpriority="high"` : html`loading="lazy"`} decoding="async" />`;
}

export function creditLine(media, { compact = false } = {}) {
  const subs = media?.subjects || [];
  if (!subs.length) return '';
  const parts = subs.map((s) => {
    const c = s.credit || {};
    const who = c.author || 'Unknown author';
    return html`<span class="sm-cr">Photo: ${c.source_page ? html`<a href="${c.source_page}" rel="noopener nofollow" target="_blank">${who}</a>` : who} · ${c.license_url ? html`<a href="${c.license_url}" rel="noopener nofollow license" target="_blank">${c.license}</a>` : c.license} (cropped)${compact ? '' : ' · Wikimedia Commons'}</span>`;
  });
  return html`${parts}${media.caption ? html`<span class="sm-cap">${media.caption}</span>` : ''}`;
}

function teamPanel(tid, { side = null } = {}) {
  const e = logoEntry(tid);
  const c = teamColors({ team_id: tid });
  return html`<span class="sm-team ${side ? `sm-team--${side}` : ''}" style="--tc:${c.color || '#d4af37'};--tc2:${c.alt || '#ff7a2f'}">
    ${e ? html`<img class="sm-mark" src="${e.files['320']}" alt="" width="320" height="320" loading="lazy" decoding="async" />` : ''}
    <span class="sm-tname">${e?.name || ''}</span>
  </span>`;
}

const COURT = html`<svg class="sm-court" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.2"><rect x="-10" y="18" width="340" height="150"/><line x1="160" y1="18" x2="160" y2="168"/><circle cx="160" cy="93" r="26"/><path d="M-10 48h58a45 45 0 0 1 0 90h-58M330 48h-58a45 45 0 0 0 0 90h58"/></g></svg>`;

/**
 * slot: 'lead' | 'hero' | 'card' | 'small'.  Returns the 16:9 media box (photo, matchup or team composition)
 * plus, when `credit` is set, its figcaption.
 */
export function storyMedia(media, { slot = 'card', eager = false, credit = true, label = '' } = {}) {
  const m = media || { layout: 'team', teams: [], subjects: [] };
  let inner;
  let cls = `sm sm--${slot}`;
  if (m.layout === 'single' && m.subjects?.[0]?.wide?.length) {
    inner = wideImg(m.subjects[0], slot, eager);
    cls += ' sm--photo';
  } else if (m.layout === 'matchup' && m.subjects?.length === 2 && m.subjects.every((s) => s.half?.length)) {
    const [A, H] = m.subjects;
    inner = html`<span class="sm-half sm-half--a">${halfImg(A, slot, eager)}</span><span class="sm-half sm-half--h">${halfImg(H, slot, eager)}</span><span class="sm-vs" aria-hidden="true">at</span>`;
    cls += ' sm--duo sm--photo';
  } else if ((m.teams || []).length >= 2) {
    inner = html`${COURT}${teamPanel(m.teams[0], { side: 'a' })}${teamPanel(m.teams[1], { side: 'h' })}<span class="sm-vs" aria-hidden="true">at</span>`;
    cls += ' sm--teams';
  } else {
    inner = html`${COURT}${teamPanel((m.teams || [])[0])}`;
    cls += ' sm--teamonly';
  }
  const tc = teamColors({ team_id: (m.teams || [])[0] }).color || '#d4af37';
  const tc2 = teamColors({ team_id: (m.teams || [])[1] }).color || '#ff7a2f';
  const cap = credit && m.subjects?.length ? html`<figcaption class="sm-credit">${creditLine(m, { compact: slot === 'card' || slot === 'small' })}</figcaption>` : '';
  return html`<figure class="${cls}" style="--tc1:${tc};--tc2:${tc2}">${label ? html`<span class="sm-label">${label}</span>` : ''}<span class="sm-frame">${inner}</span>${cap}</figure>`;
}

/** 1:1 thumbnail for rivers/lists: the reviewed square crop of the pictured player, else the team mark. */
export function storyThumb(media, size = 72) {
  const s = media?.layout === 'single' ? media.subjects?.[0] : media?.layout === 'matchup' ? media.subjects?.[1] : null;
  if (s?.square) return html`<img class="sm-thumb" src="${s.square}" width="${size}" height="${size}" alt="${s.name}" loading="lazy" decoding="async" />`;
  const e = logoEntry((media?.teams || [])[0]);
  const c = teamColors({ team_id: (media?.teams || [])[0] }).color || '#d4af37';
  return html`<span class="sm-thumb sm-thumb--team" style="--tc:${c};width:${size}px;height:${size}px">${e ? html`<img src="${e.files['128']}" alt="" width="64" height="64" loading="lazy" decoding="async" />` : ''}</span>`;
}
