// WNBACast full court.
//
// ESPN publishes WNBA shot coordinates in a basket-relative 50 ft x 47 ft half-court
// coordinate system. WNBACast preserves those published coordinates exactly within
// each attacking half, then rotates the away team's half 180 degrees onto the opposite
// basket for display. This is a deterministic presentation transform, not a claim that
// ESPN published a full-court player-tracking coordinate.
//
// Verified source geometry (game 401857189): rim ≈ (25, 0.25), baseline ≈ y=-5,
// half court y=42. That maps to a standard 94 x 50 ft full court.

const SOURCE_RIM = { x: 25, y: 0.25 };
const SOURCE_BASE_Y = -5;
const SOURCE_HALF_Y = 42;
const COURT_L = 94;
const COURT_W = 50;
const MID_X = COURT_L / 2;
const ARC_R = 22.146;
const CORNER_X = 3;
const ARC_JOIN_Y = SOURCE_RIM.y + Math.sqrt(ARC_R ** 2 - (SOURCE_RIM.x - CORNER_X) ** 2);

// Source half-court -> top attacking half. ESPN x remains court width;
// basket-relative y becomes distance down from the top baseline.
const TOP_TX = `matrix(1 0 0 1 0 ${-SOURCE_BASE_Y})`;
// Same source half-court rotated 180° onto the bottom basket.
const BOTTOM_TX = `matrix(-1 0 0 -1 ${COURT_W} ${COURT_L + SOURCE_BASE_Y})`;

export function fullCourtPoint(shot, { home, away } = {}) {
  if (!Number.isFinite(shot?.x) || !Number.isFinite(shot?.y)) return null;
  const side = shot.team_id === home?.team_id ? 'h' : shot.team_id === away?.team_id ? 'a' : 'n';
  const distanceFromBaseline = shot.y - SOURCE_BASE_Y;
  if (side === 'h') {
    return { x: COURT_W - shot.x, y: COURT_L - distanceFromBaseline, side };
  }
  // Away attacks the top basket. Unknown-team shots stay on the top source half
  // rather than being guessed onto the home end.
  return { x: shot.x, y: distanceFromBaseline, side };
}

/**
 * Visual-only deconfliction for photo markers. Exact shot coordinates never move:
 * clustered markers fan a few pixels/feet around the real point, while a classic
 * make/miss glyph and a tether stay anchored at the published location.
 */
function markerOffsets(points, threshold = 2.7) {
  const groups = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i].point;
    let target = null;
    let best = Infinity;
    for (const g of groups) {
      const d = Math.hypot(p.x - g.cx, p.y - g.cy);
      if (d <= threshold && d < best) { target = g; best = d; }
    }
    if (!target) {
      groups.push({ members: [i], cx: p.x, cy: p.y });
      continue;
    }
    target.members.push(i);
    target.cx = target.members.reduce((sum, idx) => sum + points[idx].point.x, 0) / target.members.length;
    target.cy = target.members.reduce((sum, idx) => sum + points[idx].point.y, 0) / target.members.length;
  }

  const out = new Map();
  for (const g of groups) {
    if (g.members.length < 2) continue;
    g.members.forEach((idx, pos) => {
      const ring = Math.floor(pos / 6);
      const ringStart = ring * 6;
      const count = Math.min(6, g.members.length - ringStart);
      const slot = pos % 6;
      const radius = 1.55 + ring * 1.25;
      const angle = (-Math.PI / 2) + ((Math.PI * 2 * slot) / count) + (ring % 2 ? Math.PI / 6 : 0);
      out.set(idx, {
        dx: Math.cos(angle) * radius,
        dy: Math.sin(angle) * radius,
        count: g.members.length
      });
    });
  }
  return out;
}

