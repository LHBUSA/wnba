import { render } from '../lib/dom.js';
import { HISTORY_HEAD, historyView } from '../views/history.js';
import { routeMeta } from '../seo/meta.js';

const DESCRIPTION = 'WNBA history from 1997 to today: eras, milestones, championships, franchise lineage and the PropBetEdge historical intelligence archive.';

export const title = () => HISTORY_HEAD.title;
export const description = () => DESCRIPTION;

export async function mount(root, ctx) {
  ctx.setMeta?.(routeMeta('history', { path: '/history' }));
  render(root, historyView());
}
