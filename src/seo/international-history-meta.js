import { SITE, DEFAULT_IMAGE } from './site.js';

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
      {
        '@type': 'WebPage',
        '@id': meta.url,
        url: meta.url,
        name: meta.title,
        description: meta.description,
        inLanguage: 'en-US',
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
        winner: { '@type': 'SportsTeam', name: h.champion },
        citation: source
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