function halfCourtGeometry() {
  return `
    <rect x="17" y="${SOURCE_BASE_Y}" width="16" height="${14 - SOURCE_BASE_Y}" class="c-lane"/>
    <path d="M19 14 A6 6 0 0 0 31 14" class="c-line"/>
    <path d="M19 14 A6 6 0 0 1 31 14" class="c-line dash"/>
    <line x1="22" y1="-1" x2="28" y2="-1" class="c-board"/>
    <circle cx="${SOURCE_RIM.x}" cy="${SOURCE_RIM.y}" r="0.75" class="c-rim"/>
    <path d="M21 -1 L21 ${SOURCE_RIM.y} A4 4 0 0 0 29 ${SOURCE_RIM.y} L29 -1" class="c-line"/>
    <path d="M${CORNER_X} ${SOURCE_BASE_Y} L${CORNER_X} ${ARC_JOIN_Y.toFixed(2)}
      A${ARC_R} ${ARC_R} 0 0 0 ${COURT_W - CORNER_X} ${ARC_JOIN_Y.toFixed(2)}
      L${COURT_W - CORNER_X} ${SOURCE_BASE_Y}" class="c-line three"/>
  `;
}

export function courtSvg(shots = [], { home, away, highlightSeq = null, animateSeq = null, photoMode = false, cls = '' } = {}) {
  const grain = Array.from({ length: 10 }, (_, i) => {
    const x = 5 * (i + 1);
    return `<line x1="${x}" y1="0" x2="${x}" y2="${COURT_L}" class="c-grain"/>`;
  }).join('');
  const half = halfCourtGeometry();
  const lines = `
    <rect x="0" y="0" width="${COURT_W}" height="${COURT_L}" class="c-floor"/>
    <g aria-hidden="true">${grain}</g>
    <g transform="${TOP_TX}">${half}</g>
    <g transform="${BOTTOM_TX}">${half}</g>
    <line x1="0" y1="${MID_X}" x2="${COURT_W}" y2="${MID_X}" class="c-line c-mid"/>
    <circle cx="${COURT_W / 2}" cy="${MID_X}" r="6" class="c-line c-center"/>
    <rect x="0" y="0" width="${COURT_W}" height="${COURT_L}" class="c-edge"/>
    <text x="4" y="9" class="c-team-label away">${escapeXml(away?.abbr || 'AWAY')}</text>
    <text x="${COURT_W - 4}" y="${COURT_L - 7}" text-anchor="end" class="c-team-label home">${escapeXml(home?.abbr || 'HOME')}</text>
  `;

  const plotted = shots
    .filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y) && s.y <= SOURCE_HALF_Y)
    .map((s, index) => ({ s, index, point: fullCourtPoint(s, { home, away }) }))
    .filter((row) => row.point);
  const offsets = photoMode ? markerOffsets(plotted) : new Map();

  const marks = plotted
    .map(({ s, index, point }, plottedIndex) => {
      const { x, y, side } = point;
      const latest = highlightSeq !== null && s.seq === highlightSeq;
      const entering = animateSeq !== null && s.seq === animateSeq;
      const team = s.team_abbr || (side === 'h' ? home?.abbr : side === 'a' ? away?.abbr : null) || '';
      const result = s.made ? 'Made' : 'Missed';
      const shotType = s.type || (s.value === 3 ? '3-point attempt' : 'field-goal attempt');
      const score = Number.isFinite(s.away_score) && Number.isFinite(s.home_score) ? `${s.away_score}–${s.home_score}` : '';
      const at = [s.period ? periodName(s.period) : '', s.clock || ''].filter(Boolean).join(' ');
      const aria = [s.player, result, shotType, at, score ? `score ${score}` : '', s.text].filter(Boolean).join('. ');
      const data = [
        ['data-shot-seq', s.seq],
        ['data-shot-player', s.player || ''],
        ['data-shot-player-href', s.athlete_id ? `/players/${s.athlete_id}` : ''],
        ['data-shot-team', team],
        ['data-shot-result', result],
        ['data-shot-type', shotType],
        ['data-shot-period', s.period ? periodName(s.period) : ''],
        ['data-shot-clock', s.clock || ''],
        ['data-shot-score', score],
        ['data-shot-text', s.text || ''],
        ['data-shot-value', s.value ?? '']
      ].map(([k, v]) => `${k}="${escapeXml(v)}"`).join(' ');
      const hasPhoto = photoMode && Boolean(s.photo?.square);
      const offset = hasPhoto ? offsets.get(plottedIndex) : null;
      const markerX = x + (offset?.dx || 0);
      const markerY = y + (offset?.dy || 0);
      const pointClass = ['shot-point', hasPhoto ? 'has-photo' : '', offset ? 'is-clustered' : '', latest ? 'is-latest' : '', entering ? 'entering' : ''].filter(Boolean).join(' ');
      const markerClass = `shot ${s.made ? 'made' : 'miss'} ${side}`;
      const classicMarker = s.made
        ? `<circle cx="${x}" cy="${y}" r="0.85" class="${markerClass}"/>`
        : `<g class="${markerClass}"><line x1="${x - 0.6}" y1="${y - 0.6}" x2="${x + 0.6}" y2="${y + 0.6}"/><line x1="${x - 0.6}" y1="${y + 0.6}" x2="${x + 0.6}" y2="${y - 0.6}"/></g>`;
      const clipId = `shot-photo-${String(s.seq ?? index).replace(/[^a-z0-9_-]/gi, '')}-${index}`;
      const photoMarker = hasPhoto ? `
        <defs><clipPath id="${clipId}"><circle cx="${markerX}" cy="${markerY}" r="1.24"/></clipPath></defs>
        <g class="shot-photo-marker ${s.made ? 'made' : 'miss'} ${side}" aria-hidden="true">
          <circle cx="${markerX}" cy="${markerY}" r="1.42" class="shot-photo-halo"/>
          <image href="${escapeXml(s.photo.square)}" x="${markerX - 1.24}" y="${markerY - 1.24}" width="2.48" height="2.48"
            preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" class="shot-photo"/>
          <circle cx="${markerX}" cy="${markerY}" r="1.27" class="shot-photo-ring"/>
          ${s.made ? '<circle cx="' + markerX + '" cy="' + markerY + '" r="1.48" class="shot-photo-result"/>' : '<path d="M' + (markerX - 1.0) + ' ' + (markerY - 1.0) + ' L' + (markerX + 1.0) + ' ' + (markerY + 1.0) + ' M' + (markerX - 1.0) + ' ' + (markerY + 1.0) + ' L' + (markerX + 1.0) + ' ' + (markerY - 1.0) + '" class="shot-photo-result"/>'}
        </g>` : classicMarker;
      const body = `
        <circle cx="${markerX}" cy="${markerY}" r="${hasPhoto ? 2.1 : 1.9}" class="shot-latest-ring" aria-hidden="true"/>
        ${offset ? `<line x1="${x}" y1="${y}" x2="${markerX}" y2="${markerY}" class="shot-cluster-tether" aria-hidden="true"/>${classicMarker}` : ''}
        ${photoMarker}
        <circle cx="${markerX}" cy="${markerY}" r="${hasPhoto ? 2.55 : 2.35}" class="shot-hit" aria-hidden="true"/>
      `;
      const href = hasPhoto && s.athlete_id ? `/players/${escapeXml(s.athlete_id)}` : null;
      return href
        ? `<a href="${href}" class="${pointClass}" aria-label="${escapeXml(aria)}. Open player profile." ${data} data-shot-point data-shot-link>${body}</a>`
        : `<g class="${pointClass}" role="button" tabindex="0" aria-label="${escapeXml(aria)}" ${data} data-shot-point>${body}</g>`;
    })
    .join('');

  return `<svg class="court full-court ${cls}" viewBox="-1 -1 ${COURT_W + 2} ${COURT_L + 2}" role="group"
    aria-label="Interactive vertical full-court shot chart. Away attacks the top basket; home attacks the bottom. Hover, focus, or tap a shot for the play.">
    <g class="c-lines">${lines}</g><g class="court-shots">${marks}</g>
  </svg>`;
}

function periodName(n) {
  const x = Number(n);
  if (!x) return '';
  return x <= 4 ? `Q${x}` : x === 5 ? 'OT' : `${x - 4}OT`;
}

function escapeXml(s) {
  return String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
}
