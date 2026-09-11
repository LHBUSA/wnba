import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { pageHead, errorState, skeleton } from '../ui/components.js';

export const title = () => 'Track record';
export const description = () => 'PropBetEdge WNBA track record: picks recorded before tip, frozen prices, deterministic grading, visible samples. The ledger is shown exactly as it stands.';

export async function mount(root, ctx) {
  render(root, html`${pageHead({ eyebrow: 'Trust', title: 'Track record' })}${skeleton(300)}`);
  const res = await api.trackRecord();
  if (!ctx.isCurrent()) return;
  if (!res.ok) return render(root, errorState(res, 'The track record'));
  const d = res.data;
  render(root, html`
    ${pageHead({ eyebrow: 'Trust', title: 'Track record', sub: 'The WNBA ledger is empty because no PropBetEdge WNBA pick has been recorded yet. It will fill only with picks made before tip — never with backfilled results.' })}
    <div class="tiles">
      <div class="tile"><small>Picks recorded</small><b>${d.picks_recorded}</b><span>before tip</span></div>
      <div class="tile"><small>Graded</small><b>${d.graded}</b><span>W ${d.wins} · L ${d.losses} · P ${d.pushes}</span></div>
      <div class="tile"><small>Hit rate</small><b>—</b><span>n = 0</span></div>
      <div class="tile"><small>ROI</small><b>—</b><span>priced picks only</span></div>
    </div>
    <div class="grid g2 section">
      <section class="card card-pad">
        <span class="eyebrow">Doctrine</span>
        <ul class="pro-list">${d.doctrine.map((x) => html`<li>${x}</li>`)}<li>${d.roi_note}</li><li>Hit rate may include unpriced picks; ROI never does.</li></ul>
      </section>
      <section class="card card-pad">
        <span class="eyebrow">Model status</span>
        <p style="margin-top:12px;color:var(--paper-2)">${d.model.note}</p>
        <p class="note" style="margin-top:12px">Enforced in the database, not just the UI: a pick row must be created before its game’s tip time, its line and price are immutable once written, a graded result cannot be changed, and picks cannot be deleted.</p>
      </section>
    </div>
  `);
}
