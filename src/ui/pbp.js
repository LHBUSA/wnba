// Play-by-play feed UI shared by the international game center and WNBACast. Renders canonical plays
// (workers/shared/pbp.js): the text is the primary information, emphasis is restrained and rule-based, filters and the
// quarter selector are compact, and live follow never yanks a reader who has scrolled back.
import { html } from '../lib/dom.js';

export const PBP_FILTERS = [['all', 'All plays'], ['scoring', 'Scoring'], ['foul', 'Fouls'], ['turnover', 'Turnovers'], ['rebound', 'Rebounds']];

/** Emphasis for a play from its own semantics and the score before/after it (both published by the provider). */
export function pbpEmphasis(p) {
  if (!p.scoring) return [];
  const out = [p.family === 'free_throw' ? 'made-ft' : p.shot_value === 3 ? 'made-3' : 'made-fg'];
  const b = p.score_before;
  if (b && Number.isFinite(p.home_score) && Number.isFinite(p.away_score) && Number.isFinite(b.home) && Number.isFinite(b.away)) {
    const before = Math.sign(b.home - b.away);
    const after = Math.sign(p.home_score - p.away_score);
    if (after === 0) out.push('tie');
    else if (before !== 0 && before !== after) out.push('lead-change');
    else if (before === 0 && b.home + b.away > 0) out.push('lead-taken');
  }
  return out;
}

const EMPHASIS_LABEL = { 'lead-change': 'Lead change', tie: 'Tie', 'lead-taken': 'Lead' };
const periodLabel = (n) => (n <= 4 ? `Q${n}` : n === 5 ? 'OT' : `${n - 4}OT`);

/** Wrap the play's primary player name in a link when an identity link exists; the rest of the text stays plain. */
function describe(p, hrefFor) {
  const name = p.primary?.name;
  const href = name && hrefFor ? hrefFor(p) : null;
  const text = p.text || p.description || '';
  if (!href || !text.startsWith(name)) return text;
  return html`<a class="pbp-name" href="${href}">${name}</a>${text.slice(name.length)}`;
}

/**
 * The feed. `plays` in source order; rendered newest first. `scoreOrder` is 'away-home' (default) or 'home-away'.
 * `hrefFor(play)` returns a player URL or null.
 */
export function pbpFeed(plays, { hrefFor = null, scoreOrder = 'away-home', emptyText = 'No plays yet.', limit = 500 } = {}) {
  if (!plays?.length) return html`<p class="note">${emptyText}</p>`;
  const periods = [...new Set(plays.map((p) => p.period).filter(Number.isFinite))];
  const rows = [...plays].reverse().slice(0, limit);
  return html`<div class="pbpfeed" data-pbp-feed>
    <div class="pbp-controls">
      <label class="pbp-select"><span class="sr-only">Show</span><select data-pbp-filter aria-label="Filter plays">${PBP_FILTERS.map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></label>
      <label class="pbp-select"><span class="sr-only">Period</span><select data-pbp-period aria-label="Filter by period"><option value="all">All periods</option>${periods.map((n) => html`<option value="${n}">${periodLabel(n)}</option>`)}</select></label>
      <span class="note pbp-count" data-pbp-count>${plays.length} plays</span>
      <button class="pbp-latest" type="button" data-pbp-latest hidden>Jump to latest ↑</button>
    </div>
    <ol class="ipbp" data-pbp-list aria-live="polite">${rows.map((p) => {
      const emph = pbpEmphasis(p);
      const tags = emph.filter((x) => EMPHASIS_LABEL[x]);
      const score = Number.isFinite(p.home_score) && Number.isFinite(p.away_score) ? (scoreOrder === 'home-away' ? `${p.home_score}–${p.away_score}` : `${p.away_score}–${p.home_score}`) : '';
      return html`<li class="${[p.scoring ? 'scoring' : '', ...emph].filter(Boolean).join(' ')}" data-seq="${p.seq ?? p.order ?? ''}" data-family="${p.scoring ? `scoring ${p.family || ''}` : p.family || 'other'}" data-period="${p.period ?? ''}">
        <span class="mono">${Number.isFinite(p.period) ? periodLabel(p.period) : ''} ${p.clock || ''}</span>
        <span class="pbp-text">${describe(p, hrefFor)}${tags.length ? html` <span class="pbp-tag">${tags.map((x) => EMPHASIS_LABEL[x]).join(' · ')}</span>` : ''}</span>
        <span class="mono pbp-score">${score}</span>
      </li>`;
    })}</ol>
  </div>`;
}

/**
 * Client behaviour, re-attached after every render. `state` persists across polls: the chosen filters, the scroll
 * position and the newest play the reader has seen. A reader scrolled away from the top is never moved; a "Jump to
 * latest" control appears when newer plays arrive.
 */
export function attachPbp(root, state) {
  const feed = root.querySelector('[data-pbp-feed]');
  if (!feed) return;
  const list = feed.querySelector('[data-pbp-list]');
  const fSel = feed.querySelector('[data-pbp-filter]');
  const pSel = feed.querySelector('[data-pbp-period]');
  const count = feed.querySelector('[data-pbp-count]');
  const latest = feed.querySelector('[data-pbp-latest]');
  const rows = [...list.querySelectorAll('li')];
  const newest = Number(rows[0]?.dataset.seq || 0);
  fSel.value = state.filter || 'all';
  if ([...pSel.options].some((o) => o.value === state.period)) pSel.value = state.period; else pSel.value = 'all';
  const apply = () => {
    let shown = 0;
    for (const li of rows) {
      const fam = li.dataset.family.split(' ');
      const ok = (fSel.value === 'all' || fam.includes(fSel.value)) && (pSel.value === 'all' || li.dataset.period === pSel.value);
      li.hidden = !ok;
      if (ok) shown += 1;
    }
    count.textContent = `${shown} of ${rows.length} plays`;
  };
  apply();
  fSel.addEventListener('change', () => { state.filter = fSel.value; apply(); });
  pSel.addEventListener('change', () => { state.period = pSel.value; apply(); });
  // Live follow: newest plays are prepended at the top. A reader who has scrolled away keeps the SAME play at the same
  // place (anchored by source sequence, not pixels); newer plays are offered with "Jump to latest" instead of moving them.
  const scrolledAway = (state.scrollTop || 0) > 40 && state.anchor;
  if (scrolledAway) {
    const row = rows.find((li) => li.dataset.seq === state.anchor.seq);
    if (row) list.scrollTop = row.offsetTop + state.anchor.delta;
  }
  if (scrolledAway && state.lastSeen && newest > state.lastSeen) latest.hidden = false;
  else state.lastSeen = newest;
  const save = () => {
    const top = list.scrollTop;
    const row = rows.find((li) => !li.hidden && li.offsetTop + li.offsetHeight > top);
    state.scrollTop = top;
    state.anchor = row ? { seq: row.dataset.seq, delta: top - row.offsetTop } : null;
    if (top <= 40) { latest.hidden = true; state.lastSeen = newest; }
  };
  list.addEventListener('scroll', save, { passive: true });
  latest.addEventListener('click', () => { list.scrollTop = 0; state.scrollTop = 0; state.anchor = null; state.lastSeen = newest; latest.hidden = true; });
}
