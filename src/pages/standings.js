import { render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { standingsHead, loadStandings, standingsView } from '../views/league.js';

export const title = () => 'Standings';

export async function mount(root, ctx) {
  render(root, `${standingsHead()}${skeleton(420)}`);
  const data = await loadStandings(api);
  if (!ctx.isCurrent()) return;
  render(root, standingsView(data));
}
