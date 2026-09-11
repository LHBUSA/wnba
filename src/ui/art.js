// Decorative broadcast art (pure SVG, no data, no marks). Used behind heroes.

export const HERO_ART = `<svg class="hero2-art" viewBox="0 0 640 420" fill="none" aria-hidden="true">
  <defs>
    <linearGradient id="hg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb36b"/><stop offset="1" stop-color="#d4af37" stop-opacity=".2"/></linearGradient>
    <linearGradient id="hg2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a2f" stop-opacity=".9"/><stop offset="1" stop-color="#ff7a2f" stop-opacity="0"/></linearGradient>
    <radialGradient id="hglow" cx=".62" cy=".38" r=".5"><stop offset="0" stop-color="#ff9a52" stop-opacity=".35"/><stop offset="1" stop-color="#ff9a52" stop-opacity="0"/></radialGradient>
    <filter id="hblur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>
  <rect width="640" height="420" fill="url(#hglow)"/>
  <g transform="translate(330 70) skewX(-14) scale(1 .62)" stroke="url(#hg1)" stroke-width="2.2" opacity=".85">
    <rect x="-20" y="0" width="360" height="400" rx="6"/>
    <rect x="100" y="0" width="120" height="190"/>
    <circle cx="160" cy="190" r="60"/>
    <path d="M10 0v90a150 150 0 0 0 300 0V0"/>
    <circle cx="160" cy="42" r="9" stroke="#ff7a2f"/>
    <line x1="130" y1="26" x2="190" y2="26" stroke="#f5f1eb" stroke-opacity=".6"/>
    <line x1="-20" y1="400" x2="340" y2="400"/>
    <path d="M100 400a60 60 0 0 1 120 0"/>
  </g>
  <g filter="url(#hblur)" opacity=".7">
    <path d="M40 360 C 180 120, 360 40, 486 128" stroke="url(#hg2)" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round"/>
  </g>
  <path d="M40 360 C 180 120, 360 40, 486 128" stroke="url(#hg2)" stroke-width="1.6" stroke-dasharray="2 10" stroke-linecap="round"/>
  <circle cx="486" cy="128" r="10" fill="#ff7a2f" opacity=".9"/>
  <circle cx="486" cy="128" r="22" stroke="#ff7a2f" stroke-opacity=".35"/>
  <circle cx="486" cy="128" r="38" stroke="#ff7a2f" stroke-opacity=".15"/>
</svg>`;
