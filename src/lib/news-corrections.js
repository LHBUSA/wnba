// Emergency/publication correction layer for known newsroom integrity incidents.
// This does not mutate the historical Worker record; it gives the publishing
// surface one corrected canonical story while the source record and revision
// history remain auditable.

export const MILES_RECORD_BAD_SLUG = 'caitlin-clark-honored-for-the-minnesota-lynx-the-season-behind-it-6ff81a';
export const MILES_RECORD_SLUG = 'olivia-miles-breaks-caitlin-clarks-wnba-rookie-scoring-record-6ff81a';
export const MILES_ID = '4433791';
export const CLARK_ID = '4433403';
export const LYNX_ID = '8';
const CORRECTED_AT = '2026-09-21T17:00:00.000Z';

const n1 = (v) => Number.isFinite(Number(v)) ? Number(v).toFixed(1) : null;

const milesMedia = () => ({
  layout: 'single',
  subjects: [{
    player_id: MILES_ID,
    name: 'Olivia Miles',
    team_id: LYNX_ID,
    square: '/media/players/4433791/square.webp',
    wide: [
      { src: '/media/news/players/4433791/wide-1280.webp', w: 1280, h: 720 },
      { src: '/media/news/players/4433791/wide-960.webp', w: 960, h: 540 },
      { src: '/media/news/players/4433791/wide-640.webp', w: 640, h: 360 }
    ],
    half: [
      { src: '/media/news/players/4433791/half-640.webp', w: 640, h: 720 },
      { src: '/media/news/players/4433791/half-480.webp', w: 480, h: 540 }
    ],
    credit: {
      author: 'Hameltion',
      license: 'CC BY-SA 4.0',
      license_url: 'https://creativecommons.org/licenses/by-sa/4.0',
      source_page: 'https://commons.wikimedia.org/wiki/File:UNC_vs_ND_(Jan_2025)_23_(cropped).jpg'
    }
  }],
  teams: [LYNX_ID],
  caption: 'Pictured: Olivia Miles',
  og: '/media/news/players/4433791/og.jpg',
  visual: { kind: 'single', desk: 'WNBA Newsroom' },
  resolved: 'publication_integrity_correction'
});

function seasonContext(playerData) {
  const s = playerData?.recent?.season || null;
  if (!s) return null;
  const pts = n1(s.pts), reb = n1(s.reb), ast = n1(s.ast), min = n1(s.min);
  if (![pts, reb, ast, min].every(Boolean)) return null;
  return { games: s.games, pts, reb, ast, min };
}

export function isMilesRecordSlug(slug) {
  return slug === MILES_RECORD_BAD_SLUG || slug === MILES_RECORD_SLUG;
}

