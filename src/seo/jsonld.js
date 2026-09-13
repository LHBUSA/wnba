// One coherent schema.org graph per page. Stable site entities (Organization, NewsMediaOrganization,
// WebSite) are always present and every page entity links to them by @id. Only facts present in the
// data are emitted — nothing is invented to fill a schema property.

import { SITE, SITE_NAME, NEWSROOM_NAME, PUBLICATION_NAME, IDS, LOGO, LANG, DESKS, TRUST_PAGES, abs } from './site.js';
import { deskOf, articleShareImage } from './meta.js';

const clean = (o) => {
  if (Array.isArray(o)) { const a = o.map(clean).filter((x) => x !== undefined); return a.length ? a : undefined; }
  if (o && typeof o === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(o)) { const c = clean(v); if (c !== undefined) out[k] = c; }
    return Object.keys(out).length ? out : undefined;
  }
  return o === null || o === '' ? undefined : o;
};

export const LEAGUE = { '@type': 'SportsOrganization', name: 'Women’s National Basketball Association', alternateName: 'WNBA' };

export function siteEntities() {
  return [
    { '@type': 'Organization', '@id': IDS.org, name: 'PropBetEdge', url: 'https://propbetedge.ai/' },
    {
      '@type': 'NewsMediaOrganization',
      '@id': IDS.newsroom,
      name: NEWSROOM_NAME,
      alternateName: PUBLICATION_NAME,
      url: `${SITE}/news`,
      logo: { '@type': 'ImageObject', url: LOGO.url, width: LOGO.width, height: LOGO.height },
      parentOrganization: { '@id': IDS.org },
      publishingPrinciples: `${SITE}/editorial-policy`,
      correctionsPolicy: `${SITE}/corrections`,
      ethicsPolicy: `${SITE}/editorial-policy`,
      verificationFactCheckingPolicy: `${SITE}/methodology`,
      masthead: `${SITE}/about`,
      diversityPolicy: undefined
    },
    {
      '@type': 'WebSite',
      '@id': IDS.website,
      name: SITE_NAME,
      url: `${SITE}/`,
      inLanguage: LANG,
      publisher: { '@id': IDS.newsroom },
      isPartOf: { '@type': 'WebSite', name: 'PropBetEdge', url: 'https://propbetedge.ai/' }
    }
  ];
}

export const playerRef = (e) => ({ '@type': 'Person', '@id': `${SITE}/players/${e.id}#person`, name: e.name, url: `${SITE}/players/${e.id}` });
export const teamRef = (e) => ({ '@type': 'SportsTeam', '@id': `${SITE}/teams/${e.id}#team`, name: e.name, url: `${SITE}/teams/${e.id}` });
export const gameRef = (e) => ({ '@type': 'SportsEvent', '@id': `${SITE}/matchups/${e.id}#event`, name: e.name, url: `${SITE}/matchups/${e.id}`, startDate: e.start_utc });
const refOf = (e) => (e?.type === 'player' ? playerRef(e) : e?.type === 'team' ? teamRef(e) : e?.type === 'game' ? gameRef(e) : null);

