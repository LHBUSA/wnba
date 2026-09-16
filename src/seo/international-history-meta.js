import { SITE, SITE_NAME, NEWSROOM_NAME, DEFAULT_IMAGE, LOGO, IDS } from './site.js';

export const HISTORICAL_INDEX_ROBOTS = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';

export function historicalCompetitionMeta(c, h) {
  const path = `/international/${c.slug}`;
  const podium = `${h.champion} won the title, ${h.runner_up} finished runner-up and ${h.third} placed third.`;
  return {
    path,
    url: `${SITE}${path}`,
    title: `${c.name}: Results, Final Standings & Leaders | PropBetEdge`,
    description: `${c.name}, ${h.dates.label}: ${podium} Final medal-game scores, tournament MVP, statistical leaders and complete final standings from the verified historical record.`,
    image: DEFAULT_IMAGE,
    type: 'website',
    robots: HISTORICAL_INDEX_ROBOTS
  };
}

export function historicalCompetitionGraph(c, h, meta) {
  const eventId = `${meta.url}#event`;
  const breadcrumbId = `${meta.url}#breadcrumb`;
  const source = { '@type': 'CreativeWork', name: `FIBA official ${c.season} event record`, url: h.source.url };
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': IDS.org, name: 'PropBetEdge', url: 'https://propbetedge.ai/' },
      {
        '@type': 'NewsMediaOrganization',
        '@id': IDS.newsroom,
        name: NEWSROOM_NAME,
        url: `${SITE}/news`,
        logo: { '@type': 'ImageObject', url: LOGO.url, width: LOGO.width, height: LOGO.height },
        parentOrganization: { '@id': IDS.org }
      },
      {
        '@type': 'WebSite',
        '@id': IDS.website,
        name: SITE_NAME,
        url: `${SITE}/`,
        inLanguage: 'en-US',
        publisher: { '@id': IDS.newsroom }
      },
      {
        '@type': 'WebPage',
        '@id': meta.url,
        url: meta.url,
        name: meta.title,
        description: meta.description,
        inLanguage: 'en-US',
        isPartOf: { '@id': IDS.website },
        breadcrumb: { '@id': breadcrumbId },
        about: { '@id': eventId },
        citation: source
      },
      {
        '@type': 'SportsEvent',
        '@id': eventId,
        name: c.name,
        url: meta.url,
        sport: 'Basketball',
        startDate: h.dates.start,
        endDate: h.dates.end,
        eventStatus: 'https://schema.org/EventCompleted',
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        location: {
          '@type': 'Place',
          name: h.host.city,
          address: {
            '@type': 'PostalAddress',
            addressLocality: h.host.city,
            addressCountry: h.host.country
          }
        },
        organizer: { '@type': 'SportsOrganization', name: 'FIBA', alternateName: 'International Basketball Federation' },
        competitor: [h.champion, h.runner_up, h.third, h.fourth].filter(Boolean).map((name) => ({ '@type': 'SportsTeam', name }))
      },
      {
        '@type': 'BreadcrumbList',
        '@id': breadcrumbId,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'PropBetEdge WNBA', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'International', item: `${SITE}/international` },
          { '@type': 'ListItem', position: 3, name: c.short_name, item: meta.url }
        ]
      }
    ]
  };
}
