// In-house article page. Rendering lives in src/views/article.js so the publishing Worker serves the
// same story in the first HTTP response.
import { render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { errorState, skeleton } from '../ui/components.js';
import { articleView, loadArticle } from '../views/article.js';
import { routeMeta } from '../seo/meta.js';

export const title = () => 'WNBA News';

export async function mount(root, ctx) {
  render(root, `${skeleton(420)}${skeleton(320)}`);
  const res = await loadArticle(api, ctx.params.slug);
  if (!ctx.isCurrent()) return;
  if (!res.ok) return render(root, errorState(res, 'This article'));
  const a = res.data.article;
  // A collapsed duplicate URL serves its canonical story: show and declare the canonical address.
  if (a.slug && ctx.path !== `/news/${a.slug}`) history.replaceState({}, '', `/news/${a.slug}`);
  ctx.setMeta(routeMeta('article', { path: `/news/${a.slug}`, data: a }));
  render(root, articleView({ article: a, related: res.data.related || [] }));
}
