// WNBA News & Intelligence — the PropBetEdge editorial front page, desk pages and team news pages.
// Rendering lives in src/views/news.js (shared with the publishing Worker); this page adds polling and closes the
// desk menus (native <details>) on Escape or an outside click.
import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { KIND_LABEL, DESK } from '../ui/articles.js';
import { createPoller } from '../lib/poller.js';
import { routeMeta } from '../seo/meta.js';
import { loadNews, newsView, newsHeadView } from '../views/news.js';

export const title = (p) => (p.teamId ? 'Team News · WNBA News' : p.kind ? `${DESK[p.kind] || KIND_LABEL[p.kind] || 'News'} · WNBA News` : 'WNBA News & Intelligence');

export async function mount(root, ctx) {
  const kind = ctx.params.kind || null;
  const teamId = ctx.params.teamId || null;
  render(root, html`${newsHeadView(kind)}${skeleton(420)}${skeleton(200, 2)}`);

  let painted = false;
  let poller = null;
  let metaSet = false;

  const draw = async () => {
    const data = await loadNews(api, kind, teamId);
    if (!ctx.isCurrent()) return;
    // Keep the last good paint when a background refresh fails.
    if (!data.arts.ok && painted) return;
    // Remember which desk menu the reader had open across a background refresh.
    const open = [...root.querySelectorAll('details[data-desk-menu][open] > summary')].map((s) => s.textContent.trim());
    const v = newsView(data);
    render(root, v.body);
    root.querySelectorAll('details[data-desk-menu] > summary').forEach((s) => { if (open.includes(s.textContent.trim())) s.parentElement.open = true; });
    if (teamId && data.team && !metaSet) { ctx.setMeta(routeMeta('news-team', { path: ctx.path, params: ctx.params, data: { team: data.team }, empty: v.empty })); metaSet = true; }
    painted = true;
  };

  const closeMenus = (except = null) => root.querySelectorAll('details[data-desk-menu][open]').forEach((d) => { if (d !== except) d.open = false; });
  const onDoc = (e) => { const d = e.target.closest?.('details[data-desk-menu]'); closeMenus(d && root.contains(d) ? d : null); };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    const d = root.querySelector('details[data-desk-menu][open]');
    if (d) { d.open = false; d.querySelector('summary')?.focus(); }
  };
  document.addEventListener('click', onDoc);
  document.addEventListener('keydown', onKey);

  // Keep an open newsroom current without hard reloads. The shared poller pauses in hidden tabs,
  // never overlaps requests, refreshes on visibility return and stops on route unmount.
  poller = createPoller(draw, { intervalMs: 120000 });
  return () => { poller?.stop(); document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); };
}
