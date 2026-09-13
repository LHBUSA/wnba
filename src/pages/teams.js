import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { teamsHead, loadTeams, teamsView } from '../views/league.js';

export const title = () => 'Teams';

export async function mount(root, ctx) {
  render(root, html`${teamsHead()}<div class="grid g3">${skeleton(110, 6)}</div>`);
  const data = await loadTeams(api);
  if (!ctx.isCurrent()) return;
  render(root, teamsView(data));
}
