// Share-card layouts (satori element trees). Pure: no wasm, no fonts, no network — og.js renders them,
// and the Node QA harness renders the same trees, so what is inspected locally is what ships.
//
// Identity V3: every card carries the same chrome — the canonical PropBetEdge mark + WNBA top-left,
// @PROPBETEDGE bottom-left, the gold→flame rail along the bottom edge. The rest of the canvas is the subject.
// Text is length-bucketed and line-clamped deterministically so nothing overflows or shrinks to unreadable.

import { PBE_MARK_PNG, PBE_MARK_W, PBE_MARK_H } from './brand-mark.js';

export const INK = '#0f0d0a';
export const GOLD = '#d4af37';
export const GOLD_B = '#ecc95c';
export const ORANGE = '#ff7a2f';
export const PAPER = '#f5f1eb';
export const MUTED = '#c9c0b2';
const FAINT = '#8d8578';
const LIVE_RED = '#ff4d4f';

// Minimal hyperscript for satori's element tree.
export const h = (style, ...children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children: children.flat().filter((c) => c !== null && c !== undefined && c !== false) } });
export const text = (style, s) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children: String(s) } });
const img = (src, w, hgt, style = {}) => ({ type: 'img', props: { src, width: w, height: hgt, style: { width: w, height: hgt, ...style } } });
/** A block of text clamped to `lines` with an ellipsis (satori lineClamp needs display:block). */
const clamp = (style, s, lines) => ({ type: 'div', props: { style: { display: 'block', lineClamp: lines, ...style }, children: String(s) } });

const MARK_H = 50;
const MARK_W = Math.round(PBE_MARK_W * MARK_H / PBE_MARK_H);

/** Top-left identity: PropBetEdge mark | PROPBETEDGE / WNBA. */
function identity() {
  return h({ position: 'absolute', left: 56, top: 44, alignItems: 'center' },
    img(PBE_MARK_PNG, MARK_W, MARK_H),
    h({ width: 2, height: 42, backgroundColor: 'rgba(245,241,235,0.24)', marginLeft: 18, marginRight: 16 }),
    h({ flexDirection: 'column' },
      text({ fontFamily: 'Barlow Condensed', fontSize: 22, color: GOLD_B, letterSpacing: 3.5, lineHeight: 1 }, 'PROPBETEDGE'),
      text({ fontFamily: 'Barlow Condensed', fontSize: 32, color: PAPER, letterSpacing: 2.5, lineHeight: 1, marginTop: 3 }, 'WNBA')));
}

/** Bottom identity + rail. `footer` is the card's own context (date, surface); @PROPBETEDGE always leads. */
function baseline(footer) {
  return [
    h({ position: 'absolute', left: 56, bottom: 32, alignItems: 'center' },
      text({ fontFamily: 'Inter', fontWeight: 700, fontSize: 22, color: GOLD_B, letterSpacing: 0.5 }, '@PROPBETEDGE'),
      footer ? text({ fontFamily: 'Inter', fontWeight: 500, fontSize: 21, color: MUTED, marginLeft: 14 }, `·   ${footer}`) : null),
    h({ position: 'absolute', left: 0, bottom: 0, width: 1200, height: 6, backgroundImage: `linear-gradient(90deg, ${GOLD_B}, ${ORANGE})` })
  ];
}

/** Product label top-right (non-photo cards only: photo cards keep the right side for the subject). */
function productTag(label) {
  if (!label) return null;
  return h({ position: 'absolute', right: 56, top: 56, alignItems: 'center', paddingLeft: 16, paddingRight: 16, height: 40, borderRadius: 20, border: '1.5px solid rgba(236,201,92,0.55)', backgroundColor: 'rgba(15,13,10,0.55)' },
    text({ fontFamily: 'Barlow Condensed', fontSize: 24, color: GOLD_B, letterSpacing: 2.5, textTransform: 'uppercase' }, label));
}

