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

const safeColor = (c, fb) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : fb);
const flagSrc = (f) => (/^\/media\/flags\/[a-z]{3}\.svg$/.test(String(f || '')) ? f : null);
const MEDAL_LABEL = { gold: 'Gold medal', bronze: 'Bronze medal' };

/** The international scoreboard: flags, names, score, round/medal, competition. Scales with its box (container units). */
function intlBoard(v, { slot = 'card', compact = false } = {}) {
  const [w, l] = v.teams;
  const row = (t, win) => html`<span class="ib-row ${win ? 'ib-row--win' : ''}">${flagSrc(t.flag) ? html`<img class="ib-flag" src="${flagSrc(t.flag)}" alt="" width="60" height="40" decoding="async" />` : html`<span class="ib-flag ib-flag--none"></span>`}<span class="ib-name">${t.name}</span><span class="ib-score">${t.score ?? ''}</span></span>`;
  const kicker = [v.medal ? MEDAL_LABEL[v.medal] : v.round, v.status].filter(Boolean).join(' · ');
  return html`<span class="ib ${compact ? 'ib--band' : 'ib--full'} ib--${slot}" role="img" aria-label="${`${w.name} ${w.score}, ${l.name} ${l.score}. ${kicker}. ${v.competition_name || v.competition || ''}`}"><span class="ib-kicker">${v.medal ? html`<span class="ib-medal ib-medal--${v.medal}" aria-hidden="true"></span>` : ''}${kicker}</span><span class="ib-rows">${row(w, true)}${row(l, false)}</span><span class="ib-foot"><span class="ib-comp">${slot === 'hero' || slot === 'lead' ? v.competition_name || v.competition || '' : v.competition || v.competition_name || ''}</span><span class="ib-brand">PropBetEdge International</span></span></span>`;
}

// Story-media frames carry no court art: identity comes from team colour fields and the brand line (CSS), never SVG backgrounds.

/**
 * slot: 'lead' | 'hero' | 'card' | 'small'.  Returns the 16:9 media box (photo, matchup or team composition)
 * plus, when `credit` is set, its figcaption.
 */
