// Player page. Rendering lives in src/views/player.js (shared with the publishing Worker).
import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { loadPlayer, playerView } from '../views/player.js';
import { routeMeta } from '../seo/meta.js';
import { membershipFrom, isMember } from '../lib/membership.js';
import { mountDnaRow, fetchDnaRow, fillDnaRow } from '../views/player-dna.js';

export const title = () => 'Player';

export async function mount(root, ctx) {
  const id = ctx.params.playerId;
  render(root, html`<div class="p-hero">${skeleton(360)}${skeleton(360)}</div>`);
  const deps = { api, membershipFrom, isMember };
  // DNA is fetched in parallel with the page data and, when it is ready in time, rendered in the same paint so the
  // career card below it never jumps (CLS). The page never waits more than DNA_WAIT_MS beyond its own data.
  const dnaP = fetchDnaRow(id, deps).catch(() => null);
  const data = await loadPlayer(api, id);
  if (!ctx.isCurrent()) return;
  if (data.res.ok) ctx.setMeta(routeMeta('player', { path: ctx.path, params: ctx.params, data: data.res.data }));
  const DNA_WAIT_MS = 1500;
  const early = data.res.ok ? await Promise.race([dnaP, new Promise((r) => setTimeout(() => r(undefined), DNA_WAIT_MS))]) : null;
  if (!ctx.isCurrent()) return;
  render(root, playerView(data));
  if (!data.res.ok) return;
  let unbind = null;
  let gone = false;
  if (early !== undefined) unbind = fillDnaRow(root, early); // same paint (or null: no usable DNA)
  else mountDnaRow(root, id, ctx, deps, dnaP).then((u) => { if (gone) u?.(); else unbind = u; }).catch(() => {});
  return () => { gone = true; unbind?.(); };
}
