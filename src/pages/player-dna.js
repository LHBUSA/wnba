// /players/:id/dna — the full WNBA Player DNA profile. Every number comes from wnba-api /v1/dna/*
// (prepared KV documents) and the existing player endpoint (photo, career seasons). Nothing is computed here.
//
// URL state (survives refresh and is shareable): ?scope=<scope>&cmp=<scope>&vs=<espn id>. Changes are written
// with history.replaceState (no remount, no refetch of the profile); a reload re-reads them from ctx.query.
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { routeMeta } from '../seo/meta.js';
import { bindDnaInteractions, comparableScopes, profileUrl } from '../ui/dna.js';
import { dnaUsable, renderHero, renderScopeTabs, renderProfile, renderCompareControls, stateFromQuery } from '../views/player-dna.js';
import { esc } from '../lib/dom.js';

export const title = () => 'Player DNA';

export async function mount(root, ctx) {
  const id = ctx.params.playerId;
  root.innerHTML = `<div class="dna-page">${skeleton(320)}${skeleton(420)}</div>`;
  const [dna, meta, player] = await Promise.all([api.dnaPlayer(id), api.dnaMeta(), api.player(id)]);
  if (!ctx.isCurrent()) return;
  if (!dnaUsable(dna)) {
    root.innerHTML = `<div class="dna-page"><div class="empty"><h3>Player DNA is not available for this player</h3><p>${dna?.data?.reason === 'no_snapshot' ? 'No archived WNBA appearance for this player in the DNA season.' : 'The Player DNA service is not published yet.'} Nothing is shown in its place.</p><p><a class="gold" href="/players/${esc(id)}">Back to the player page →</a></p></div></div>`;
    return;
  }
  const body = dna.data;
  const m = meta?.ok ? meta.data : null;
  const p = player?.ok ? player.data : null;
  ctx.setMeta(routeMeta('player-dna', { path: ctx.path, params: ctx.params, data: body }));

  const state = stateFromQuery(ctx.query, body, id);
  let vsBody = null;
  let idx = null;
  let alive = true;

  const syncUrl = () => { try { history.replaceState({}, '', profileUrl(id, state)); } catch { /* ignore */ } };
  const loadVs = async () => {
    if (!state.vs) { vsBody = null; return; }
    const r = await api.dnaPlayer(state.vs);
    vsBody = dnaUsable(r) ? r.data : null;
    if (!vsBody) state.vs = '';
  };
  const fillVsList = () => {
    const dl = root.querySelector('#dna-vs-list');
    if (!dl || !idx?.players) return;
    dl.innerHTML = idx.players.filter((x) => x.id !== id && x.name && x.season_calculated).map((x) => `<option value="${esc(x.name)}"></option>`).join('');
  };
  const paint = () => {
    if (state.cmp && !comparableScopes(body, state.scope).includes(state.cmp)) state.cmp = '';
    root.innerHTML = `<div class="dna-page">
      ${renderHero(body, p?.photo || null)}
      ${renderScopeTabs(body, state.scope, { vs: state.vs })}
      ${renderCompareControls(body, state.scope, { cmp: state.cmp, vs: state.vs, vsName: vsBody?.player?.name || '' })}
      <div class="dna-body">${renderProfile(body, state.scope, { meta: m, career: p?.career || null, cmp: state.cmp, vsBody })}</div>
    </div>`;
    fillVsList();
  };
  await loadVs();
  if (!alive || !ctx.isCurrent()) return;
  syncUrl(); // drop any invalid parameter from the address bar
  paint();

  // Scope tabs are links (shareable); switch in place without a remount or a refetch.
  const onClick = (e) => {
    const clear = e.target.closest?.('[data-action="vs-clear"]');
    if (clear && root.contains(clear)) { state.vs = ''; vsBody = null; syncUrl(); paint(); return; }
    const a = e.target.closest?.('a[data-scope]');
    if (!a || !root.contains(a) || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    state.scope = a.dataset.scope;
    syncUrl();
    paint();
  };
  const onChange = async (e) => {
    const t = e.target;
    if (t.dataset?.ctl === 'cmp') {
      state.cmp = comparableScopes(body, state.scope).includes(t.value) ? t.value : '';
      syncUrl(); paint();
      root.querySelector('#dna-cmp')?.scrollIntoView({ block: 'start' });
    } else if (t.dataset?.ctl === 'vs') {
      const name = t.value.trim().toLowerCase();
      const hit = idx?.players?.find((x) => String(x.name || '').toLowerCase() === name && x.id !== id);
      if (!hit) return;
      state.vs = hit.id;
      await loadVs();
      if (!alive) return;
      syncUrl(); paint();
      root.querySelector('#dna-vs')?.scrollIntoView({ block: 'start' });
    }
  };
  const onFocus = async (e) => {
    if (e.target?.dataset?.ctl !== 'vs' || idx) return;
    const r = await api.dnaIndex();
    if (!alive) return;
    idx = r?.ok ? r.data : null;
    fillVsList();
  };
  root.addEventListener('click', onClick, true);
  root.addEventListener('change', onChange);
  // Picking a datalist suggestion fires `input` (no blur needed); only the player search listens to it.
  const onInput = (e) => { if (e.target?.dataset?.ctl === 'vs') onChange(e); };
  root.addEventListener('input', onInput);
  root.addEventListener('focusin', onFocus);
  const unbind = bindDnaInteractions(root);
  return () => { alive = false; root.removeEventListener('click', onClick, true); root.removeEventListener('change', onChange); root.removeEventListener('input', onInput); root.removeEventListener('focusin', onFocus); unbind(); };
}
