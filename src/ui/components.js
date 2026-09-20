import { html, raw } from '../lib/dom.js';
import { STATE_LABEL, currentState, ageMs, formatAge } from '../data/freshness.js';
import { fmtTimeET, fmtDateET, initials, relTime, num } from '../lib/format.js';
import { teamLogo } from './logo.js';

// ------------------------------------------------------------ game state

/** One place decides how a game's state is labelled. */
export function gameState(g, { replay = false } = {}) {
  const s = g?.status?.state;
  if (replay && s === 'post') return { key: 'replay', label: 'Replay' };
  if (s === 'in') {
    const n = g.status?.name || '';
    if (/HALFTIME/.test(n)) return { key: 'live', label: 'Halftime' };
    if (/END_PERIOD/.test(n)) return { key: 'live', label: `End ${periodName(g.status.period)}` };
    return { key: 'live', label: `${periodName(g.status?.period)} ${g.status?.clock ?? ''}`.trim() };
  }
  if (s === 'post') return { key: 'final', label: (g.home?.linescores?.length || 0) > 4 ? `Final/${g.home.linescores.length === 5 ? 'OT' : `${g.home.linescores.length - 4}OT`}` : 'Final' };
  if (s === 'pre') {
    if (/POSTPONED|CANCELED|DELAYED|SUSPENDED/.test(g.status?.name || '')) return { key: 'stale', label: g.status.short_detail || 'Postponed' };
    return { key: 'sched', label: fmtTimeET(g.start_utc) };
  }
  return { key: 'stale', label: 'Unknown' };
}

export function periodName(p) {
  if (!p) return '';
  if (p <= 4) return `Q${p}`;
  return p === 5 ? 'OT' : `${p - 4}OT`;
}

export const badge = (key, label) => html`<span class="badge ${key}">${label}</span>`;

export function teamDot(t, size = 20) {
  return t?.team_id || t?.abbr ? teamLogo(t, size) : html`<span class="team-dot" style="background:${safeColor(t?.color)}"></span>`;
}

export function safeColor(c, fallback = 'var(--ink-4)') {
  return /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : fallback;
}

const BOOKS = { draftkings: 'DraftKings', fanduel: 'FanDuel', betmgm: 'BetMGM', betrivers: 'BetRivers', fanatics: 'Fanatics', bovada: 'Bovada', williamhill_us: 'Caesars', lowvig: 'LowVig', betonlineag: 'BetOnline', espnbet: 'ESPN BET' };
const bk = (k) => BOOKS[k] || k || '';
const am = (v) => (v === null || v === undefined ? '—' : v > 0 ? `+${v}` : String(v));
const line = (v) => (v === null || v === undefined ? '—' : v > 0 ? `+${v}` : String(v));

/** Three-cell market strip (spread / total / moneyline) from a stored snapshot. */
export function marketStrip(m, g) {
  if (!m) return '';
  const h = g.home?.abbr || 'HOME';
  const a = g.away?.abbr || 'AWAY';
  return html`<div class="mkt-strip" aria-label="Market snapshot">
    <div class="mk"><small>Spread</small><b>${h} ${line(m.spread.home_line)}</b><span>${m.spread.home_best ? `${am(m.spread.home_best.price)} ${bk(m.spread.home_best.book)}` : '—'}</span></div>
    <div class="mk"><small>Total</small><b>${m.total.line ?? '—'}</b><span>${m.total.over_best ? `O ${am(m.total.over_best.price)} ${bk(m.total.over_best.book)}` : '—'}</span></div>
    <div class="mk"><small>Moneyline</small><b>${a} ${am(m.moneyline.away_best?.price)}</b><span>${h} ${am(m.moneyline.home_best?.price)}</span></div>
  </div>
  <div class="mkt-note">Best prices across <b>${m.books} books</b> · The Odds API · ${m.semantics === 'LAST_PRE_TIP_SNAPSHOT' ? 'last pre-tip capture' : 'captured'} ${relTime(m.captured_at)}${m.stale ? ' · STALE' : ''}${m.props?.available ? ` · props: ${m.props.players} players` : ''}</div>`;
}

export function gameCard(g, { showDate = false, links = true } = {}) {
  const st = gameState(g);
  const post = g.status?.state === 'post';
  const row = (t, other) => {
    const lost = post && t?.score !== null && other?.score !== null && t.score < other.score;
    return html`<div class="gc2-row ${lost ? 'lost' : ''}">
      ${teamLogo(t, 40)}
      <span class="tn"><b>${t?.short_name || t?.abbr || 'TBD'}</b><small>${t?.location ? `${t.location} · ` : ''}${t?.record || t?.abbr || ''}</small></span>
      <span class="sc">${g.status?.state === 'pre' ? '' : t?.score ?? ''}</span>
    </div>`;
  };
  return html`<article class="gc2" style="--home-c:${safeColor(g.home?.color, '#555')};--away-c:${safeColor(g.away?.color, '#555')}">
    <div class="gc2-top">${badge(st.key, st.label)}<span class="gc2-when">${showDate || post ? fmtDateET(g.start_utc) : ''}</span></div>
    ${row(g.away, g.home)}
    ${row(g.home, g.away)}
    ${g.market ? marketStrip(g.market, g) : g.status?.state === 'pre' ? html`<div class="mkt-note">No market snapshot for this game yet · captured 8:00 / 1:00 / 6:00 ET</div>` : ''}
    ${g.venue?.name ? html`<div class="mkt-note">${g.venue.name}${g.venue.city ? `, ${g.venue.city}` : ''}${g.broadcasts?.length ? ` · ${g.broadcasts.slice(0, 2).join(' / ')}` : ''}</div>` : ''}
    ${links ? html`<div class="gc2-foot">
      <a class="primary" href="/cast/${g.game_id}">${g.status?.state === 'in' ? 'Live in WNBACast' : post ? 'Replay' : 'WNBACast'}</a>
      <a href="/matchups/${g.game_id}">Matchup</a>
    </div>` : ''}
  </article>`;
}

