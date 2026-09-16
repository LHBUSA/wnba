import { render } from '../lib/dom.js';
import { HISTORY_HEAD, historyView } from '../views/history.js';

export const title = () => HISTORY_HEAD.title;
export const description = () => 'WNBA history from 1997 to today: eras, milestones, championships, franchise lineage and the PropBetEdge historical intelligence archive.';

export async function mount(root) {
  render(root, historyView());
}
