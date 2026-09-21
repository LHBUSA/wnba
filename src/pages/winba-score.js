import { render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { loadWinbaScore, winbaScoreView } from '../views/winba-score.js';

export const title = () => 'WinBA Score';
export const description = () => 'The formula, current WNBA player rankings, qualification rules and limitations behind PropBetEdge’s 0–100 WinBA winning-impact index.';

export async function mount(root, ctx) {
  render(root, winbaScoreView());
  const data = await loadWinbaScore(api);
  if (!ctx.isCurrent()) return;
  render(root, winbaScoreView(data));
}