export function breadcrumbs(url, items) {
  return { '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`, itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(path) })) };
}

const webPage = (meta, type = 'WebPage', extra = {}) => ({
  '@type': type,
  '@id': meta.url,
  url: meta.url,
  name: meta.title,
  description: meta.description,
  inLanguage: LANG,
  isPartOf: { '@id': IDS.website },
  breadcrumb: { '@id': `${meta.url}#breadcrumb` },
  ...extra
});

export const wordCount = (a) => [a.headline, a.deck, ...(a.body || [])].join(' ').split(/\s+/).filter(Boolean).length;

export function newsArticle(a, meta) {
  const url = meta.url;
  const lead = (a.entities || []).filter(Boolean);
  const about = lead.filter((e) => (e.type === 'player' && String(e.id) === String(a.lead_player_id)) || (e.type === 'team' && String(e.id) === String(a.lead_team_id)) || (e.type === 'game' && a.kind === 'preview'));
  const mentions = lead.filter((e) => !about.includes(e));
  const share = articleShareImage(a);
  const photo = a.media?.subjects?.[0]?.wide?.slice?.(-1)?.[0];
  const published = a.first_published_at || a.published_at;
  const modified = a.revised_at && Date.parse(a.revised_at) > Date.parse(published || 0) ? a.revised_at : published;
  return {
    '@type': 'NewsArticle',
    '@id': `${url}#article`,
    url,
    headline: a.headline.length > 110 ? `${a.headline.slice(0, 109).trimEnd()}…` : a.headline,
    alternativeHeadline: a.headline.length > 110 ? a.headline : undefined,
    description: a.deck,
    image: [
      { '@type': 'ImageObject', url: share.url, width: share.width, height: share.height, caption: share.alt },
      photo ? { '@type': 'ImageObject', url: abs(photo.src), width: photo.w, height: photo.h, caption: a.media?.caption || undefined, creditText: a.media?.subjects?.[0]?.credit?.author ? `${a.media.subjects[0].credit.author} / ${a.media.subjects[0].credit.license}` : undefined, license: a.media?.subjects?.[0]?.credit?.license_url, acquireLicensePage: a.media?.subjects?.[0]?.credit?.source_page } : undefined
    ],
    thumbnailUrl: share.url,
    datePublished: published,
    dateModified: modified,
    author: { '@type': 'NewsMediaOrganization', '@id': IDS.newsroom, name: NEWSROOM_NAME, url: `${SITE}/about` },
    publisher: { '@id': IDS.newsroom },
    mainEntityOfPage: { '@id': url },
    isPartOf: { '@id': IDS.website },
    articleSection: DESKS[deskOf(a.kind)] || 'Newsroom',
    inLanguage: LANG,
    isAccessibleForFree: true,
    wordCount: wordCount(a),
    about: about.map(refOf),
    mentions: mentions.map(refOf),
    citation: (a.evidence || []).filter((e) => e.url).slice(0, 8).map((e) => ({ '@type': 'CreativeWork', name: e.headline || e.source, url: e.url, publisher: e.publisher ? { '@type': 'Organization', name: e.publisher } : undefined, datePublished: e.published_at || undefined }))
  };
}

export function person(d, meta) {
  const p = d.player;
  const url = `${SITE}/players/${p.athlete_id}`;
  return {
    '@type': 'Person',
    '@id': `${url}#person`,
    name: p.name,
    givenName: p.first_name,
    familyName: p.last_name,
    url,
    image: d.photo?.portrait ? { '@type': 'ImageObject', url: abs(d.photo.portrait), width: d.photo.width, height: d.photo.height, creditText: d.photo.attribution, license: d.photo.license_url, acquireLicensePage: d.photo.source_page } : undefined,
    birthDate: p.dob ? String(p.dob).slice(0, 10) : undefined,
    jobTitle: 'Professional basketball player',
    affiliation: p.team ? teamRef({ id: p.team.team_id, name: p.team.name }) : undefined,
    memberOf: p.team ? teamRef({ id: p.team.team_id, name: p.team.name }) : undefined,
    alumniOf: p.college ? { '@type': 'CollegeOrUniversity', name: p.college } : undefined,
    mainEntityOfPage: { '@id': meta.url }
  };
}

export function sportsTeam(d, meta) {
  const t = d.team;
  const url = `${SITE}/teams/${t.team_id}`;
  return {
    '@type': 'SportsTeam',
    '@id': `${url}#team`,
    name: t.name,
    alternateName: t.short_name && t.short_name !== t.name ? t.short_name : undefined,
    url,
    sport: 'Basketball',
    memberOf: LEAGUE,
    coach: d.coach?.[0] ? { '@type': 'Person', name: d.coach[0] } : undefined,
    athlete: (d.roster || []).map((r) => playerRef({ id: r.athlete_id, name: r.name })),
    mainEntityOfPage: { '@id': meta.url }
  };
}

export function sportsEvent(game, meta) {
  const g = game;
  const url = `${SITE}/matchups/${g.game_id}`;
  const name = `${g.away?.name} at ${g.home?.name}`;
  const status = /POSTPONED/.test(g.status?.name || '') ? 'EventPostponed' : /CANCEL/.test(g.status?.name || '') ? 'EventCancelled' : 'EventScheduled';
  const home = g.home?.team_id ? teamRef({ id: g.home.team_id, name: g.home.name }) : undefined;
  const away = g.away?.team_id ? teamRef({ id: g.away.team_id, name: g.away.name }) : undefined;
  return {
    '@type': 'SportsEvent',
    '@id': `${url}#event`,
    name,
    url,
    startDate: g.start_utc,
    sport: 'Basketball',
    eventStatus: `https://schema.org/${status}`,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: g.venue?.name ? { '@type': 'Place', name: g.venue.name, address: { '@type': 'PostalAddress', addressLocality: g.venue.city || undefined, addressRegion: g.venue.state || undefined } } : undefined,
    homeTeam: home,
    awayTeam: away,
    competitor: [away, home].filter(Boolean),
    superEvent: g.season?.label ? { '@type': 'SportsEvent', name: `WNBA ${g.season.label}`, organizer: LEAGUE } : undefined,
    image: meta.image?.url,
    mainEntityOfPage: { '@id': meta.url }
  };
}

const itemList = (url, items) => ({ '@type': 'ItemList', '@id': `${url}#list`, itemListElement: items.map((x, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(x.path), name: x.name })) });