export function correctMilesRecordArticle(article, playerData = null) {
  if (!article || !isMilesRecordSlug(article.slug)) return article;
  const season = seasonContext(playerData);
  const player = playerData?.player || {};
  const team = player.team || { team_id: LYNX_ID, name: 'Minnesota Lynx', short_name: 'Lynx' };
  const seasonSentence = season
    ? `PropBetEdge’s current player record lists Miles at ${season.pts} points, ${season.reb} rebounds and ${season.ast} assists in ${season.min} minutes across ${season.games} games this season.`
    : 'PropBetEdge’s current player record identifies Miles as a Minnesota Lynx guard; the historical record claim remains attributed to the reporting cited below.';

  const body = [
    'Olivia Miles is the subject of this record story. NBC Sports, ESPN, CBS Sports and Just Women’s Sports all reported that Miles passed Caitlin Clark for the WNBA rookie scoring record on September 20.',
    'NBC Sports reported that Miles reached 770 points to move past Clark’s previous rookie scoring mark. ESPN and CBS Sports independently described the same record change; Just Women’s Sports followed with the same milestone in its awards coverage.',
    seasonSentence,
    'The league-history comparison itself comes from the cited publisher reporting. PropBetEdge’s own structured records are used here for Miles’ current identity, team and season context; they are not being stretched into an independent all-time WNBA record database.',
    'This is a scoring-record story, not an awards story. Award voting, projections and outcomes are separate questions and are not inferred from the record.',
    'Correction: the first published version of this article incorrectly selected Caitlin Clark as the primary subject, attached Minnesota Lynx context to Clark and classified the event as awards coverage. The newsroom integrity audit corrected the subject to Olivia Miles, restored Miles’ team context and reclassified the event as a record milestone.'
  ];
  const sections = [
    { title: 'The record', key: 'change', first: 0, count: 2 },
    { title: 'Miles’ season', key: 'records', first: 2, count: 1 },
    { title: 'What PropBetEdge can verify', key: 'evidence', first: 3, count: 1 },
    { title: 'What the record does not decide', key: 'unknown', first: 4, count: 1 },
    { title: 'Correction', key: 'correction', first: 5, count: 1 }
  ];

  const entities = [
    { type: 'player', id: MILES_ID, name: 'Olivia Miles' },
    { type: 'player', id: CLARK_ID, name: 'Caitlin Clark' },
    { type: 'team', id: String(team.team_id || LYNX_ID), name: team.name || 'Minnesota Lynx' }
  ];

  const revisions = [...(article.revisions || []).filter((r) => r?.kind !== 'integrity_correction'), {
    at: CORRECTED_AT,
    kind: 'integrity_correction',
    note: 'Corrected primary subject, team context and event type after a newsroom entity-integrity audit.'
  }];

  return {
    ...article,
    slug: MILES_RECORD_SLUG,
    headline: 'Olivia Miles breaks Caitlin Clark’s WNBA rookie scoring record',
    deck: `Miles reached 770 points to move past Clark’s rookie scoring mark, according to NBC Sports, ESPN, CBS Sports and Just Women’s Sports.${season ? ` PropBetEdge’s current player record has her at ${season.pts} points per game for Minnesota.` : ''}`,
    body,
    sections,
    desk: 'performance',
    event_type: 'record',
    lead_player_id: MILES_ID,
    lead_team_id: String(team.team_id || LYNX_ID),
    primary_subject: 'Olivia Miles',
    entities,
    media: milesMedia(),
    revised_at: CORRECTED_AT,
    revisions,
    context: {
      ...(article.context || {}),
      brief: {
        ...(article.context?.brief || {}),
        event_type: 'record',
        desk: 'games',
        integrity_correction: 'primary_subject_team_event'
      }
    },
    facts: {
      ...(article.facts || {}),
      brief: {
        ...(article.facts?.brief || {}),
        event_type: 'record',
        desk: 'record',
        linked_entities: entities,
        integrity_correction: {
          at: CORRECTED_AT,
          from: { subject: 'Caitlin Clark', team: 'Minnesota Lynx', event_type: 'awards' },
          to: { subject: 'Olivia Miles', team: 'Minnesota Lynx', event_type: 'record' }
        }
      }
    }
  };
}

export function correctMilesRecordCard(card) {
  if (!card || !isMilesRecordSlug(card.slug)) return card;
  const corrected = correctMilesRecordArticle(card, null);
  return {
    ...card,
    slug: corrected.slug,
    headline: corrected.headline,
    deck: corrected.deck,
    desk: corrected.desk,
    event_type: corrected.event_type,
    lead_player_id: corrected.lead_player_id,
    lead_team_id: corrected.lead_team_id,
    primary_subject: corrected.primary_subject,
    entities: corrected.entities,
    media: corrected.media,
    revised_at: corrected.revised_at
  };
}

export function correctArticleListResponse(res) {
  if (!res?.ok || !Array.isArray(res.data?.items)) return res;
  return { ...res, data: { ...res.data, items: res.data.items.map(correctMilesRecordCard) } };
}
