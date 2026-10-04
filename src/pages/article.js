// In-house article page. Rendering lives in src/views/article.js so the publishing Worker serves the
// same story in the first HTTP response.
import { render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { errorState, skeleton } from '../ui/components.js';
import { articleView, loadArticle, loadArticleSeries } from '../views/article.js';
import { routeMeta } from '../seo/meta.js';
import { attachVideo } from '../ui/video.js';
import { articleMarketSlot, articleMarketWithin, mountArticleMarketSlot } from '../data/article-market.js';

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
  // Article market (article-market/1): read in parallel with the series, bounded by the first-paint budget; a late
  // answer only fills a slot below the viewport (mountArticleMarketSlot). Ineligible story -> no read, no slot.
  const [series, mk] = await Promise.all([loadArticleSeries(api, a), articleMarketWithin(a)]);
  if (!ctx.isCurrent()) return;
  render(root, articleView({ article: a, related: res.data.related || [], series, marketSlot: articleMarketSlot(a, mk) }));
  attachVideo(root);
  return mountArticleMarketSlot(root, a, mk);
}