/**
 * The full graph for a route. `data` is whatever the view rendered from.
 */
export function pageGraph(route, meta, data = {}) {
  const g = [...siteEntities()];
  const crumbs = [['PropBetEdge WNBA', '/']];
  switch (route) {
    case 'article': {
      const a = data.article;
      crumbs.push(['News', '/news'], [DESKS[deskOf(a.kind)] || 'Newsroom', `/news/c/${deskOf(a.kind)}`], [a.headline, meta.path]);
      g.push(webPage(meta, 'WebPage', { primaryImageOfPage: { '@id': undefined, url: meta.image.url }, datePublished: a.first_published_at, dateModified: a.revised_at || undefined }), newsArticle(a, meta));
      break;
    }
    case 'news':
    case 'news-cat': {
      crumbs.push(['News', '/news']);
      if (route === 'news-cat') crumbs.push([DESKS[data.kind] || 'Desk', meta.path]);
      const items = (data.items || []).slice(0, 30).map((c) => ({ path: `/news/${c.slug}`, name: c.headline }));
      g.push(webPage(meta, 'CollectionPage', { mainEntity: { '@id': `${meta.url}#list` }, publisher: { '@id': IDS.newsroom } }), itemList(meta.url, items));
      break;
    }
    case 'player': {
      crumbs.push(['Players', '/players'], [data.player?.name, meta.path]);
      g.push(webPage(meta, 'ProfilePage', { mainEntity: { '@id': `${SITE}/players/${data.player.athlete_id}#person` } }), person(data, meta));
      break;
    }
    case 'team': {
      crumbs.push(['Teams', '/teams'], [data.team?.name, meta.path]);
      g.push(webPage(meta, 'WebPage', { mainEntity: { '@id': `${SITE}/teams/${data.team.team_id}#team` } }), sportsTeam(data, meta));
      break;
    }
    case 'matchups': {
      crumbs.push(['Matchups', '/matchups']);
      if (data.game) {
        crumbs.push([`${data.game.away?.name} at ${data.game.home?.name}`, meta.path]);
        g.push(webPage(meta, 'WebPage', { mainEntity: { '@id': `${SITE}/matchups/${data.game.game_id}#event` } }), sportsEvent(data.game, meta));
      } else g.push(webPage(meta, 'CollectionPage'));
      break;
    }
    case 'cast': {
      crumbs.push(['WNBACast', '/cast']);
      if (data.game) { crumbs.push([`${data.game.away?.name} at ${data.game.home?.name}`, meta.path]); g.push(webPage(meta, 'WebPage', { about: { '@id': `${SITE}/matchups/${data.game.game_id}#event` } }), sportsEvent(data.game, { ...meta, url: `${SITE}/matchups/${data.game.game_id}` })); } else g.push(webPage(meta));
      break;
    }
    case 'today':
      g.push(webPage({ ...meta, url: `${SITE}/` }, 'WebPage', { about: { '@id': IDS.newsroom } }));
      break;
    default: {
      const trust = TRUST_PAGES.find(([p]) => p === meta.path);
      const label = trust?.[1] || meta.title.split(' | ')[0];
      if (meta.path !== '/') crumbs.push([label, meta.path]);
      g.push(webPage(meta, meta.path === '/about' ? 'AboutPage' : ['/players', '/teams', '/injuries', '/standings', '/stats', '/props'].includes(meta.path) ? 'CollectionPage' : 'WebPage'));
    }
  }
  g.push(breadcrumbs(meta.url, crumbs));
  return clean({ '@context': 'https://schema.org', '@graph': g });
}

/** Safe for inline <script type="application/ld+json">: no "</script>" breakout, no HTML comment openers. */
export const jsonLdText = (graph) => JSON.stringify(graph).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