function surface(model) {
  if (model.photo) {
    return [
      img(model.photo, 1200, 630, { position: 'absolute', left: 0, top: 0 }),
      h({ position: 'absolute', left: 0, top: 0, width: 1200, height: 630, backgroundImage: 'linear-gradient(90deg, rgba(15,13,10,0.97) 0%, rgba(15,13,10,0.88) 46%, rgba(15,13,10,0) 68%)' }),
      // The composition prints its own small brand top-left; mask it so the card's identity is the only one.
      h({ position: 'absolute', left: 0, top: 0, width: 520, height: 150, backgroundImage: 'linear-gradient(90deg, rgba(15,13,10,1) 0%, rgba(15,13,10,1) 80%, rgba(15,13,10,0) 100%)' })
    ];
  }
  const [c1, c2] = model.colors || ['#2a241c', '#3a2f22'];
  return [
    h({ position: 'absolute', left: 0, top: 0, width: 1200, height: 630, backgroundImage: `linear-gradient(120deg, ${INK} 0%, ${INK} 50%, ${c1} 50%, ${c1} 75%, ${c2} 75%, ${c2} 100%)` }),
    h({ position: 'absolute', left: 0, top: 0, width: 1200, height: 630, backgroundImage: 'linear-gradient(90deg, rgba(15,13,10,1) 0%, rgba(15,13,10,0.92) 52%, rgba(15,13,10,0.62) 100%)' }),
    // Key light: depth behind the subject instead of a flat panel.
    h({ position: 'absolute', left: 620, top: -160, width: 760, height: 760, borderRadius: 380, backgroundImage: 'radial-gradient(circle, rgba(212,175,55,0.16) 0%, rgba(212,175,55,0) 70%)' })
  ];
}

const card = (...children) => h({ width: 1200, height: 630, position: 'relative', backgroundColor: INK, overflow: 'hidden' }, ...children);

/** Deterministic headline sizing: bucket by length, then clamp to the bucket's line budget. */
export function headlineStyle(title, { photo, display }) {
  const n = String(title || '').length;
  if (display) {
    const size = n <= 14 ? 104 : n <= 22 ? 84 : n <= 34 ? 68 : 56;
    return { style: { fontFamily: 'Barlow Condensed', fontSize: size, lineHeight: 0.98, color: PAPER, textTransform: 'uppercase', width: photo ? 640 : 1040 }, lines: 2 };
  }
  const size = n <= 55 ? 58 : n <= 90 ? 50 : 42;
  return { style: { fontFamily: 'Newsreader', fontSize: size, lineHeight: 1.14, color: PAPER, width: photo ? 640 : 1040 }, lines: n <= 55 ? 3 : 4 };
}

const kicker = (s, color = ORANGE) => (s ? clamp({ fontFamily: 'Barlow Condensed', fontSize: 28, color, letterSpacing: 2.5, textTransform: 'uppercase', width: 1000 }, s, 1) : null);

function featureLayout(model) {
  const photo = Boolean(model.photo);
  const head = headlineStyle(model.title, { photo, display: model.titleFont === 'display' });
  const mark = !photo && model.mark
    ? img(model.mark, 320, 320, { position: 'absolute', right: 90, top: 170, objectFit: 'contain', opacity: 0.95 })
    : null;
  const w = photo ? 640 : mark ? 700 : 1040;
  return card(
    ...surface(model),
    mark,
    identity(),
    photo ? null : productTag(model.tag),
    h({ position: 'absolute', left: 56, top: 168, width: w, flexDirection: 'column' },
      kicker(model.kicker),
      clamp({ ...head.style, width: w, marginTop: 14 }, model.title, head.lines),
      model.sub ? clamp({ fontFamily: 'Inter', fontWeight: 700, fontSize: 30, color: GOLD_B, marginTop: 18, width: w }, model.sub, 1) : null,
      model.detail ? clamp({ fontFamily: 'Inter', fontWeight: 500, fontSize: 25, lineHeight: 1.3, color: MUTED, marginTop: 12, width: w }, model.detail, 2) : null),
    ...baseline(model.footer));
}

