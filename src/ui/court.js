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

export function courtSvg(shots = [], { home, away, highlightSeq = null, cls = '' } = {}) {
  const lines = `
    <rect x="0" y="${BASE_Y}" width="50" height="${HALF_Y - BASE_Y}" class="c-floor"/>
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
    .map((s) => {
      const side = s.team_id === home?.team_id ? 'h' : s.team_id === away?.team_id ? 'a' : 'n';
      const hl = highlightSeq !== null && s.seq === highlightSeq ? ' hl' : '';
      const title = `<title>${escapeXml(s.text || '')}</title>`;
      if (s.made) return `<circle cx="${s.x}" cy="${s.y}" r="0.85" class="shot made ${side}${hl}">${title}</circle>`;
      return `<g class="shot miss ${side}${hl}">${title}<line x1="${s.x - 0.6}" y1="${s.y - 0.6}" x2="${s.x + 0.6}" y2="${s.y + 0.6}"/><line x1="${s.x - 0.6}" y1="${s.y + 0.6}" x2="${s.x + 0.6}" y2="${s.y - 0.6}"/></g>`;
    })
    .join('');
  return `<svg class="court ${cls}" viewBox="-1 ${BASE_Y - 1} 52 ${HALF_Y - BASE_Y + 2}" role="img" aria-label="Half-court shot chart, published shot locations only">
    <g class="c-lines">${lines}</g><g>${marks}</g></svg>`;
}

function escapeXml(s) {
  return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
}
