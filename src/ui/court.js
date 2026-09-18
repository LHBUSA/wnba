// WNBA half court drawn in ESPN's own coordinate space (feet), so a published
// shot lands exactly where the source put it — no scaling guesswork, no jitter.
// Verified against real WNBA shots (game 401857189): rim ≈ (25, 0.25), stated
// shot distances reproduced within ~0.5 ft. Baseline sits ≈ 5 ft behind the rim.
// Geometry: 50 ft wide; 16 ft lane; FT line 15 ft from the backboard;
// 3-pt arc 22 ft 1.75 in, 22 ft in the corners; restricted area 4 ft.

const RIM = { x: 25, y: 0.25 };
const BASE_Y = -5;
const HALF_Y = 42;
const ARC_R = 22.146;
const CORNER_X = 3;
const ARC_JOIN_Y = RIM.y + Math.sqrt(ARC_R ** 2 - (RIM.x - CORNER_X) ** 2);

export function courtSvg(shots = [], { home, away, highlightSeq = null, animateSeq = null, photoMode = false, cls = '' } = {}) {
  const grain = Array.from({ length: 10 }, (_, i) => {
    const x = 5 * (i + 1);
    return `<line x1="${x}" y1="${BASE_Y}" x2="${x}" y2="${HALF_Y}" class="c-grain"/>`;
  }).join('');
  const lines = `
    <rect x="0" y="${BASE_Y}" width="50" height="${HALF_Y - BASE_Y}" class="c-floor"/>
    <g aria-hidden="true">${grain}</g>
    <rect x="17" y="${BASE_Y}" width="16" height="${14 - BASE_Y}" class="c-lane"/>
    <path d="M19 14 A6 6 0 0 0 31 14" class="c-line"/>
    <path d="M19 14 A6 6 0 0 1 31 14" class="c-line dash"/>
    <line x1="22" y1="-1" x2="28" y2="-1" class="c-board"/>
    <circle cx="${RIM.x}" cy="${RIM.y}" r="0.75" class="c-rim"/>
    <path d="M21 -1 L21 ${RIM.y} A4 4 0 0 0 29 ${RIM.y} L29 -1" class="c-line"/>
    <path d="M${CORNER_X} ${BASE_Y} L${CORNER_X} ${ARC_JOIN_Y.toFixed(2)} A${ARC_R} ${ARC_R} 0 0 0 ${50 - CORNER_X} ${ARC_JOIN_Y.toFixed(2)} L${50 - CORNER_X} ${BASE_Y}" class="c-line three"/>
    <line x1="0" y1="${HALF_Y}" x2="50" y2="${HALF_Y}" class="c-line"/>
    <path d="M19 ${HALF_Y} A6 6 0 0 1 31 ${HALF_Y}" class="c-line"/>
    <rect x="0" y="${BASE_Y}" width="50" height="${HALF_Y - BASE_Y}" class="c-edge"/>`;
  const marks = shots
    .filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y) && s.y <= HALF_Y)
    .map((s, index) => {
      const side = s.team_id === home?.team_id ? 'h' : s.team_id === away?.team_id ? 'a' : 'n';
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
        ? `<circle cx="${s.x}" cy="${s.y}" r="0.85" class="${markerClass}"/>`
        : `<g class="${markerClass}"><line x1="${s.x - 0.6}" y1="${s.y - 0.6}" x2="${s.x + 0.6}" y2="${s.y + 0.6}"/><line x1="${s.x - 0.6}" y1="${s.y + 0.6}" x2="${s.x + 0.6}" y2="${s.y - 0.6}"/></g>`;
      const clipId = `shot-photo-${String(s.seq ?? index).replace(/[^a-z0-9_-]/gi, '')}-${index}`;
      const photoMarker = hasPhoto ? `
        <defs><clipPath id="${clipId}"><circle cx="${s.x}" cy="${s.y}" r="1.24"/></clipPath></defs>
        <g class="shot-photo-marker ${s.made ? 'made' : 'miss'} ${side}" aria-hidden="true">
          <circle cx="${s.x}" cy="${s.y}" r="1.42" class="shot-photo-halo"/>
          <image href="${escapeXml(s.photo.square)}" x="${s.x - 1.24}" y="${s.y - 1.24}" width="2.48" height="2.48"
            preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" class="shot-photo"/>
          <circle cx="${s.x}" cy="${s.y}" r="1.27" class="shot-photo-ring"/>
          ${s.made ? '<circle cx="' + s.x + '" cy="' + s.y + '" r="1.48" class="shot-photo-result"/>' : '<path d="M' + (s.x - 1.0) + ' ' + (s.y - 1.0) + ' L' + (s.x + 1.0) + ' ' + (s.y + 1.0) + ' M' + (s.x - 1.0) + ' ' + (s.y + 1.0) + ' L' + (s.x + 1.0) + ' ' + (s.y - 1.0) + '" class="shot-photo-result"/>'}
        </g>` : classicMarker;
      return `<g class="${pointClass}" role="button" tabindex="0" aria-label="${escapeXml(aria)}" ${data} data-shot-point>
        <circle cx="${s.x}" cy="${s.y}" r="${hasPhoto ? 2.1 : 1.9}" class="shot-latest-ring" aria-hidden="true"/>
        ${photoMarker}
        <circle cx="${s.x}" cy="${s.y}" r="${hasPhoto ? 2.55 : 2.35}" class="shot-hit" aria-hidden="true"/>
      </g>`;
    })
    .join('');
  return `<svg class="court ${cls}" viewBox="-1 ${BASE_Y - 1} 52 ${HALF_Y - BASE_Y + 2}" role="group" aria-label="Interactive half-court shot chart. Hover, focus, or tap a shot for the play. Published shot locations only.">
    <g class="c-lines">${lines}</g><g class="court-shots">${marks}</g></svg>`;
}

function periodName(n) {
  const x = Number(n);
  if (!x) return '';
  return x <= 4 ? `Q${x}` : x === 5 ? 'OT' : `${x - 4}OT`;
}

function escapeXml(s) {
  return String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
}
