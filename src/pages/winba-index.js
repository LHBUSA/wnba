// The WinBA Index archive — the permanent home of the monthly franchise.

import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { routeMeta } from '../seo/meta.js';
import { loadWinbaIndexArchive, winbaIndexArchiveView, WINBA_INDEX_SERIES } from '../views/winba-index.js';

export const title = () => WINBA_INDEX_SERIES;
export const description = () => 'Every edition of The WinBA Index, PropBetEdge’s monthly record of the WNBA’s top players by WinBA Score. Each month is frozen at publication.';

export async function mount(root, ctx) {
  render(root, html`<header class="masthead"><span class="eyebrow">PropBetEdge original metric · monthly record</span><h1 class="mast-title">${WINBA_INDEX_SERIES}</h1></header>${skeleton(380)}`);

  const data = await loadWinbaIndexArchive(api);
  if (!ctx.isCurrent()) return;

  const view = winbaIndexArchiveView(data);
  const items = view.items || [];
  ctx.setMeta(routeMeta('winba-index', { path: ctx.path, data: { items }, empty: !items.length }));
  render(root, view.body);
}
