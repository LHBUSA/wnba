// Small, dependency-free SVG charts. They draw only the points they are given.

const QUARTER = 600;

/** Score margin over game time. points: [[elapsed_s, margin]], positive = home leads. */
export function marginChart(points, { home, away, cursorS = null, width = 720, height = 190, periods = 4 } = {}) {
  if (!points?.length) return '';
  const maxT = Math.max(periods * QUARTER, ...points.map((p) => p[0]));
  const maxAbs = Math.max(6, ...points.map((p) => Math.abs(p[1])));
  const pad = { l: 34, r: 10, t: 12, b: 22 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const x = (t) => pad.l + (t / maxT) * W;
  const y = (m) => pad.t + H / 2 - (m / maxAbs) * (H / 2);
  let d = `M${x(0)},${y(0)}`;
  let prev = 0;
  for (const [t, m] of points) {
    d += ` L${x(t).toFixed(1)},${y(prev).toFixed(1)} L${x(t).toFixed(1)},${y(m).toFixed(1)}`;
    prev = m;
  }
  const last = points.at(-1);
  d += ` L${x(Math.max(last[0], cursorS ?? last[0])).toFixed(1)},${y(prev).toFixed(1)}`;
  const qs = [];
  for (let q = 1; q * QUARTER < maxT; q++) {
    const t = q <= 4 ? q * QUARTER : 4 * QUARTER + (q - 4) * 300;
    if (t >= maxT) break;
    qs.push(`<line x1="${x(t)}" y1="${pad.t}" x2="${x(t)}" y2="${pad.t + H}" class="ch-grid"/><text x="${x(t) - 4}" y="${height - 6}" class="ch-lbl" text-anchor="end">Q${q}</text>`);
  }
  const tick = Math.ceil(maxAbs / 10) * 5 || 5;
  const cursor = cursorS !== null ? `<line x1="${x(cursorS)}" y1="${pad.t}" x2="${x(cursorS)}" y2="${pad.t + H}" class="ch-cursor"/>` : '';
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Score margin over game time">
    <rect x="${pad.l}" y="${pad.t}" width="${W}" height="${H / 2}" class="ch-home-zone"/>
    <rect x="${pad.l}" y="${pad.t + H / 2}" width="${W}" height="${H / 2}" class="ch-away-zone"/>
    ${qs.join('')}
    <line x1="${pad.l}" y1="${y(0)}" x2="${pad.l + W}" y2="${y(0)}" class="ch-zero"/>
    <text x="${pad.l - 6}" y="${y(tick) + 4}" class="ch-lbl" text-anchor="end">+${tick}</text>
    <text x="${pad.l - 6}" y="${y(-tick) + 4}" class="ch-lbl" text-anchor="end">−${tick}</text>
    <text x="${pad.l + 6}" y="${pad.t + 12}" class="ch-lbl home">${home?.abbr || 'HOME'} leads</text>
    <text x="${pad.l + 6}" y="${pad.t + H - 4}" class="ch-lbl away">${away?.abbr || 'AWAY'} leads</text>
    <path d="${d}" class="ch-line"/>
    ${cursor}
  </svg>`;
}

/** Step series [[t, v]] for one player stat. */
export function progressionChart(seriesList, { width = 720, height = 170, maxT = 2400, labels = [] } = {}) {
  const all = seriesList.flat();
  if (!all.length) return '';
  const maxV = Math.max(4, ...all.map((p) => p[1]));
  const pad = { l: 30, r: 10, t: 10, b: 22 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const x = (t) => pad.l + (Math.min(t, maxT) / maxT) * W;
  const y = (v) => pad.t + H - (v / maxV) * H;
  const paths = seriesList.map((s, i) => {
    let d = `M${x(0)},${y(0)}`;
    let prev = 0;
    for (const [t, v] of s) { d += ` L${x(t).toFixed(1)},${y(prev).toFixed(1)} L${x(t).toFixed(1)},${y(v).toFixed(1)}`; prev = v; }
    d += ` L${x(maxT)},${y(prev)}`;
    return `<path d="${d}" class="pg-line s${i}"/><text x="${width - pad.r}" y="${y(prev) - 4}" class="ch-lbl s${i}" text-anchor="end">${labels[i] || ''} ${prev}</text>`;
  });
  const grid = [1, 2, 3].map((q) => `<line x1="${x(q * QUARTER)}" y1="${pad.t}" x2="${x(q * QUARTER)}" y2="${pad.t + H}" class="ch-grid"/>`).join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Cumulative player production over game time">
    ${grid}<line x1="${pad.l}" y1="${y(0)}" x2="${pad.l + W}" y2="${y(0)}" class="ch-zero"/>
    <text x="${pad.l - 6}" y="${y(maxV) + 8}" class="ch-lbl" text-anchor="end">${maxV}</text>
    ${paths.join('')}
  </svg>`;
}

export function sparkline(values, { width = 120, height = 32, cls = '' } = {}) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return '';
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const pts = v.map((val, i) => `${((i / (v.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 3 - ((val - min) / span) * (height - 6)).toFixed(1)}`);
  return `<svg class="spark ${cls}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><polyline points="${pts.join(' ')}"/><circle cx="${pts.at(-1).split(',')[0]}" cy="${pts.at(-1).split(',')[1]}" r="2.2"/></svg>`;
}

/** Horizontal comparison bar for two values (e.g. team A vs team B). */
export function versusBar(a, b, { higherIsBetter = true } = {}) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
  const tot = Math.abs(a) + Math.abs(b) || 1;
  const pa = (Math.abs(a) / tot) * 100;
  const aBetter = higherIsBetter ? a >= b : a <= b;
  return `<div class="vbar"><span class="vbar-a ${aBetter ? 'win' : ''}" style="width:${pa.toFixed(1)}%"></span><span class="vbar-b ${!aBetter ? 'win' : ''}" style="width:${(100 - pa).toFixed(1)}%"></span></div>`;
}
