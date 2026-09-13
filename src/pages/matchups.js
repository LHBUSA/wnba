// Matchups list + game research. Rendering lives in src/views/matchups.js (shared with the publishing Worker).
import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { loadMatchupsList, matchupsListView, matchupsListHead, loadMatchup, matchupView } from '../views/matchups.js';
import { routeMeta } from '../seo/meta.js';

export const title = (p) => (p.gameId ? 'Matchup research' : 'Matchups');

export async function mount(root, ctx) {
  if (!ctx.params.gameId) {
    render(root, html`${matchupsListHead()}${skeleton(160, 2)}`);
    const data = await loadMatchupsList(api);
    if (!ctx.isCurrent()) return;
    render(root, matchupsListView(data));
    return;
  }
  render(root, html`${skeleton(120)}${skeleton(420)}`);
  const data = await loadMatchup(api, ctx.params.gameId);
  if (!ctx.isCurrent()) return;
  if (data.res.ok) ctx.setMeta(routeMeta('matchups', { path: ctx.path, params: ctx.params, data: data.res.data }));
  render(root, matchupView(data));
}
