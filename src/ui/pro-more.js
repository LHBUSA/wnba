const PRO_MORE = [
  ['edge-timeline', '/edge-timeline', 'Edge Timeline · PRO'],
  ['rotation-impact', '/rotation-impact', 'Rotation Impact · PRO'],
  ['scenario-lab', '/scenario-lab', 'Scenario Lab · PRO'],
  ['watchlist', '/watchlist', 'Watchlist · PRO']
];

function insertAfter(anchor, node) {
  if (!anchor?.parentNode) return false;
  anchor.parentNode.insertBefore(node, anchor.nextSibling);
  return true;
}

function addLinks(container, afterSelector) {
  if (!container) return;
  let cursor = container.querySelector(afterSelector);
  for (const [id, href, label] of PRO_MORE) {
    if (container.querySelector(`[data-nav="${id}"]`)) {
      cursor = container.querySelector(`[data-nav="${id}"]`);
      continue;
    }
    const a = document.createElement('a');
    a.href = href;
    a.dataset.nav = id;
    a.textContent = label;
    if (cursor && insertAfter(cursor, a)) cursor = a;
    else container.append(a);
  }
}

/**
 * The server shell can lag the Vercel client bundle while Cloudflare is being promoted.
 * Keep the visible More/drawer product navigation current without replacing page content.
 */
export function enhanceProMore(root = document) {
  addLinks(root.querySelector('#nav-more-menu'), '[data-nav="player-load"]');
  addLinks(root.querySelector('.drawer-panel'), '[data-nav="player-load"]');
}
