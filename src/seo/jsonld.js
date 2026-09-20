// One coherent schema.org graph per page. Stable site entities (Organization, NewsMediaOrganization,
// WebSite) are always present and every page entity links to them by @id. Only facts present in the
// data are emitted — nothing is invented to fill a schema property.

import { SITE, SITE_NAME, NEWSROOM_NAME, PUBLICATION_NAME, IDS, LOGO, LANG, DESKS, TRUST_PAGES, abs } from './site.js';
import { deskOf, articleShareImage } from './meta.js';
import { careerMetaLine } from '../lib/player-career.js';
import { logoEntry } from '../ui/logo.js';

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
  primaryImageOfPage: meta.image?.url ? { '@type': 'ImageObject', url: meta.image.url, width: meta.image.width, height: meta.image.height, caption: meta.image.alt } : undefined,
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
    image: [
      meta.image?.url ? { '@type': 'ImageObject', url: meta.image.url, width: meta.image.width, height: meta.image.height, caption: meta.image.alt } : undefined,
      d.photo?.portrait ? { '@type': 'ImageObject', url: abs(d.photo.portrait), width: d.photo.width, height: d.photo.height, creditText: d.photo.attribution, license: d.photo.license_url, acquireLicensePage: d.photo.source_page } : undefined
    ],
    birthDate: p.dob ? String(p.dob).slice(0, 10) : undefined,
    jobTitle: 'Professional basketball player',
    affiliation: p.team ? teamRef({ id: p.team.team_id, name: p.team.name }) : undefined,
    memberOf: p.team ? teamRef({ id: p.team.team_id, name: p.team.name }) : undefined,
    alumniOf: p.college ? { '@type': 'CollegeOrUniversity', name: p.college } : undefined,
    description: careerMetaLine(d.career)?.trim() || undefined,
    mainEntityOfPage: { '@id': meta.url }
  };
}

