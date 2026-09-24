// Team page. Rendering lives in src/views/team.js (shared with the publishing Worker).
// The PBE Team Picker slot is server-rendered as a value-free teaser; this page replaces it client-side only with
// what wnba-api decides this visitor may see (the server checks WNBA Pro before reading any prediction).
import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { loadTeam, teamView, nextMatchup } from '../views/team.js';
import { routeMeta } from '../seo/meta.js';
import { pbeTeaser, pbeTeamPicker, pbeValidationNotice } from '../ui/pbe.js';

export const title = () => 'Team';

export async function mount(root, ctx) {
  render(root, html`${skeleton(220)}${skeleton(420)}`);
  const data = await loadTeam(api, ctx.params.teamId);
  if (!ctx.isCurrent()) return;
  if (data.res.ok) ctx.setMeta(routeMeta('team', { path: ctx.path, params: ctx.params, data: data.res.data }));
  render(root, teamView(data));
  if (data.res.ok) mountPbe(root, ctx, data);
}

async function mountPbe(root, ctx, data) {
  const slot = root.querySelector('[data-pbe-slot]');
  if (!slot) return;
  const id = ctx.params.teamId;
  const next = data.res.data.schedule.find((g) => g.status?.state !== 'post');
  if (!next) return;
  const [acct, cov] = await Promise.all([api.account(), api.pbeCoverage()]);
  if (!ctx.isCurrent()) return;
  const m = nextMatchup(next, id);
  const covered = cov.ok && cov.data.games.some((g) => g.game_id === next.game_id);
  const availability = !cov.ok ? 'unknown' : !cov.data.published ? 'validation' : covered ? 'available' : 'opens';
  if (acct.ok && acct.data?.state === 'pro') {
    const r = await api.pbeTeam(id);
    if (!ctx.isCurrent()) return;
    if (r.ok && r.data?.availability === 'MODEL_IN_VALIDATION') return render(slot, pbeValidationNotice({ compact: true }));
    if (r.ok && r.data?.call) return render(slot, pbeTeamPicker(r.data, id));
    if (r.ok) return render(slot, pbeTeaser({ ...m, availability: 'opens', next: '/pbe-picks', member: true }));
  }
  render(slot, pbeTeaser({ ...m, availability }));
}