function statBlock(s, i) {
  return h({ flexDirection: 'column', marginLeft: i ? 34 : 0 },
    text({ fontFamily: 'Barlow Condensed', fontSize: 66, lineHeight: 1, color: s.accent ? GOLD_B : PAPER }, s.value),
    text({ fontFamily: 'Inter', fontWeight: 700, fontSize: 17, letterSpacing: 2, color: s.accent ? GOLD : MUTED, marginTop: 6, textTransform: 'uppercase' }, s.label));
}

/** Player profile: approved photo right, identity + a few large, verifiable numbers left. */
function profileLayout(model) {
  const photo = Boolean(model.photo);
  const head = headlineStyle(model.title, { photo: true, display: true });
  return card(
    ...surface(model),
    !photo && model.mark ? img(model.mark, 300, 300, { position: 'absolute', right: 110, top: 170, objectFit: 'contain', opacity: 0.95 }) : null,
    identity(),
    h({ position: 'absolute', left: 56, top: 162, width: 640, flexDirection: 'column' },
      kicker(model.kicker),
      clamp({ ...head.style, width: 640, marginTop: 10 }, model.title, 2),
      model.sub ? clamp({ fontFamily: 'Inter', fontWeight: 700, fontSize: 28, color: GOLD_B, marginTop: 14, width: 640 }, model.sub, 1) : null,
      model.stats?.length ? h({ marginTop: 30 }, ...model.stats.slice(0, 4).map(statBlock)) : null,
      model.detail ? clamp({ fontFamily: 'Inter', fontWeight: 500, fontSize: 21, color: MUTED, marginTop: 18, width: 640 }, model.detail, 1) : null),
    ...baseline(model.footer));
}

function dimRow(d, i) {
  const pct = Math.max(0, Math.min(100, Number(d.score) || 0));
  return h({ flexDirection: 'column', marginTop: i ? 12 : 0, width: 360 },
    h({ justifyContent: 'space-between', alignItems: 'flex-end', width: 360 },
      clamp({ fontFamily: 'Inter', fontWeight: 700, fontSize: 20, color: PAPER, width: 300 }, d.label, 1),
      text({ fontFamily: 'Barlow Condensed', fontSize: 30, lineHeight: 1, color: GOLD_B }, String(Math.round(pct)))),
    h({ width: 360, height: 8, borderRadius: 4, marginTop: 5, backgroundColor: 'rgba(245,241,235,0.12)' },
      h({ width: Math.max(8, Math.round(360 * pct / 100)), height: 8, borderRadius: 4, backgroundImage: `linear-gradient(90deg, ${GOLD}, ${GOLD_B})` })));
}

/** Player DNA: photo right; WinBA score as the anchor, 3 strongest dimensions, the sample. */
function dnaLayout(model) {
  const photo = Boolean(model.photo);
  return card(
    ...surface(model),
    !photo && model.mark ? img(model.mark, 300, 300, { position: 'absolute', right: 110, top: 170, objectFit: 'contain', opacity: 0.95 }) : null,
    identity(),
    h({ position: 'absolute', left: 56, top: 140, width: 650, flexDirection: 'column' },
      kicker(model.kicker),
      clamp({ fontFamily: 'Barlow Condensed', fontSize: String(model.title).length <= 16 ? 76 : 60, lineHeight: 1, color: PAPER, textTransform: 'uppercase', width: 640, marginTop: 8 }, model.title, 1),
      model.sub ? clamp({ fontFamily: 'Inter', fontWeight: 700, fontSize: 24, color: MUTED, marginTop: 8, width: 640 }, model.sub, 1) : null,
      h({ marginTop: 26, alignItems: 'flex-start' },
        model.winba ? h({ flexDirection: 'column', width: 220, paddingRight: 24, marginRight: 28, borderRight: '1px solid rgba(245,241,235,0.16)' },
          text({ fontFamily: 'Barlow Condensed', fontSize: 22, letterSpacing: 3, color: GOLD }, 'WINBA SCORE'),
          text({ fontFamily: 'Barlow Condensed', fontSize: 96, lineHeight: 0.95, color: GOLD_B }, model.winba.score),
          model.winba.context ? clamp({ fontFamily: 'Inter', fontWeight: 500, fontSize: 18, lineHeight: 1.3, color: MUTED, marginTop: 6, width: 196 }, model.winba.context, 2) : null) : null,
        model.dims?.length ? h({ flexDirection: 'column', paddingTop: 4 },
          text({ fontFamily: 'Barlow Condensed', fontSize: 22, letterSpacing: 3, color: ORANGE, marginBottom: 10 }, 'STRONGEST DIMENSIONS'),
          ...model.dims.slice(0, 3).map(dimRow)) : null),
      model.detail ? clamp({ fontFamily: 'Inter', fontWeight: 500, fontSize: 19, color: FAINT, marginTop: 18, width: 640 }, model.detail, 1) : null),
    ...baseline(model.footer));
}

