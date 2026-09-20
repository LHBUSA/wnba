// WNBA News & Intelligence — the PropBetEdge editorial front page, desk pages and team news pages.
// Rendering lives in src/views/news.js (shared with the publishing Worker); this page adds polling,
// the four-story lead carousel and closes the desk menus (native <details>) on Escape or an outside click.
import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { skeleton } from '../ui/components.js';
import { KIND_LABEL, DESK } from '../ui/articles.js';
import { attachVideo } from '../ui/video.js';
import { createPoller } from '../lib/poller.js';
import { routeMeta } from '../seo/meta.js';
import { loadNews, newsView, newsHeadView } from '../views/news.js';

const HERO_CYCLE_MS = 8000;

export const title = (p) => (p.teamId ? 'Team News · WNBA News' : p.kind ? `${DESK[p.kind] || KIND_LABEL[p.kind] || 'News'} · WNBA News` : 'WNBA News & Intelligence');

export async function mount(root, ctx) {
  const kind = ctx.params.kind || null;
  const teamId = ctx.params.teamId || null;
  render(root, html`${newsHeadView(kind)}${skeleton(420)}${skeleton(200, 2)}`);

  let painted = false;
  let poller = null;
  let metaSet = false;
  let heroCycle = null;

  const stopHeroCycle = () => {
    if (heroCycle) {
      clearInterval(heroCycle);
      heroCycle = null;
    }
  };

  const wireHero = () => {
    stopHeroCycle();
    const hero = root.querySelector('[data-news-hero]');
    if (!hero) return;
    const slides = [...hero.querySelectorAll('[data-news-hero-slide]')];
    const dots = [...hero.querySelectorAll('[data-news-hero-dot]')];
    if (slides.length <= 1) return;

    let index = Math.max(0, slides.findIndex((slide) => slide.classList.contains('is-active')));
    const show = (next) => {
      index = (next + slides.length) % slides.length;
      slides.forEach((slide, i) => {
        const active = i === index;
        slide.classList.toggle('is-active', active);
        slide.setAttribute('aria-hidden', String(!active));
      });
      dots.forEach((dot, i) => {
        const active = i === index;
        dot.classList.toggle('is-active', active);
        if (active) dot.setAttribute('aria-current', 'true');
        else dot.removeAttribute('aria-current');
      });
    };
    const start = () => {
      stopHeroCycle();
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      heroCycle = setInterval(() => show(index + 1), HERO_CYCLE_MS);
    };
    const manual = (next) => {
      show(next);
      start();
    };

    hero.querySelector('[data-news-hero-prev]')?.addEventListener('click', () => manual(index - 1));
    hero.querySelector('[data-news-hero-next]')?.addEventListener('click', () => manual(index + 1));
    dots.forEach((dot, i) => dot.addEventListener('click', () => manual(i)));

    // Keyboard focus pauses the automatic change so controls and headlines do not move underneath a reader.
    hero.addEventListener('focusin', stopHeroCycle);
    hero.addEventListener('focusout', (event) => {
      if (!hero.contains(event.relatedTarget)) start();
    });
    start();
  };

  const draw = async () => {
    const data = await loadNews(api, kind, teamId);
    if (!ctx.isCurrent()) return;
    // Keep the last good paint when a background refresh fails.
    if (!data.arts.ok && painted) return;
    // Remember which desk menu the reader had open across a background refresh.
    const open = [...root.querySelectorAll('details[data-desk-menu][open] > summary')].map((s) => s.textContent.trim());
    const v = newsView(data);
    render(root, v.body);
    root.querySelectorAll('details[data-desk-menu] > summary').forEach((s) => { if (open.includes(s.textContent.trim())) s.parentElement.open = true; });
    attachVideo(root);
    wireHero();
    if (teamId && data.team && !metaSet) { ctx.setMeta(routeMeta('news-team', { path: ctx.path, params: ctx.params, data: { team: data.team }, empty: v.empty })); metaSet = true; }
    painted = true;
  };

  const closeMenus = (except = null) => root.querySelectorAll('details[data-desk-menu][open]').forEach((d) => { if (d !== except) d.open = false; });
  const onDoc = (e) => { const d = e.target.closest?.('details[data-desk-menu]'); closeMenus(d && root.contains(d) ? d : null); };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    const d = root.querySelector('details[data-desk-menu][open]');
    if (d) { d.open = false; d.querySelector('summary')?.focus(); }
  };
  document.addEventListener('click', onDoc);
  document.addEventListener('keydown', onKey);

  // Keep an open newsroom current without hard reloads. The shared poller pauses in hidden tabs,
  // never overlaps requests, refreshes on visibility return and stops on route unmount.
  poller = createPoller(draw, { intervalMs: 120000 });
  return () => {
    stopHeroCycle();
    poller?.stop();
    document.removeEventListener('click', onDoc);
    document.removeEventListener('keydown', onKey);
  };
}
