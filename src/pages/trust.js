// Static trust & publisher pages (/about, /editorial-policy, /corrections, /methodology).
import { render } from '../lib/dom.js';
import { TRUST_VIEWS } from '../views/trust.js';

export const title = () => null;

export async function mount(root, ctx) {
  const view = TRUST_VIEWS[ctx.routeId];
  render(root, view ? view() : '');
}