/** WinBA Score: the metric's own identity, and the current top of the board (names + scores only). */
function winbaLayout(model) {
  const row = (r, i) => h({ alignItems: 'center', height: 74, marginTop: i ? 10 : 0, paddingLeft: 22, paddingRight: 24, borderRadius: 14, backgroundColor: i ? 'rgba(245,241,235,0.05)' : 'rgba(212,175,55,0.12)', border: i ? '1px solid rgba(245,241,235,0.08)' : '1px solid rgba(236,201,92,0.45)', width: 470 },
    text({ fontFamily: 'Barlow Condensed', fontSize: 34, color: i ? MUTED : GOLD_B, width: 42 }, String(r.rank)),
    h({ flexDirection: 'column', flexGrow: 1 },
      clamp({ fontFamily: 'Barlow Condensed', fontSize: 32, lineHeight: 1, color: PAPER, textTransform: 'uppercase', width: 300 }, r.name, 1),
      r.team ? clamp({ fontFamily: 'Inter', fontWeight: 500, fontSize: 16, color: FAINT, marginTop: 3, width: 300 }, r.team, 1) : null),
    text({ fontFamily: 'Barlow Condensed', fontSize: 44, color: GOLD_B }, r.score));
  return card(
    h({ position: 'absolute', left: 0, top: 0, width: 1200, height: 630, backgroundImage: `linear-gradient(135deg, ${INK} 0%, #16130e 60%, #221b10 100%)` }),
    h({ position: 'absolute', left: -120, top: 60, width: 760, height: 760, borderRadius: 380, backgroundImage: 'radial-gradient(circle, rgba(212,175,55,0.18) 0%, rgba(212,175,55,0) 68%)' }),
    identity(),
    h({ position: 'absolute', left: 56, top: 158, width: 560, flexDirection: 'column' },
      text({ fontFamily: 'Barlow Condensed', fontSize: 168, lineHeight: 0.86, color: GOLD_B, letterSpacing: 2 }, 'WINBA'),
      text({ fontFamily: 'Barlow Condensed', fontSize: 64, lineHeight: 1, color: PAPER, letterSpacing: 10, marginTop: 6 }, 'SCORE'),
      text({ fontFamily: 'Inter', fontWeight: 700, fontSize: 26, color: PAPER, marginTop: 26 }, 'Winning-Impact Index · 0–100'),
      text({ fontFamily: 'Inter', fontWeight: 500, fontSize: 20, color: MUTED, marginTop: 10, width: 520 }, 'Associated with winning — not a count of wins added.')),
    model.board?.length
      ? h({ position: 'absolute', right: 56, top: 150, flexDirection: 'column' },
        text({ fontFamily: 'Barlow Condensed', fontSize: 24, letterSpacing: 3, color: ORANGE, marginBottom: 12 }, model.boardLabel || 'CURRENT LEADERS'),
        ...model.board.slice(0, 3).map(row))
      : null,
    ...baseline(model.footer));
}

