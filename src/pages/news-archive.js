// Permanent WNBA newsroom publication archive.
// The live newsroom is intentionally curated; this page is the browseable canonical record.

import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { routeMeta } from '../seo/meta.js';
import { loadArchive, archiveView } from '../views/news.js';

export const title = () => 'WNBA News Archive';

export async function mount(root, ctx) {
  render(root, html`<header class="masthead"><span class="eyebrow">Published record</span><h1 class="mast-title">WNBA News Archive</h1></header>${skeleton(420)}`);

  const archive = await loadArchive(api);
  if (!ctx.isCurrent()) return;

  const view = archiveView(archive);
  const items = view.items || [];
  ctx.setMeta(routeMeta('news-archive', {
    path: ctx.path,
    data: { items },
    empty: !items.length
  }));
  render(root, view.body);
}