export function storyMedia(media, { slot = 'card', eager = false, credit = true, label = '' } = {}) {
  // Matchup/preview stories are team-first editorial surfaces. Render current
  // team identity there instead of recycling the same two player photos across
  // every preview. Player-led stories (injury, performance, transaction, etc.)
  // keep their approved subject photography.
  const base = media || { layout: 'team', teams: [], subjects: [] };
  const m = base.layout === 'matchup'
    ? { ...base, layout: 'team_matchup', subjects: [], caption: null, og: null, resolved: 'team_composition' }
    : base;
  let inner;
  let cls = `sm sm--${slot}`;
  if ((m.layout === 'intl_game' || m.layout === 'intl_photo') && m.visual?.teams?.length === 2) {
    // PropBetEdge International: the approved subject photograph under a scoreboard band, or — when no approved
    // photograph exists — the full scoreboard composition. Same data, same identity on heroes, cards and share images.
    const photo = m.layout === 'intl_photo' && m.subjects?.[0]?.wide?.length;
    const board = intlBoard(m.visual, { slot, compact: Boolean(photo) });
    inner = photo ? html`${wideImg(m.subjects[0], slot, eager)}${board}` : board;
    cls += photo ? ' sm--photo sm--intl sm--intl-photo' : ' sm--intl sm--intl-board';
    const cap = credit && photo ? html`<figcaption class="sm-credit">${creditLine(m, { compact: slot === 'card' || slot === 'small' })}</figcaption>` : '';
    const [w, l] = m.visual.teams;
    return html`<figure class="${cls}" style="--c1:${safeColor(w.color, '#c8102e')};--c2:${safeColor(l.color, '#1d3f8f')}">${label ? html`<span class="sm-label">${label}</span>` : ''}<span class="sm-frame">${inner}</span>${cap}</figure>`;
  }
  if (m.layout === 'single' && m.subjects?.[0]?.wide?.length) {
    inner = wideImg(m.subjects[0], slot, eager);
    cls += ' sm--photo';
  } else if (m.layout === 'matchup' && m.subjects?.length === 2 && m.subjects.every((s) => s.half?.length)) {
    const [A, H] = m.subjects;
    inner = html`<span class="sm-half sm-half--a">${halfImg(A, slot, eager)}</span><span class="sm-half sm-half--h">${halfImg(H, slot, eager)}</span><span class="sm-vs" aria-hidden="true">at</span>`;
    cls += ' sm--duo sm--photo';
  } else if (m.layout === 'brand' || !(m.teams || []).length) {
    // Deterministic PropBetEdge story visual for league-wide stories with no team: desk label and brand on the court.
    inner = html`<span class="sm-brand"><span class="sm-brand-desk">${m.visual?.desk || 'WNBA Newsroom'}</span><span class="sm-brand-mark">PropBetEdge WNBA</span></span>`;
    cls += ' sm--brand';
  } else if ((m.teams || []).length >= 2) {
    inner = html`${teamPanel(m.teams[0], { side: 'a' })}${teamPanel(m.teams[1], { side: 'h' })}<span class="sm-vs" aria-hidden="true">at</span>`;
    cls += ' sm--teams';
  } else {
    inner = html`${teamPanel((m.teams || [])[0])}`;
    cls += ' sm--teamonly';
  }
  const tc = teamColors({ team_id: (m.teams || [])[0] }).color || '#d4af37';
  const tc2 = teamColors({ team_id: (m.teams || [])[1] }).color || '#ff7a2f';
  const cap = credit && m.subjects?.length ? html`<figcaption class="sm-credit">${creditLine(m, { compact: slot === 'card' || slot === 'small' })}</figcaption>` : '';
  return html`<figure class="${cls}" style="--tc1:${tc};--tc2:${tc2}">${label ? html`<span class="sm-label">${label}</span>` : ''}<span class="sm-frame">${inner}</span>${cap}</figure>`;
}

/** 1:1 thumbnail for rivers/lists: the reviewed square crop of the pictured player, else the team mark. */
export function storyThumb(media, size = 72) {
  if (media?.layout === 'intl_game' && media.visual?.teams?.length === 2) {
    const [w, l] = media.visual.teams;
    return html`<span class="sm-thumb sm-thumb--intl" style="width:${size}px;height:${size}px" role="img" aria-label="${`${w.name} ${w.score}, ${l.name} ${l.score}`}">${flagSrc(w.flag) ? html`<img src="${flagSrc(w.flag)}" alt="" width="30" height="20" loading="lazy" decoding="async" />` : ''}<b>${w.score}–${l.score}</b>${flagSrc(l.flag) ? html`<img src="${flagSrc(l.flag)}" alt="" width="30" height="20" loading="lazy" decoding="async" />` : ''}</span>`;
  }
  const s = media?.layout === 'single' || media?.layout === 'intl_photo' ? media.subjects?.[0] : null;
  if (s?.square) return html`<img class="sm-thumb" src="${s.square}" width="${size}" height="${size}" alt="${s.name}" loading="lazy" decoding="async" />`;
  if (!(media?.teams || []).length) return html`<span class="sm-thumb sm-thumb--brand" style="width:${size}px;height:${size}px" role="img" aria-label="${media?.visual?.desk || 'PropBetEdge WNBA'}"><b>PBE</b></span>`;
  const e = logoEntry((media?.teams || [])[0]);
  const c = teamColors({ team_id: (media?.teams || [])[0] }).color || '#d4af37';
  return html`<span class="sm-thumb sm-thumb--team" style="--tc:${c};width:${size}px;height:${size}px">${e ? html`<img src="${e.files['128']}" alt="" width="64" height="64" loading="lazy" decoding="async" />` : ''}</span>`;
}
