// WNBA Newsroom — the PropBetEdge editorial front page.
// PropBetEdge's own reporting leads: a dominant photographic lead story, top stories, Latest, then the desks
// (Injury Desk, Market Watch, Previews, Performances, Team Trends, Roster Moves). The external Source Wire
// sits last, visibly attributed and subordinate — headlines and links only; the reporting belongs to them.
import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { errorState, skeleton, badge, entityChips } from '../ui/components.js';
import { articleCard, articleRow, marketChip, KIND_LABEL, DESK } from '../ui/articles.js';
import { relTime, fmtDateTimeET } from '../lib/format.js';

export const title = (p) => (p.kind ? `${DESK[p.kind] || KIND_LABEL[p.kind] || 'News'} · WNBA News` : 'WNBA News');
export const description = () => 'The PropBetEdge WNBA newsroom: in-house, source-grounded WNBA reporting on injuries, roster moves, performances, previews and market trends — each with a bettor angle and cited evidence.';

const DESKS = [
  ['injury', 'Injury Desk', 'Status changes from ESPN’s injury feed, the minutes at stake and what argues against the obvious read.'],
  ['preview', 'Previews', 'Form, rest, availability and the stored market for the next slate.'],
  ['performance', 'Performances', 'Box-score stories: who carried the night and how it compares with her season.'],
  ['trend', 'Team Trends', 'Against-the-spread and totals runs, measured against a named sportsbook’s lines.'],
  ['transaction', 'Roster Moves', 'Signings, waivers and hardship contracts from ESPN’s transactions log.']
];

const dateline = () => new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const isPhoto = (c) => c.media && (c.media.layout === 'single' || c.media.layout === 'matchup');
const ofKind = (items, k) => items.filter((c) => c.kind === k || (k === 'performance' && c.kind === 'result'));

// Editorial lead: the newest injury, else performance, else preview inside the newest 48 hours of coverage;
// among equally newsworthy stories of the same kind, a photographed one wins the tie.
function chooseLead(items) {
  if (!items.length) return null;
  const newest = Date.parse(items[0].published_at);
  const window = items.filter((c) => newest - Date.parse(c.published_at) <= 48 * 3600e3);
  for (const k of ['injury', 'performance', 'preview']) {
    const pool = ofKind(window, k);
    if (!pool.length) continue;
    const top = pool[0];
    const sameMoment = pool.filter((c) => Math.abs(Date.parse(c.published_at) - Date.parse(top.published_at)) <= 3600e3);
    return sameMoment.find(isPhoto) || top;
  }
  return items[0];
}

// Top stories: newest story from each other desk first (variety), then the newest remaining.
function topStories(items, lead, n = 3) {
  const group = (c) => (c.kind === 'result' ? 'performance' : c.kind);
  const out = [];
  const seen = new Set([group(lead)]);
  for (const c of items) if (out.length < n && c.id !== lead?.id && !seen.has(group(c))) { out.push(c); seen.add(group(c)); }
  for (const c of items) if (out.length < n && c.id !== lead?.id && !out.includes(c)) out.push(c);
  return out;
}

