// Player page. Rendering lives in src/views/player.js (shared with the publishing Worker).
import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { loadPlayer, playerView } from '../views/player.js';
import { routeMeta } from '../seo/meta.js';
import { membershipFrom, isMember } from '../lib/membership.js';
import { mountDnaRow } from '../views/player-dna.js';

export const title = () => 'Player';

export async function mount(root, ctx) {
  const id = ctx.params.playerId;
  render(root, html`<div class="p-hero">${skeleton(360)}${skeleton(360)}</div>`);
  const data = await loadPlayer(api, id);
  if (!ctx.isCurrent()) return;
  if (data.res.ok) ctx.setMeta(routeMeta('player', { path: ctx.path, params: ctx.params, data: data.res.data }));
  render(root, playerView(data));
  if (!data.res.ok) return;
  // Not awaited: the page is complete without DNA; the row appears only if the DNA API answers.
  let unbind = null;
  let gone = false;
  mountDnaRow(root, id, ctx, { api, membershipFrom, isMember }).then((u) => { if (gone) u?.(); else unbind = u; }).catch(() => {});
  return () => { gone = true; unbind?.(); };
}
