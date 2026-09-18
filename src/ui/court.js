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

// Source half-court -> left attacking half.
// x' = source distance from baseline; y' = source lateral position.
const LEFT_TX = `matrix(0 1 1 0 ${-SOURCE_BASE_Y} 0)`;
// Same source half-court rotated 180° onto the right basket.
const RIGHT_TX = `matrix(0 -1 -1 0 ${COURT_L + SOURCE_BASE_Y} ${COURT_W})`;

export function fullCourtPoint(shot, { home, away } = {}) {
  if (!Number.isFinite(shot?.x) || !Number.isFinite(shot?.y)) return null;
  const side = shot.team_id === home?.team_id ? 'h' : shot.team_id === away?.team_id ? 'a' : 'n';
  const distanceFromBaseline = shot.y - SOURCE_BASE_Y;
  if (side === 'a') {
    return { x: COURT_L - distanceFromBaseline, y: COURT_W - shot.x, side };
  }
  // Unknown-team shots stay on the left source half rather than being guessed onto an end.
  return { x: distanceFromBaseline, y: shot.x, side };
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
  const grain = Array.from({ length: 18 }, (_, i) => {
    const x = 5 * (i + 1);
    return `<line x1="${x}" y1="0" x2="${x}" y2="${COURT_W}" class="c-grain"/>`;
  }).join('');
  const half = halfCourtGeometry();
  const lines = `
    <rect x="0" y="0" width="${COURT_L}" height="${COURT_W}" class="c-floor"/>
    <g aria-hidden="true">${grain}</g>
    <g transform="${LEFT_TX}">${half}</g>
    <g transform="${RIGHT_TX}">${half}</g>
    <line x1="${MID_X}" y1="0" x2="${MID_X}" y2="${COURT_W}" class="c-line c-mid"/>
    <circle cx="${MID_X}" cy="${COURT_W / 2}" r="6" class="c-line c-center"/>
    <rect x="0" y="0" width="${COURT_L}" height="${COURT_W}" class="c-edge"/>
    <text x="8" y="4.4" class="c-team-label home">${escapeXml(home?.abbr || 'HOME')}</text>
    <text x="${COURT_L - 8}" y="${COURT_W - 3.2}" text-anchor="end" class="c-team-label away">${escapeXml(away?.abbr || 'AWAY')}</text>
  `;

  const marks = shots
    .filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y) && s.y <= SOURCE_HALF_Y)
    .map((s, index) => {
      const point = fullCourtPoint(s, { home, away });
      if (!point) return '';
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
      const pointClass = ['shot-point', hasPhoto ? 'has-photo' : '', latest ? 'is-latest' : '', entering ? 'entering' : ''].filter(Boolean).join(' ');
      const markerClass = `shot ${s.made ? 'made' : 'miss'} ${side}`;
      const classicMarker = s.made
        ? `<circle cx="${x}" cy="${y}" r="0.85" class="${markerClass}"/>`
        : `<g class="${markerClass}"><line x1="${x - 0.6}" y1="${y - 0.6}" x2="${x + 0.6}" y2="${y + 0.6}"/><line x1="${x - 0.6}" y1="${y + 0.6}" x2="${x + 0.6}" y2="${y - 0.6}"/></g>`;
      const clipId = `shot-photo-${String(s.seq ?? index).replace(/[^a-z0-9_-]/gi, '')}-${index}`;
      const photoMarker = hasPhoto ? `
        <defs><clipPath id="${clipId}"><circle cx="${x}" cy="${y}" r="1.24"/></clipPath></defs>
        <g class="shot-photo-marker ${s.made ? 'made' : 'miss'} ${side}" aria-hidden="true">
          <circle cx="${x}" cy="${y}" r="1.42" class="shot-photo-halo"/>
          <image href="${escapeXml(s.photo.square)}" x="${x - 1.24}" y="${y - 1.24}" width="2.48" height="2.48"
            preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" class="shot-photo"/>
          <circle cx="${x}" cy="${y}" r="1.27" class="shot-photo-ring"/>
          ${s.made ? '<circle cx="' + x + '" cy="' + y + '" r="1.48" class="shot-photo-result"/>' : '<path d="M' + (x - 1.0) + ' ' + (y - 1.0) + ' L' + (x + 1.0) + ' ' + (y + 1.0) + ' M' + (x - 1.0) + ' ' + (y + 1.0) + ' L' + (x + 1.0) + ' ' + (y - 1.0) + '" class="shot-photo-result"/>'}
        </g>` : classicMarker;
      return `<g class="${pointClass}" role="button" tabindex="0" aria-label="${escapeXml(aria)}" ${data} data-shot-point>
        <circle cx="${x}" cy="${y}" r="${hasPhoto ? 2.1 : 1.9}" class="shot-latest-ring" aria-hidden="true"/>
        ${photoMarker}
        <circle cx="${x}" cy="${y}" r="${hasPhoto ? 2.55 : 2.35}" class="shot-hit" aria-hidden="true"/>
      </g>`;
    })
    .join('');

  return `<svg class="court full-court ${cls}" viewBox="-1 -1 ${COURT_L + 2} ${COURT_W + 2}" role="group"
    aria-label="Interactive full-court shot chart. Home attacks the left basket; away attacks the right. Hover, focus, or tap a shot for the play.">
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