export function sportsTeam(d, meta) {
  const t = d.team;
  const url = `${SITE}/teams/${t.team_id}`;
  const mark = logoEntry(t);
  return {
    '@type': 'SportsTeam',
    '@id': `${url}#team`,
    name: t.name,
    alternateName: t.short_name && t.short_name !== t.name ? t.short_name : undefined,
    url,
    image: meta.image?.url ? { '@type': 'ImageObject', url: meta.image.url, width: meta.image.width, height: meta.image.height, caption: meta.image.alt } : undefined,
    logo: mark?.files?.['320'] ? { '@type': 'ImageObject', url: abs(mark.files['320']), width: 320, height: 320, caption: `${t.name} logo` } : undefined,
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
      const refs = (a.entities || []).filter((e) => e?.type === 'player' || e?.type === 'team').map(refOf).filter(Boolean);
      g.push(webPage(meta, 'WebPage', { primaryImageOfPage: { '@id': undefined, url: meta.image.url }, datePublished: a.first_published_at, dateModified: a.revised_at || undefined, about: refs }), newsArticle(a, meta));
      break;
    }
    case 'news':
    case 'news-archive':
    case 'news-team':
    case 'news-cat': {
      crumbs.push(['News', '/news']);
      if (route === 'news-archive') crumbs.push(['Archive', meta.path]);
      if (route === 'news-cat') crumbs.push([DESKS[data.kind] || 'Desk', meta.path]);
      if (route === 'news-team') crumbs.push([data.team?.name ? `${data.team.name} news` : 'Team news', meta.path]);
      const items = (data.items || []).slice(0, route === 'news-archive' ? 100 : 30).map((c) => ({ path: `/news/${c.slug}`, name: c.headline }));
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
      g.push(webPage(meta, 'ProfilePage', { mainEntity: { '@id': `${SITE}/teams/${data.team.team_id}#team` } }), sportsTeam(data, meta));
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
    case 'international':
      crumbs.push(['International', '/international']);
      g.push(webPage(meta, 'CollectionPage'), itemList(meta.url, (data.competitions || []).filter((c) => c.coverage === 'full').map((c) => ({ path: `/international/${c.slug}`, name: c.name }))));
      break;
    case 'intl-competition': {
      const c = data.competition;
      crumbs.push(['International', '/international'], [c.short_name, `/international/${c.slug}`]);
      if (meta.path !== `/international/${c.slug}`) crumbs.push([meta.title.split(' | ')[0].replace(`${c.name} `, ''), meta.path]);
      const evId = `${SITE}/international/${c.slug}#event`;
      g.push(webPage(meta, 'WebPage', { about: { '@id': evId } }), {
        '@type': 'SportsEvent', '@id': evId, name: c.name, url: `${SITE}/international/${c.slug}`, sport: 'Basketball',
        startDate: c.start_date, endDate: c.end_date, eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        location: c.host ? { '@type': 'Place', name: c.host.city, address: { '@type': 'PostalAddress', addressLocality: c.host.city, addressCountry: c.host.country } } : undefined,
        organizer: { '@type': 'SportsOrganization', name: 'FIBA', alternateName: 'International Basketball Federation' },
        competitor: (data.teams || []).map((t) => ({ '@type': 'SportsTeam', '@id': `${SITE}/international/teams/${t.team.slug}#team`, name: `${t.team.name} women’s national basketball team`, url: `${SITE}/international/teams/${t.team.slug}` }))
      });
      break;
    }
    case 'intl-game': {
      const gm = data.game;
      const c = data.competition;
      crumbs.push(['International', '/international'], [c.short_name, `/international/${c.slug}`], [`${gm.away_team.name} vs ${gm.home_team.name}`, meta.path]);
      const team = (t) => ({ '@type': 'SportsTeam', '@id': `${SITE}/international/teams/${t.slug}#team`, name: `${t.name} women’s national basketball team`, url: `${SITE}/international/teams/${t.slug}` });
      g.push(webPage(meta, 'WebPage', { mainEntity: { '@id': `${meta.url}#event` } }), {
        '@type': 'SportsEvent', '@id': `${meta.url}#event`, name: `${gm.away_team.name} vs ${gm.home_team.name} — ${gm.round_name}`, url: meta.url, sport: 'Basketball', startDate: gm.scheduled_at,
        eventStatus: `https://schema.org/${gm.status === 'postponed' ? 'EventPostponed' : 'EventScheduled'}`, eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        location: gm.venue?.name ? { '@type': 'Place', name: gm.venue.name, address: { '@type': 'PostalAddress', addressLocality: gm.venue.city || undefined, addressCountry: gm.venue.country || undefined } } : undefined,
        homeTeam: team(gm.home_team), awayTeam: team(gm.away_team), competitor: [team(gm.away_team), team(gm.home_team)],
        superEvent: { '@type': 'SportsEvent', '@id': `${SITE}/international/${c.slug}#event`, name: c.name, url: `${SITE}/international/${c.slug}` },
        image: meta.image?.url
      });
      break;
    }
    case 'intl-team': {
      const t = data.team;
      crumbs.push(['International', '/international'], [t.name, meta.path]);
      const roster = (data.competitions || []).flatMap((c) => c.roster || []);
      g.push(webPage(meta, 'WebPage', { mainEntity: { '@id': `${meta.url}#team` } }), {
        '@type': 'SportsTeam', '@id': `${meta.url}#team`, name: `${t.name} women’s national basketball team`, url: meta.url, sport: 'Basketball',
        image: meta.image?.url ? { '@type': 'ImageObject', url: meta.image.url, width: meta.image.width, height: meta.image.height, caption: meta.image.alt } : undefined,
        memberOf: { '@type': 'SportsOrganization', name: 'FIBA' },
        athlete: [...new Map(roster.map((p) => [p.player_id, p])).values()].map((p) => ({ '@type': 'Person', '@id': `${SITE}/international/players/${String(p.player_id).replace(/^p-/, '')}#person`, name: p.name }))
      });
      break;
    }
    case 'intl-player': {
      const p = data.player;
      crumbs.push(['International', '/international'], [p.team.name, `/international/teams/${p.team.slug}`], [p.name, meta.path]);
      const pid = String(p.player_id).replace(/^p-/, '');
      g.push(webPage(meta, 'ProfilePage', { mainEntity: { '@id': `${SITE}/international/players/${pid}#person` } }), {
        '@type': 'Person', '@id': `${SITE}/international/players/${pid}#person`, name: p.name, url: meta.url,
        birthDate: p.bio?.dob || undefined, jobTitle: 'Professional basketball player',
        nationality: p.team.name ? { '@type': 'Country', name: p.team.name } : undefined,
        memberOf: [{ '@type': 'SportsTeam', '@id': `${SITE}/international/teams/${p.team.slug}#team`, name: `${p.team.name} women’s national basketball team`, url: `${SITE}/international/teams/${p.team.slug}` }, ...(p.wnba?.wnba_team ? [teamRef({ id: p.wnba.wnba_team.team_id, name: p.wnba.wnba_team.name })] : [])],
        sameAs: p.wnba ? [`${SITE}/players/${p.wnba.wnba_player_id}`] : undefined,
        image: [
          meta.image?.url ? { '@type': 'ImageObject', url: meta.image.url, width: meta.image.width, height: meta.image.height, caption: meta.image.alt } : undefined,
          p.wnba?.photo?.portrait ? { '@type': 'ImageObject', url: abs(p.wnba.photo.portrait) } : undefined
        ]
      });
      break;
    }
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