function statusPill(status) {
  const map = { live: ['LIVE', LIVE_RED, '#ffffff'], final: ['FINAL', GOLD_B, '#1a1406'], replay: ['FINAL · REPLAY', GOLD_B, '#1a1406'], pre: ['UPCOMING', 'rgba(245,241,235,0.14)', PAPER] };
  const [label, bg, fg] = map[status] || map.pre;
  return h({ alignItems: 'center', height: 40, paddingLeft: 16, paddingRight: 16, borderRadius: 20, backgroundColor: bg },
    status === 'live' ? h({ width: 10, height: 10, borderRadius: 5, backgroundColor: '#ffffff', marginRight: 10 }) : null,
    text({ fontFamily: 'Barlow Condensed', fontSize: 26, letterSpacing: 2, color: fg }, label));
}

/** WNBACast + matchups: two teams, their self-hosted marks, the score when there is one. */
function versusLayout(model) {
  const v = model.versus;
  const scored = v.rows.every((r) => Number.isFinite(r.score));
  const row = (r, i) => h({ alignItems: 'center', height: 132, marginTop: i ? 14 : 0, width: 1088, paddingLeft: 20, paddingRight: 28, borderRadius: 18, backgroundColor: 'rgba(245,241,235,0.045)', border: '1px solid rgba(245,241,235,0.08)' },
    h({ width: 8, height: 92, borderRadius: 4, backgroundColor: r.color || GOLD, marginRight: 22 }),
    r.logo ? img(r.logo, 100, 100, { objectFit: 'contain', marginRight: 26 }) : h({ width: 100, height: 100, marginRight: 26, borderRadius: 50, backgroundColor: '#2a241c', alignItems: 'center', justifyContent: 'center' }, text({ fontFamily: 'Barlow Condensed', fontSize: 38, color: PAPER }, r.abbr || '')),
    h({ flexDirection: 'column', flexGrow: 1 },
      clamp({ fontFamily: 'Barlow Condensed', fontSize: 62, lineHeight: 1, color: !scored || r.win ? PAPER : MUTED, textTransform: 'uppercase', width: 700 }, r.name, 1),
      r.record ? text({ fontFamily: 'Inter', fontWeight: 500, fontSize: 19, color: FAINT, marginTop: 4 }, r.record) : null),
    scored ? text({ fontFamily: 'Barlow Condensed', fontSize: 104, lineHeight: 1, color: r.win ? GOLD_B : MUTED }, String(r.score)) : null);
  return card(
    h({ position: 'absolute', left: 0, top: 0, width: 1200, height: 630, backgroundImage: `linear-gradient(135deg, ${INK} 0%, #15120e 55%, #1d1811 100%)` }),
    h({ position: 'absolute', left: 0, top: 0, width: 1200, height: 630, backgroundImage: `linear-gradient(90deg, ${v.rows[0].color || GOLD}22 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,0) 60%, ${v.rows[1].color || GOLD}22 100%)` }),
    identity(),
    h({ position: 'absolute', right: 56, top: 50, alignItems: 'center' },
      model.tag ? text({ fontFamily: 'Barlow Condensed', fontSize: 38, letterSpacing: 2, color: PAPER, marginRight: 16 }, model.tag) : null,
      statusPill(v.status)),
    h({ position: 'absolute', left: 56, top: 142, flexDirection: 'column' },
      ...v.rows.map(row),
      h({ marginTop: 16, alignItems: 'center' },
        text({ fontFamily: 'Inter', fontWeight: 700, fontSize: 23, color: GOLD_B }, v.when || ''),
        v.context ? text({ fontFamily: 'Inter', fontWeight: 500, fontSize: 22, color: MUTED, marginLeft: 12 }, `·  ${v.context}`) : null)),
    ...baseline(model.footer));
}

