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

function recordGameContext(playerData) {
  const seasons = playerData?.gamelog?.seasons || [];
  const regular = seasons.find((x) => /2026 Regular Season/i.test(x?.name || '')) || seasons.find((x) => /Regular Season/i.test(x?.name || ''));
  const game = (regular?.games || []).find((g) => String(g?.date || '').startsWith('2026-09-20')) || null;
  if (!game) return null;
  return {
    date: game.date,
    opponent: game.opponent?.name || game.opponent?.abbr || 'Connecticut Sun',
    at_vs: game.at_vs || '@',
    result: game.result || 'W',
    score: game.score || '101-89',
    min: game.min,
    pts: game.pts,
    reb: game.reb,
    ast: game.ast,
    fgm: game.fgm,
    fga: game.fga,
    game_id: game.game_id || '401857201'
  };
}

export function isMilesRecordSlug(slug) {
  return slug === MILES_RECORD_BAD_SLUG || slug === MILES_RECORD_SLUG;
}

export function correctMilesRecordArticle(article, playerData = null) {
  if (!article || !isMilesRecordSlug(article.slug)) return article;
  const recordGame = recordGameContext(playerData);
  const player = playerData?.player || {};
  const team = player.team || { team_id: LYNX_ID, name: 'Minnesota Lynx', short_name: 'Lynx' };
  const gameSentence = recordGame
    ? `PropBetEdge’s game log shows Miles scored ${recordGame.pts} points with ${recordGame.reb} rebounds and ${recordGame.ast} assists in ${recordGame.min} minutes in Minnesota’s ${String(recordGame.score).replace('-', '–')} win at the ${recordGame.opponent} on September 20. She shot ${recordGame.fgm}-of-${recordGame.fga} from the field.`
    : 'PropBetEdge’s current player record identifies Miles as a Minnesota Lynx guard; the historical record claim remains attributed to the reporting cited below.';

  const body = [
    'Olivia Miles is the subject of this record story. NBC Sports, ESPN, CBS Sports and Just Women’s Sports all reported that Miles passed Caitlin Clark for the WNBA rookie scoring record on September 20.',
    'NBC Sports reported that Miles reached 770 points to move past Clark’s previous rookie scoring mark. ESPN and CBS Sports independently described the same record change; Just Women’s Sports followed with the same milestone in its awards coverage.',
    gameSentence,
    'The league-history comparison itself comes from the cited publisher reporting. PropBetEdge’s own structured records are used here for Miles’ current identity, team and season context; they are not being stretched into an independent all-time WNBA record database.',
    'This is a scoring-record story, not an awards story. Award voting, projections and outcomes are separate questions and are not inferred from the record.',
    'Correction: the first published version of this article incorrectly selected Caitlin Clark as the primary subject, attached Minnesota Lynx context to Clark and classified the event as awards coverage. The newsroom integrity audit corrected the subject to Olivia Miles, restored Miles’ team context and reclassified the event as a record milestone.'
  ];
  const sections = [
    { title: 'The record', key: 'change', first: 0, count: 2 },
    { title: 'The game behind the milestone', key: 'records', first: 2, count: 1 },
    { title: 'What PropBetEdge can verify', key: 'evidence', first: 3, count: 1 },
    { title: 'What the record does not decide', key: 'unknown', first: 4, count: 1 },
    { title: 'Correction', key: 'correction', first: 5, count: 1 }
  ];

  const entities = [
    { type: 'player', id: MILES_ID, name: 'Olivia Miles', team_id: String(team.team_id || LYNX_ID) },
    { type: 'player', id: CLARK_ID, name: 'Caitlin Clark' },
    { type: 'team', id: String(team.team_id || LYNX_ID), name: team.name || 'Minnesota Lynx' },
    ...(recordGame?.game_id ? [{ type: 'game', id: String(recordGame.game_id), name: `Minnesota Lynx at ${recordGame.opponent}`, start_utc: recordGame.date }] : [])
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
    deck: `NBC Sports, ESPN, CBS Sports and Just Women’s Sports reported that Olivia Miles crossed Caitlin Clark’s WNBA rookie scoring mark with her 770th point. PropBetEdge’s game log has Miles scoring 21 in Minnesota’s 101–89 win at Connecticut that day.`,
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

export const articleHasPlayer = (card, playerId) => Boolean(card) && (
  String(card.lead_player_id || '') === String(playerId)
  || (card.entities || []).some((e) => e?.type === 'player' && String(e.id) === String(playerId))
);

export const articleHasTeam = (card, teamId) => Boolean(card) && (
  String(card.lead_team_id || '') === String(teamId)
  || (card.entities || []).some((e) => e?.type === 'team' && String(e.id) === String(teamId))
);

export function correctArticleListResponse(res, { playerId = null, teamId = null } = {}) {
  if (!res?.ok || !Array.isArray(res.data?.items)) return res;
  let items = res.data.items.map(correctMilesRecordCard);
  if (playerId !== null) items = items.filter((c) => articleHasPlayer(c, playerId));
  if (teamId !== null) items = items.filter((c) => articleHasTeam(c, teamId));
  return { ...res, data: { ...res.data, items } };
}

export async function loadCorrectedArticle(api, slug) {
  const incident = isMilesRecordSlug(slug);
  const sourceSlug = incident ? MILES_RECORD_BAD_SLUG : slug;
  const [res, player] = await Promise.all([
    api.article(sourceSlug),
    incident && api.player ? Promise.resolve(api.player(MILES_ID)).catch(() => null) : Promise.resolve(null)
  ]);
  if (!res?.ok || !res.data?.article) return res;
  const article = incident
    ? correctMilesRecordArticle(res.data.article, player?.ok ? player.data : null)
    : res.data.article;
  const related = Array.isArray(res.data.related) ? res.data.related.map(correctMilesRecordCard) : res.data.related;
  return { ...res, data: { ...res.data, article, related } };
}


export function milesRecordStaticArticle() {
  const base = {
    id: '6ff81a',
    slug: MILES_RECORD_BAD_SLUG,
    kind: 'brief',
    category: 'News Briefs',
    status: 'published',
    headline: 'Caitlin Clark honored for the Minnesota Lynx: the season behind it',
    deck: '',
    body: [],
    sections: [],
    method: [
      'Correction standard: publisher evidence identifies the event subject first; roster identity is bound to that player before team context is attached.',
      'Record scope: PropBetEdge verifies the player’s current structured identity and season context. The all-time WNBA rookie-record comparison remains attributed to the publishers that reported it.',
      'The original publication history is preserved; the incorrect subject/team/event combination is not silently erased.'
    ],
    evidence: [
      { kind: 'publisher_report', publisher: 'NBC Sports', headline: 'Olivia Miles breaks Caitlin Clark’s WNBA rookie points record by scoring 770th point', url: 'https://www.nbcsports.com/wnba/news/olivia-miles-breaks-caitlin-clarks-wnba-rookie-points-record-by-scoring-770th-point', published_at: '2026-09-20T19:20:06.000Z' },
      { kind: 'publisher_report', publisher: 'ESPN', headline: "Olivia Miles breaks Caitlin Clark's WNBA rookie points record", url: 'https://www.espn.com/wnba/story/_/id/49990917/olivia-miles-breaks-caitlin-clark-wnba-rookie-points-record', published_at: '2026-09-20T20:35:18.000Z' },
      { kind: 'publisher_report', publisher: 'CBS Sports', headline: "Lynx guard Olivia Miles breaks Caitlin Clark's WNBA rookie scoring record, continuing historic campaign", url: 'https://www.cbssports.com/wnba/news/olivia-miles-breaks-caitlin-clarks-wnba-rookie-scoring-record', published_at: '2026-09-20T22:26:40.000Z' },
      { kind: 'publisher_report', publisher: 'Just Women’s Sports', headline: 'Olivia Miles Breaks Caitlin Clark’s Rookie Scoring Record as WNBA Awards Loom', url: 'https://justwomenssports.com/reads/olivia-miles-caitlin-clark-rookie-scoring-record-wnba-awards', published_at: '2026-09-21T15:11:33.000Z' },
      { kind: 'record', source: 'PropBetEdge WNBA player record', url: 'https://wnba.propbetedge.ai/players/4433791', captured_at: CORRECTED_AT, record: { athlete_id: MILES_ID, team_id: LYNX_ID } }
    ],
    first_published_at: '2026-09-21T15:16:26.198Z',
    published_at: '2026-09-21T15:16:26.198Z',
    revised_at: CORRECTED_AT,
    revisions: [],
    generator: { version: 'publication-integrity-correction/1.0.0' },
    provenance: {
      generator: 'publication-integrity-correction/1.0.0',
      generated_at: CORRECTED_AT,
      source_observed_at: '2026-09-21T15:11:33.000Z'
    },
    facts: { brief: { event_type: 'awards', linked_entities: [] } },
    context: { brief: { event_type: 'awards' } },
    entities: []
  };
  return correctMilesRecordArticle(base, {
    player: { athlete_id: MILES_ID, name: 'Olivia Miles', team: { team_id: LYNX_ID, name: 'Minnesota Lynx', short_name: 'Lynx' } },
    gamelog: { seasons: [{ name: '2026 Regular Season', games: [{ game_id: '401857201', date: '2026-09-20T23:00:00Z', opponent: { team_id: '18', name: 'Connecticut Sun', abbr: 'CON' }, at_vs: '@', result: 'W', score: '101-89', min: 30, pts: 21, reb: 3, ast: 6, fgm: 7, fga: 10 }] }] }
  });
}