function marketWatch(items) {
  const seen = new Set();
  const rows = items.filter((c) => c.has_market && c.market).filter((c) => { const k = `${c.market.away_abbr}@${c.market.home_abbr}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
  if (!rows.length) return html`<p class="note">No stored market capture is attached to a current story. Captures run at 8:00 a.m., 1:00 p.m. and 6:00 p.m. ET.</p>`;
  return html`<div class="mw-rows">${rows.map((c) => html`<a class="mw-row" href="/news/${c.slug}">
      <span class="mw-game">${c.market.away_abbr && c.market.home_abbr ? `${c.market.away_abbr} @ ${c.market.home_abbr}` : KIND_LABEL[c.kind]}</span>
      <span class="mw-line">${c.market.spread !== null ? `${c.market.home_abbr || 'Home'} ${c.market.spread > 0 ? '+' : ''}${c.market.spread}` : '—'}</span>
      <span class="mw-line">${c.market.total !== null ? `O/U ${c.market.total}` : '—'}</span>
      <span class="mw-meta">${c.market.books} books · ${relTime(c.market.captured_at)}</span>
    </a>`)}</div>
    <p class="note" style="margin-top:10px">Best-price consensus from stored The Odds API captures, not a PropBetEdge projection. No WNBA model is published.</p>`;
}

function sourceWire(wire) {
  if (!wire.ok) return html`<p class="note">Source wire unavailable.</p>`;
  return html`<ol class="wire">${wire.data.items.slice(0, 12).map((i) => html`<li>
      <div class="nmeta">${badge('ext', i.source.name)}<span>${relTime(i.published_at)}</span></div>
      <a href="${i.url}" rel="noopener" target="_blank">${i.headline}&nbsp;<span class="note" aria-hidden="true">↗</span></a>
      <div class="nents">${entityChips(i.entities)}</div>
    </li>`)}</ol>`;
}

export async function mount(root, ctx) {
  const kind = ctx.params.kind || null;
  const head = html`<header class="masthead"><span class="eyebrow">PropBetEdge · WNBA</span><h1 class="mast-title">${kind ? DESK[kind] || KIND_LABEL[kind] || 'Newsroom' : 'The Newsroom'}</h1></header>`;
  render(root, html`${head}${skeleton(420)}${skeleton(200, 2)}`);
  const [arts, wire] = await Promise.all([api.articles({ limit: 200, kind: kind || undefined }), kind ? Promise.resolve({ ok: false }) : api.news({ limit: 20, lane: 'external' })]);
  if (!ctx.isCurrent()) return;
  if (!arts.ok) return render(root, html`${head}${errorState(arts, 'The newsroom')}`);
  const items = arts.data.items;
  const nav = html`<nav class="desk-nav" aria-label="Newsroom desks">
    <a class="${!kind ? 'on' : ''}" href="/news" ${!kind ? html`aria-current="page"` : ''}>Front page</a>
    ${['injury', 'preview', 'performance', 'trend', 'transaction', 'props', 'market'].map((k) => html`<a class="${kind === k ? 'on' : ''}" href="/news/c/${k}" ${kind === k ? html`aria-current="page"` : ''}>${DESK[k]}</a>`)}
  </nav>`;
  const mast = html`<header class="masthead">
    <div class="mast-row"><span class="eyebrow">PropBetEdge · WNBA</span><span class="mast-date">${dateline()}</span></div>
    <h1 class="mast-title">${kind ? DESK[kind] || KIND_LABEL[kind] : 'The Newsroom'}</h1>
    <p class="mast-sub">${kind ? (DESKS.find(([k]) => k === kind)?.[2] || 'Stories from this desk, newest first.') : 'Independent WNBA reporting, written in-house from cited records — the injury feed, transactions, box scores, standings and stored sportsbook captures — with the bettor angle, its counter-case and the evidence on every story.'}</p>
    ${nav}
  </header>`;

  if (!items.length) {
    return render(root, html`${mast}<div class="empty"><h3>Nothing on this desk yet</h3><p>The newsroom publishes only when a record supports a story. Quiet days stay quiet.</p></div>`);
  }

  if (kind) {
    const [first, ...rest] = items;
    return render(root, html`${mast}
      <section class="front-lead front-lead--desk">${articleCard(first, { size: 'lead', eager: true })}</section>
      <div class="ngrid section">${rest.map((c) => articleCard(c))}</div>
      <p class="note section">Last newsroom pass ${relTime(arts.meta.last_run_at)} · ${arts.data.total} stories on this desk.</p>`);
  }

  const lead = chooseLead(items);
  const tops = topStories(items, lead, 3);
  const shown = new Set([lead?.id, ...tops.map((c) => c.id)]);
  const latest = items.filter((c) => !shown.has(c.id)).slice(0, 8);
  const deskItems = (k) => ofKind(items, k).filter((c) => !shown.has(c.id));

  render(root, html`
    ${mast}
    <section class="front-top">
      <div class="front-lead">${articleCard(lead, { size: 'lead', eager: true })}</div>
      <div class="front-side">
        <h2 class="rail-title">Top stories</h2>
        ${tops.map((c) => articleCard(c, { size: 'feature' }))}
      </div>
    </section>

    <section class="front-band section">
      <div>
        <div class="sec-head"><h2 class="sec-title bc">Latest</h2><span class="note">newest first · last pass ${relTime(arts.meta.last_run_at)}</span></div>
        <div class="srows">${latest.map(articleRow)}</div>
      </div>
      <aside class="panel mw">
        <div class="sec-head"><h2 class="sec-title bc">Market Watch</h2><a class="sec-link" href="/props">Best lines →</a></div>
        ${marketWatch(items)}
      </aside>
    </section>

    ${DESKS.map(([k, name, sub]) => {
      const xs = deskItems(k).slice(0, k === 'transaction' ? 4 : 6);
      if (!xs.length) return '';
      return html`<section class="desk section">
        <div class="sec-head"><div><h2 class="sec-title bc">${name}</h2><p class="desk-sub">${sub}</p></div><a class="sec-link" href="/news/c/${k}">All ${name.toLowerCase()} →</a></div>
        ${k === 'transaction' ? html`<div class="srows srows--grid">${xs.map(articleRow)}</div>` : html`<div class="ngrid">${xs.map((c) => articleCard(c))}</div>`}
      </section>`;
    })}

    <section class="wire-wrap section">
      <div class="sec-head"><div><h2 class="sec-title bc">Source wire</h2><p class="desk-sub">External publishers the newsroom tracks — attributed, headline and link only. This is their reporting, not PropBetEdge’s.</p></div></div>
      ${sourceWire(wire)}
    </section>

    <section class="trust section">
      <span class="eyebrow">How we write</span>
      <p>Every story is generated by PropBetEdge from structured records and passes a publication gate before it goes live: each number must appear in a cited record, the only quotations allowed are a publisher’s own headline with the publisher named, there are no picks or model claims, and every bettor angle states what argues against it and what is still unknown. Stories that fail are held, not published. Photographs are licensed Wikimedia Commons images, matched to the player by exact name and date of birth and credited on the image.</p>
      <p class="note">Last newsroom pass ${relTime(arts.meta.last_run_at)} (${fmtDateTimeET(arts.meta.last_run_at)}) · ${arts.data.total} stories live.</p>
    </section>
  `);
}
