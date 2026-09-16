import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { routeMeta } from '../seo/meta.js';
import { dailyBriefView } from '../views/daily-brief.js';

function meta() {
  const base = routeMeta('pro', { path: '/brief' });
  return {
    ...base,
    path: '/brief',
    url: 'https://wnba.propbetedge.ai/brief',
    title: 'Free WNBA Daily Brief: Slate, PBE Coverage & Availability | PropBetEdge',
    description: 'A free WNBA intelligence brief with the current slate, PBE coverage window, sourced availability movement and the public PBE track record.'
  };
}

export async function mount(root, ctx) {
  ctx.setMeta(meta());
  render(root, html`<section class="db-shell"><div class="db-hero">${skeleton(290)}</div><div class="db-metrics">${skeleton(90, 4)}</div></section>`);
  const [today, coverage, track, injuries, teams] = await Promise.all([
    api.today(), api.pbeCoverage(), api.trackRecord(), api.injuries(), api.teams()
  ]);
  if (!ctx.isCurrent()) return;
  render(root, dailyBriefView({ today, coverage, track, injuries, teams, generatedAt: new Date().toISOString() }));
}
