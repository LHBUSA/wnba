// Small, dependency-free SVG charts. They draw only the points they are given.

const QUARTER = 600;

/** Score margin over game time. points: [[elapsed_s, margin, optionalMeta]], positive = home leads. */
export function marginChart(points, { home, away, cursorS = null, width = 720, height = 190, periods = 4 } = {}) {
  if (!points?.length) return '';
  const rows = points
    .map((p) => ({ t: Number(p[0]), m: Number(p[1]), meta: p[2] || {} }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.m));
  if (!rows.length) return '';

  const periodEnd = (p) => p <= 4 ? p * QUARTER : 4 * QUARTER + (p - 4) * 300;
  const maxT = Math.max(periodEnd(Math.max(4, periods)), ...rows.map((p) => p.t));
  const maxAbs = Math.max(6, ...rows.map((p) => Math.abs(p.m)));
  const pad = { l: 38, r: 14, t: 14, b: 28 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const x = (t) => pad.l + (Math.max(0, Math.min(t, maxT)) / maxT) * W;
  const y = (m) => pad.t + H / 2 - (m / maxAbs) * (H / 2);

  let d = `M${x(0)},${y(0)}`;
  let prev = 0;
  for (const row of rows) {
    d += ` L${x(row.t).toFixed(1)},${y(prev).toFixed(1)} L${x(row.t).toFixed(1)},${y(row.m).toFixed(1)}`;
    prev = row.m;
  }
  const last = rows.at(-1);
  d += ` L${x(Math.max(last.t, cursorS ?? last.t)).toFixed(1)},${y(prev).toFixed(1)}`;

  const periodMarks = [];
  let startS = 0;
  for (let p = 1; p <= Math.max(4, periods); p++) {
    const endS = periodEnd(p);
    const midS = startS + (endS - startS) / 2;
    const label = p <= 4 ? `Q${p}` : p === 5 ? 'OT' : `${p - 4}OT`;
    if (p > 1 && startS < maxT) {
      periodMarks.push(`<line x1="${x(startS)}" y1="${pad.t}" x2="${x(startS)}" y2="${pad.t + H}" class="ch-grid"/>`);
    }
    if (midS <= maxT) {
      periodMarks.push(`<text x="${x(midS)}" y="${height - 8}" class="ch-period-label" text-anchor="middle">${label}</text>`);
    }
    startS = endS;
    if (startS >= maxT) break;
  }

  const tick = Math.ceil(maxAbs / 10) * 5 || 5;
  const marginGrid = [
    tick,
    -tick
  ].filter((m) => Math.abs(m) < maxAbs + .001)
    .map((m) => `<line x1="${pad.l}" y1="${y(m)}" x2="${pad.l + W}" y2="${y(m)}" class="ch-margin-grid"/>`)
    .join('');

  const cursor = cursorS !== null
    ? `<line x1="${x(cursorS)}" y1="${pad.t}" x2="${x(cursorS)}" y2="${pad.t + H}" class="ch-cursor"/>`
    : '';
  const endX = x(Math.max(last.t, cursorS ?? last.t));
  const endClass = last.m > 0 ? 'home' : last.m < 0 ? 'away' : 'tied';
  const endLabel = last.m > 0
    ? `${home?.abbr || 'HOME'} +${last.m}`
    : last.m < 0
      ? `${away?.abbr || 'AWAY'} +${Math.abs(last.m)}`
      : 'TIED';

  const eventDots = rows.map((row) => {
    const kind = row.meta.transition === 'lead_change' ? 'lead-change' : row.meta.transition === 'tie' ? 'tie' : 'score-change';
    return `<circle cx="${x(row.t)}" cy="${y(row.m)}" r="${kind === 'score-change' ? 2.1 : 3.2}" class="ch-event-dot ${kind}"/>`;
  }).join('');

  const hits = rows.map((row, i) => {
    const px = x(row.t);
    const py = y(row.m);
    const prevX = i === 0 ? pad.l : x(rows[i - 1].t);
    const nextX = i === rows.length - 1 ? pad.l + W : x(rows[i + 1].t);
    const left = i === 0 ? pad.l : (prevX + px) / 2;
    const right = i === rows.length - 1 ? pad.l + W : (px + nextX) / 2;
    const m = row.meta || {};
    const awayScore = Number.isFinite(Number(m.away_score)) ? Number(m.away_score) : '';
    const homeScore = Number.isFinite(Number(m.home_score)) ? Number(m.home_score) : '';
    const period = m.period_label || (m.period ? (Number(m.period) <= 4 ? `Q${m.period}` : Number(m.period) === 5 ? 'OT' : `${Number(m.period) - 4}OT`) : '');
    const leader = row.m > 0
      ? `${home?.abbr || 'HOME'} +${row.m}`
      : row.m < 0
        ? `${away?.abbr || 'AWAY'} +${Math.abs(row.m)}`
        : 'Tied';
    const score = awayScore !== '' && homeScore !== '' ? `${away?.abbr || 'AWAY'} ${awayScore} · ${home?.abbr || 'HOME'} ${homeScore}` : '';
    const aria = [period, m.clock, leader, score, m.text].filter(Boolean).join('. ');
    return `<rect x="${left}" y="${pad.t}" width="${Math.max(1, right - left)}" height="${H}" class="ch-hit-zone"
      role="button" tabindex="0" aria-label="${escapeChart(aria)}"
      data-flow-point data-flow-x="${px}" data-flow-y="${py}" data-flow-time="${row.t}"
      data-flow-margin="${row.m}" data-flow-period="${escapeChart(period)}" data-flow-clock="${escapeChart(m.clock || '')}"
      data-flow-away-score="${awayScore}" data-flow-home-score="${homeScore}"
      data-flow-leader="${escapeChart(leader)}" data-flow-score="${escapeChart(score)}"
      data-flow-transition="${escapeChart(m.transition || 'score_change')}" data-flow-text="${escapeChart(m.text || '')}"/>`;
  }).join('');

  return `<svg class="chart margin-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Interactive score margin over game time; current margin ${escapeChart(endLabel)}">
    <rect x="${pad.l}" y="${pad.t}" width="${W}" height="${H / 2}" class="ch-home-zone"/>
    <rect x="${pad.l}" y="${pad.t + H / 2}" width="${W}" height="${H / 2}" class="ch-away-zone"/>
    ${periodMarks.join('')}
    ${marginGrid}
    <line x1="${pad.l}" y1="${y(0)}" x2="${pad.l + W}" y2="${y(0)}" class="ch-zero"/>
    <text x="${pad.l - 7}" y="${y(tick) + 4}" class="ch-lbl" text-anchor="end">+${tick}</text>
    <text x="${pad.l - 7}" y="${y(-tick) + 4}" class="ch-lbl" text-anchor="end">−${tick}</text>
    <text x="${pad.l + 7}" y="${pad.t + 13}" class="ch-lbl home">${home?.abbr || 'HOME'} leads</text>
    <text x="${pad.l + 7}" y="${pad.t + H - 5}" class="ch-lbl away">${away?.abbr || 'AWAY'} leads</text>
    <path d="${d}" class="ch-line"/>
    ${eventDots}
    ${cursor}
    <line x1="0" y1="${pad.t}" x2="0" y2="${pad.t + H}" class="ch-hover-line" data-flow-hover-line/>
    <circle cx="0" cy="0" r="4.2" class="ch-hover-dot" data-flow-hover-dot/>
    <circle cx="${endX}" cy="${y(last.m)}" r="3.6" class="ch-end-dot ${endClass}"/>
    <text x="${width - pad.r}" y="${Math.max(pad.t + 12, y(last.m) - 8)}" class="ch-end-label ${endClass}" text-anchor="end">${endLabel}</text>
    <g class="ch-hit-layer">${hits}</g>
  </svg>`;
}

function escapeChart(value) {
  return String(value ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
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
