import { render } from '../lib/dom.js';
import { HISTORY_HEAD, historyView } from '../views/history.js';

const DESCRIPTION = 'WNBA history from 1997 to today: eras, milestones, championships, franchise lineage and the PropBetEdge historical intelligence archive.';

export const title = () => HISTORY_HEAD.title;
export const description = () => DESCRIPTION;

export async function mount(root, ctx) {
  ctx.setMeta?.({
    path: '/history',
    url: 'https://wnba.propbetedge.ai/history',
    title: 'WNBA History: Eras, Championships, Franchises & Records | PropBetEdge',
    description: DESCRIPTION,
    robots: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
    type: 'website',
    image: {
      url: 'https://wnba.propbetedge.ai/share/propbetedge-wnba-social-v2.jpg',
      alt: 'PropBetEdge WNBA History Intelligence'
    }
  });
  render(root, historyView());
}
