import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { routeMeta } from '../seo/meta.js';
import { errorState, skeleton, badge, entityChips } from '../ui/components.js';
import { fmtDateTimeET } from '../lib/format.js';

export const title = () => 'PBE Desk';

export async function mount(root, ctx) {
  render(root, skeleton(420));
  const res = await api.story(ctx.params.storyId);
  if (!ctx.isCurrent()) return;
  if (!res.ok) return render(root, errorState(res, 'This story'));
  const s = res.data;
  ctx.setMeta({ ...routeMeta('story', { path: ctx.path }), title: s.headline, description: String(s.body).split('\n\n')[0].slice(0, 200) });
  render(root, html`
    <article style="max-width:780px">
      <div class="nmeta" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${badge('pbe', 'PBE Desk')}<span class="note">${fmtDateTimeET(s.published_at)}</span><span class="note">${s.generator_version}</span></div>
      <h1 style="font:600 clamp(28px,4vw,42px)/1.15 var(--f-editorial);margin-top:14px">${s.headline}</h1>
      <div class="nents" style="display:flex;gap:6px;flex-wrap:wrap;margin:16px 0 24px">${entityChips(s.entities)}</div>
      <div class="story-body">${String(s.body).split('\n\n').map((p) => html`<p>${p}</p>`)}</div>
      <section class="card" style="margin-top:24px">
        <div class="card-head"><span class="card-title">Evidence</span><span class="note">every sentence maps to these records</span></div>
        <div class="card-body">${s.evidence.map((e) => html`<div style="margin-bottom:12px"><b>${e.source}</b><div class="note">Captured ${fmtDateTimeET(e.captured_at)} · <a href="${e.url}" rel="noopener" target="_blank" class="gold">source page ↗</a></div><pre class="mono" style="white-space:pre-wrap;font-size:12px;color:var(--dim);background:var(--ink);padding:10px;border-radius:8px;margin-top:6px;overflow-x:auto">${JSON.stringify(e.record, null, 2)}</pre></div>`)}</div>
      </section>
      <p class="note" style="margin-top:14px">${s.attribution}. Written automatically by a deterministic generator from the records above; no language model and no human embellishment.</p>
    </article>
  `);
}
