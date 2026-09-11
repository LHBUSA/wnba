import { html, render } from '../lib/dom.js';

export const title = () => 'Not found';

export async function mount(root) {
  render(root, html`<div class="empty" style="margin-top:40px"><h3>That page isn’t on the court</h3><p>Try <a class="gold" href="/">Today</a>, <a class="gold" href="/cast">WNBACast</a> or <a class="gold" href="/news">News</a>.</p></div>`);
}