/** International scoreboard (medal games): flags + score. */
function scoreboardLayout(model) {
  const sb = model.scoreboard;
  const photo = Boolean(model.photo);
  const row = (t, win) => h({ alignItems: 'center', marginTop: 18, width: photo ? 560 : 1000 },
    t.flag ? img(t.flag, photo ? 84 : 120, photo ? 56 : 80, { borderRadius: 6, marginRight: 26 }) : h({ width: photo ? 84 : 120, height: photo ? 56 : 80, marginRight: 26, backgroundColor: '#2a241c', borderRadius: 6 }),
    clamp({ fontFamily: 'Barlow Condensed', fontSize: photo ? 60 : 92, color: win ? PAPER : MUTED, textTransform: 'uppercase', flexGrow: 1, width: photo ? 330 : 700 }, t.name, 1),
    text({ fontFamily: 'Barlow Condensed', fontSize: photo ? 76 : 116, color: win ? GOLD_B : MUTED }, String(t.score ?? '')));
  return card(
    ...surface(model),
    identity(),
    h({ position: 'absolute', left: 56, top: 158, flexDirection: 'column' },
      kicker(model.kicker),
      row(sb.rows[0], true),
      row(sb.rows[1], false),
      clamp({ fontFamily: 'Inter', fontWeight: 700, fontSize: 24, color: MUTED, marginTop: 24, width: photo ? 600 : 1000 }, sb.competition || '', 1)),
    ...baseline(model.footer));
}

/** The WinBA Index: the board's top three, each with her approved photograph. */
function podiumLayout(model) {
  const CELL_W = 300;
  const CELL_H = 340;
  const cell = (r, i) => h({
    position: 'absolute', left: 56 + i * (CELL_W + 14), top: 212, width: CELL_W, height: CELL_H,
    flexDirection: 'column', borderRadius: 12, overflow: 'hidden', backgroundColor: '#1a1610'
  },
  img(r.photo, CELL_W, 240, { objectFit: 'cover' }),
  h({ position: 'absolute', left: 0, top: 0, width: 54, height: 54, backgroundColor: r.teamColor, alignItems: 'center', justifyContent: 'center' },
    text({ fontFamily: 'Barlow Condensed', fontSize: 34, color: PAPER }, `${r.rank}`)),
  h({ width: CELL_W, height: CELL_H - 240, paddingLeft: 14, paddingRight: 14, flexDirection: 'column', justifyContent: 'center' },
    clamp({ fontFamily: 'Barlow Condensed', fontSize: 34, color: PAPER, textTransform: 'uppercase', lineHeight: 1, width: CELL_W - 28 }, r.name, 1),
    text({ fontFamily: 'Inter', fontWeight: 700, fontSize: 26, color: GOLD_B, marginTop: 4 }, `${r.score} WinBA`)));

  return card(
    h({ position: 'absolute', left: 0, top: 0, width: 1200, height: 630, backgroundImage: `linear-gradient(120deg, ${INK} 0%, ${INK} 62%, #1d1a14 100%)` }),
    identity(),
    h({ position: 'absolute', left: 56, top: 128, flexDirection: 'column' },
      text({ fontFamily: 'Barlow Condensed', fontSize: 42, color: PAPER, textTransform: 'uppercase', lineHeight: 1 }, 'The WinBA Index'),
      text({ fontFamily: 'Barlow Condensed', fontSize: 27, color: ORANGE, letterSpacing: 2, textTransform: 'uppercase', marginTop: 4 }, model.period || '')),
    ...model.podium.map(cell),
    // CC BY-SA credit: printed in full (never clamped), in the open space right of the title.
    model.credits ? text({ position: 'absolute', right: 56, top: 132, width: 520, fontFamily: 'Inter', fontWeight: 500, fontSize: 14, lineHeight: 1.35, color: FAINT, justifyContent: 'flex-end', textAlign: 'right' }, model.credits) : null,
    ...baseline(model.footer));
}

export function layout(model) {
  if (model.podium) return podiumLayout(model);
  if (model.scoreboard) return scoreboardLayout(model);
  if (model.versus) return versusLayout(model);
  if (model.winbaBoard) return winbaLayout(model);
  if (model.dims) return dnaLayout(model);
  if (model.stats) return profileLayout(model);
  return featureLayout(model);
}
