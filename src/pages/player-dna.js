// /players/:id/dna — the full WNBA Player DNA profile. Every number comes from wnba-api /v1/dna/*
// (prepared KV documents) and the existing player endpoint (photo, career seasons). Nothing is computed here.
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { routeMeta } from '../seo/meta.js';
import { isScope, bindDnaInteractions } from '../ui/dna.js';
import { dnaUsable, renderHero, renderScopeTabs, renderProfile } from '../views/player-dna.js';
import { esc } from '../lib/dom.js';

export const title = () => 'Player DNA';

export async function mount(root, ctx) {
  const id = ctx.params.playerId;
  let scope = isScope(ctx.query?.scope) ? ctx.query.scope : 'season';
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
  if (!body.scopes?.[scope]?.calculated && scope !== 'season') scope = 'season';

  const paint = () => {
    root.innerHTML = `<div class="dna-page">
      ${renderHero(body, p?.photo || null)}
      ${renderScopeTabs(body, scope)}
      <div class="dna-body">${renderProfile(body, scope, { meta: m, career: p?.career || null })}</div>
    </div>`;
  };
  paint();

  // Scope tabs are links (shareable ?scope=); switch in place without a remount or a refetch.
  const onClick = (e) => {
    const a = e.target.closest?.('a[data-scope]');
    if (!a || !root.contains(a) || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    scope = a.dataset.scope;
    try { history.replaceState({}, '', a.getAttribute('href')); } catch { /* ignore */ }
    paint();
  };
  root.addEventListener('click', onClick, true);
  const unbind = bindDnaInteractions(root);
  return () => { root.removeEventListener('click', onClick, true); unbind(); };
}