// ------------------------------------------------------------ freshness

const SPORTS_DATA_SOURCE = 'PropSports.PropTechUSA.ai';
const SPORTS_DATA_SOURCE_URL = 'https://propsports.proptechusa.ai';

export function sourceLine(meta, { label } = {}) {
  if (!meta) return html`<div class="src"><span class="fresh" data-state="UNAVAILABLE">No source metadata</span></div>`;
  const state = currentState(meta);
  const age = ageMs(meta.fetched_at);
  return html`<div class="src" data-fresh="${meta.fetched_at || ''}">
    <span class="fresh" data-state="${state}">${STATE_LABEL[state] || state}</span>
    <span>Source <b><a href="${SPORTS_DATA_SOURCE_URL}" rel="noopener" target="_blank">${SPORTS_DATA_SOURCE}</a></b></span>
    ${meta.fetched_at ? html`<span>Fetched ${formatAge(age)}</span>` : ''}
    ${meta.source_updated_at ? html`<span>Source updated ${relTime(meta.source_updated_at)}</span>` : ''}
    ${label ? html`<span>${label}</span>` : ''}
    ${meta.degraded?.length ? html`<span class="badge stale">Degraded</span>` : ''}
  </div>`;
}

// ------------------------------------------------------------ people

export function avatar(p, { size = '', teamColor } = {}) {
  const photo = p?.photo;
  const tc = safeColor(teamColor || p?.team?.color, 'var(--gold)');
  if (photo?.square) {
    return html`<span class="avatar ${size}" style="--tc:${tc}"><img src="${photo.square}" alt="${p.name || ''}" width="128" height="128" loading="lazy" decoding="async" /></span>`;
  }
  return html`<span class="avatar ${size}" style="--tc:${tc}" aria-hidden="true"><span class="mono-init">${initials(p?.name)}</span></span>`;
}

export function playerCard(p) {
  const tc = safeColor(p.team?.color, 'var(--gold)');
  return html`<a class="card pcard" href="/players/${p.athlete_id}" style="--tc:${tc}">
    <div class="pcard-img">
      <span class="tband"></span>
      ${p.photo?.portrait
        ? html`<img src="${p.photo.portrait}" alt="${p.name}" width="600" height="750" loading="lazy" decoding="async" />`
        : html`<div class="fallback" aria-hidden="true"><span class="init">${initials(p.name)}</span>${p.jersey ? html`<span class="jersey">#${p.jersey}</span>` : ''}</div>`}
    </div>
    <div class="pcard-meta">
      <div class="pcard-name-row">
        <b>${p.name}</b>
        ${p.winba ? html`<span class="winba-mini ${p.winba.qualified ? '' : 'provisional'}" title="WinBA Score · PropBetEdge winning-impact index">${num(p.winba.score)}<em>WINBA</em></span>` : ''}
      </div>
      <small>${[p.team?.abbr, p.position, p.jersey ? `#${p.jersey}` : null].filter(Boolean).join(' · ')}</small>
    </div>
  </a>`;
}

export function statusBadge(status) {
  const s = String(status || '');
  if (/out/i.test(s)) return badge('out', s);
  if (/day|question|doubt|probable/i.test(s)) return badge('dtd', s);
  return badge('', s || '—');
}

// ------------------------------------------------------------ states

export function empty(title, body, extra = '') {
  return html`<div class="empty"><h3>${title}</h3><p>${body}</p>${extra}</div>`;
}

export function errorState(res, what = 'This data') {
  const code = res?.error?.code || 'unavailable';
  return html`<div class="empty err"><h3>${what} is unavailable</h3><p>The source did not answer (${code}). Nothing is shown in its place — no stand-in numbers.</p></div>`;
}

export function skeleton(h = 120, n = 1) {
  return raw(Array.from({ length: n }, () => `<div class="skel" style="height:${h}px;margin-bottom:12px"></div>`).join(''));
}

export function pageHead({ eyebrow, title, sub, right = '' }) {
  return html`<div class="page-head"><div><span class="eyebrow">${eyebrow}</span><h1 class="page-title">${title}</h1>${sub ? html`<p class="page-sub">${sub}</p>` : ''}</div>${right}</div>`;
}

export function entityChips(entities = []) {
  return entities
    .filter((e) => e.type === 'player' || e.type === 'team' || e.type === 'game')
    .slice(0, 6)
    .map((e) => {
      const href = e.type === 'player' ? `/players/${e.id}` : e.type === 'team' ? `/teams/${e.id}` : `/cast/${e.id}`;
      return html`<a class="chip" href="${href}">${e.type === 'team' ? teamLogo({ team_id: e.id, name: e.name }, 16) : ''}${e.type === 'game' ? '▶ ' : ''}${e.name || e.id}</a>`;
    });
}

/** Re-age every visible freshness label once a second (no data refetch). */
export function startFreshTicker(root) {
  const t = setInterval(() => {
    root.querySelectorAll('[data-fresh]').forEach((el) => {
      const at = el.getAttribute('data-fresh');
      const span = el.querySelector('span:nth-child(3)');
      if (at && span && span.textContent.startsWith('Fetched')) span.textContent = `Fetched ${formatAge(ageMs(at))}`;
    });
  }, 1000);
  return () => clearInterval(t);
}
