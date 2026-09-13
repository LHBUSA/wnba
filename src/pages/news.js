// WNBA News & Intelligence — the PropBetEdge editorial front page and desk pages.
// Rendering lives in src/views/news.js (shared with the publishing Worker); this page adds polling.
import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { KIND_LABEL, DESK } from '../ui/articles.js';
import { createPoller } from '../lib/poller.js';
import { loadNews, newsView, newsHeadView } from '../views/news.js';

export const title = (p) => (p.kind ? `${DESK[p.kind] || KIND_LABEL[p.kind] || 'News'} · WNBA News` : 'WNBA News & Intelligence');

export async function mount(root, ctx) {
  const kind = ctx.params.kind || null;
  render(root, html`${newsHeadView(kind)}${skeleton(420)}${skeleton(200, 2)}`);

  let painted = false;
  let poller = null;

  const draw = async () => {
    const data = await loadNews(api, kind);
    if (!ctx.isCurrent()) return;
    // Keep the last good paint when a background refresh fails.
    if (!data.arts.ok && painted) return;
    render(root, newsView(data).body);
    painted = true;
  };

  // Keep an open newsroom current without hard reloads. The shared poller pauses in hidden tabs,
  // never overlaps requests, refreshes on visibility return and stops on route unmount.
  poller = createPoller(draw, { intervalMs: 120000 });
  return () => poller?.stop();
}
