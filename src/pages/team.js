// Team page. Rendering lives in src/views/team.js (shared with the publishing Worker).
import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { loadTeam, teamView } from '../views/team.js';
import { routeMeta } from '../seo/meta.js';

export const title = () => 'Team';

export async function mount(root, ctx) {
  render(root, html`${skeleton(220)}${skeleton(420)}`);
  const data = await loadTeam(api, ctx.params.teamId);
  if (!ctx.isCurrent()) return;
  if (data.res.ok) ctx.setMeta(routeMeta('team', { path: ctx.path, params: ctx.params, data: data.res.data }));
  render(root, teamView(data));
}
