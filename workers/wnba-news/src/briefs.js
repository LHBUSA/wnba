// Material external-news lane for the PropBetEdge WNBA newsroom.
//
// A source-wire cluster is a new PBE brief when it represents a material WNBA
// event that is not already covered by one of our structured article generators.
// The brief keeps one stable story id for the cluster: corroborating publishers
// or source updates revise that story; a different cluster creates a new story.
// Publisher article bodies are never copied. The only publisher text promoted
// into PBE prose is the attributed headline, which is already within the source
// registry's permitted headline/link/summary usage.

import { finalize, hashId } from './articles.js';

export const BRIEF_VERSION = 'wnba-briefs/1.0.0';
export const BRIEF_MAX_AGE_MS = 36 * 3600e3;
export const BRIEF_MAX_PER_RUN = 12;

const MATERIAL_TYPES = new Set(['injury', 'trade', 'transaction', 'coaching', 'lineup', 'playoffs', 'league', 'news']);

const clean = (s) => String(s || '').replace(/[“”"]/g, "'").replace(/\s+/g, ' ').trim();
const when = (x) => Date.parse(x?.published_at || 0) || 0;
const uniq = (xs) => [...new Set(xs.filter(Boolean))];
const entityKey = (e) => `${e?.type || ''}:${e?.id || ''}`;

function grouped(items) {
  const out = new Map();
  for (const item of items || []) {
    const key = item.cluster_id || `item:${item.item_id}`;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(item);
  }
  return [...out.entries()].map(([cluster_id, members]) => ({ cluster_id, members }));
}

function canonical(members) {
  return [...members].sort((a, b) => {
    const pa = Number.isFinite(a.priority) ? a.priority : 9;
    const pb = Number.isFinite(b.priority) ? b.priority : 9;
    if (pa !== pb) return pa - pb;
    return when(a) - when(b);
  })[0];
}

function material(canon) {
  if (!MATERIAL_TYPES.has(canon.story_type)) return false;
  if (canon.story_type === 'news') return (canon.priority ?? 9) <= 2 || (canon.relevance ?? 0) >= 4;
  return true;
}

function coveredByStructured(canon, members, structured) {
  const published = (structured || []).filter((a) => a?.status === 'published');
  const ents = uniq(members.flatMap((m) => m.entities || []).map(entityKey));
  const players = new Set(ents.filter((x) => x.startsWith('player:')).map((x) => x.slice(7)));
  const teams = new Set(ents.filter((x) => x.startsWith('team:')).map((x) => x.slice(5)));

  if (canon.story_type === 'injury') {
    return published.some((a) => a.kind === 'injury' && a.lead_player_id != null && players.has(String(a.lead_player_id)));
  }
  if (canon.story_type === 'transaction' || canon.story_type === 'trade') {
    return published.some((a) => a.kind === 'transaction' && (
      (a.lead_player_id != null && players.has(String(a.lead_player_id))) ||
      (a.lead_team_id != null && teams.has(String(a.lead_team_id)))
    ));
  }
  return false;
}

function headlineFor(canon) {
  const source = clean(canon.source_name || canon.attribution || 'Source');
  const raw = clean(canon.headline);
  const prefix = `${source}: `;
  const room = Math.max(24, 158 - prefix.length);
  const body = raw.length > room ? `${raw.slice(0, Math.max(0, room - 1)).trimEnd()}…` : raw;
  return `${prefix}${body}`;
}

function linkedNames(members) {
  const byKey = new Map();
  for (const e of members.flatMap((m) => m.entities || [])) if (e?.type && e?.id && !byKey.has(entityKey(e))) byKey.set(entityKey(e), e.name || e.id);
  return [...byKey.values()].slice(0, 5);
}

function evidenceFor(members) {
  return [...members]
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || when(a) - when(b))
    .slice(0, 4)
    .map((m) => ({
      kind: 'publisher_report',
      publisher: m.source_name,
      headline: m.headline,
      url: m.canonical_url,
      published_at: m.published_at,
      source_updated_at: m.source_updated_at || null
    }));
}

/** Build at most one PBE brief per material source-wire cluster. */
export async function briefArticles({ externalItems = [], structured = [], now = Date.now() } = {}) {
  const candidates = grouped(externalItems)
    .map((g) => ({ ...g, canon: canonical(g.members) }))
    .filter((g) => g.canon && material(g.canon))
    .filter((g) => now - Math.max(...g.members.map(when)) <= BRIEF_MAX_AGE_MS)
    .filter((g) => !coveredByStructured(g.canon, g.members, structured))
    .sort((a, b) => Math.max(...b.members.map(when)) - Math.max(...a.members.map(when)))
    .slice(0, BRIEF_MAX_PER_RUN);

  const out = [];
  for (const { cluster_id, members, canon } of candidates) {
    const names = linkedNames(members);
    const entityLine = names.length ? `The newsroom links this event to ${names.join(', ')}.` : 'The source item passed the WNBA relevance gate without a safe player or team link.';
    const source = clean(canon.source_name || canon.attribution || 'The publisher');
    const sourceHeadline = clean(canon.headline);
    const evidence = evidenceFor(members);
    const allEntities = [];
    const seen = new Set();
    for (const e of members.flatMap((m) => m.entities || [])) {
      const k = entityKey(e);
      if (!e?.type || !e?.id || seen.has(k)) continue;
      seen.add(k);
      allEntities.push(e);
    }
    const player = allEntities.find((e) => e.type === 'player') || null;
    const team = allEntities.find((e) => e.type === 'team') || null;
    const eventAt = new Date(Math.min(...members.map(when).filter(Boolean))).toISOString();
    const id = await hashId(['brief', cluster_id]);

    const headline = headlineFor(canon);
    const deck = `A new material WNBA source event entered the PropBetEdge wire. This brief keeps that event separate from routine revisions to existing structured stories.`;
    const body = [
      `${source} published the headline ${sourceHeadline}. ${entityLine} That attributed report is the new material event behind this PropBetEdge brief; the linked publisher remains the source for details that have not appeared in PropBetEdge's own structured records.`,
      `This page does not reproduce the publisher's article body or turn its description into independent PropBetEdge fact. The newsroom stores the headline, source link and metadata, then keeps the PBE story identity tied to this source cluster so the same event is revised rather than duplicated when another publisher covers it.`,
      `A genuinely different material event receives a different brief. If structured WNBA records later add an injury-feed change, transaction, box score, schedule update or stored market context, PropBetEdge can revise this story with that cited evidence without pretending the earlier external report came from our own data.`,
      `For bettors, the practical question is whether the development changes availability, rotation, matchup context or a stored market. Until a structured record shows that effect, the useful fact is the existence of the attributed report itself, not a prediction about what the report must mean for a line or player prop.`
    ];
    const input_hash = [BRIEF_VERSION, canon.story_type, canon.item_id, ...members.map((m) => `${m.item_id}:${m.source_updated_at || m.published_at || ''}:${m.headline || ''}`).sort()].join('|');

    out.push(finalize({
      id,
      kind: 'brief',
      category: 'News Briefs',
      structure: 0,
      headline,
      deck,
      body,
      bettor: ['For bettors, this report matters only if later evidence changes availability, rotation, matchup context or a stored market; the external report alone is not a betting signal.'],
      against: ['The event is based on attributed external reporting; details not present in PropBetEdge structured records remain publisher reporting, not independently verified PBE facts.'],
      unknown: ['Whether this development changes official availability, rotation, schedule context or a stored market in PropBetEdge structured records.'],
      markets: ['availability', 'rotation', 'matchup', 'market'],
      market_angle: { text: [], market: null, game_id: null },
      lead_team_id: team?.id || player?.team_id || null,
      lead_player_id: player?.id || null,
      primary_subject: null,
      published_at: eventAt,
      context: { brief: { cluster_id, story_type: canon.story_type, source_item_id: canon.item_id, source_url: canon.canonical_url, source_name: source } },
      entities: allEntities,
      facts: { brief: { cluster_id, story_type: canon.story_type, source_item_id: canon.item_id, linked_entities: allEntities.map((e) => ({ type: e.type, id: e.id, name: e.name })) } },
      evidence,
      input_hash
    }));
  }
  return out;
}
