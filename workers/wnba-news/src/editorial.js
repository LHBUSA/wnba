// Relevance gate, story typing, entity linking and dedupe for the WNBA newsroom.
// All rules are deterministic and stated; nothing here calls a language model.

export const EDITORIAL_VERSION = 'wnba-news-editorial/1.0.0';

export function norm(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NCAA = /\b(ncaa|college|collegiate|freshman|sophomore|recruit|recruiting|commit(s|ted)?|transfer portal|big east|sec|acc|big ten|big 12|pac-12|march madness|final four)\b/i;
const INTERNATIONAL = /\b(fiba|world cup|olympic|olympics|eurobasket|eurocup|euroleague|team usa|national team)\b/i;
const OFF_SPORT = /\b(nfl|nhl|mlb|nwsl|mls|premier league|super bowl|touchdown|quarterback|hockey|soccer|baseball|softball|volleyball|golf|tennis|f1|nascar)\b/i;

export const STORY_TYPES = [
  ['injury', /\b(injur(y|ies|ed)|out for|ruled out|will miss|miss(es)? (the )?(rest|remainder)|questionable|doubtful|day-to-day|torn|acl|achilles|sprain(ed)?|fracture|surgery|concussion|protocol|return(s|ed)? from|sidelined|health update)\b/i],
  ['trade', /\b(traded|trades? (for|with|to)|trade (deadline|talks|request)|deal sends|acquire[sd]?)\b/i],
  ['transaction', /\b(sign(s|ed|ing)?|waive[sd]?|release[sd]?|hardship|seven-day|rest-of-season|contract|extension|re-sign(s|ed)?|claim(s|ed)? off waivers|suspend(ed|s)?)\b/i],
  ['coaching', /\b(head coach|coach(es|ing)? (fired|hire|hired|search)|fire[sd] |hires?|general manager|gm )\b/i],
  ['lineup', /\b(starting lineup|start(s|ing)? in place|move(s|d)? to the bench|minutes restriction|rotation|role change)\b/i],
  ['playoffs', /\b(playoff|playoffs|postseason|clinch(es|ed)?|seed(ing)?|eliminat(ed|ion)|magic number|standings|tiebreaker)\b/i],
  ['performance', /\b(career-high|franchise record|league record|triple-double|double-double|\d{2}-point|\d{2} points|record-setting|historic)\b/i],
  ['preview', /\b(preview|prediction|predictions|best bets|odds|picks|props|what to watch|keys to)\b/i],
  ['recap', /\b(beat|beats|defeat(s|ed)?|top(s|ped)?|rout(s|ed)?|edge(s|d)?|takeaways|recap|win(s)? over|fall(s)? to|snap(s|ped)?)\b/i],
  ['league', /\b(commissioner|cba|collective bargaining|expansion|draft|all-star|mvp|awards?|rookie of the year|league office|salary cap)\b/i]
];

export function storyType(text) {
  for (const [type, re] of STORY_TYPES) if (re.test(text)) return type;
  return 'news';
}

/** Build lookup structures from the current rosters / teams. */
export function buildDictionary({ players = [], teams = [] }) {
  const nameCount = new Map();
  for (const p of players) nameCount.set(norm(p.name), (nameCount.get(norm(p.name)) || 0) + 1);
  const playerByName = new Map();
  for (const p of players) {
    const n = norm(p.name);
    // Ambiguous full names (two rostered players, same name) are never text-linked.
    if (n.split(' ').length >= 2 && nameCount.get(n) === 1) playerByName.set(n, p);
  }
  const teamByName = new Map();
  for (const t of teams) {
    if (t.name) teamByName.set(norm(t.name), t);
  }
  const playerById = new Map(players.map((p) => [String(p.athlete_id), p]));
  const teamById = new Map(teams.map((t) => [String(t.team_id), t]));
  return { playerByName, teamByName, playerById, teamById };
}

function findPhrases(text, map) {
  const hay = ` ${norm(text)} `;
  const out = [];
  for (const [name, v] of map) {
    if (hay.includes(` ${name} `) || hay.includes(` ${name}'s `) || hay.includes(` ${name}' `)) out.push(v);
  }
  return out;
}

export function linkEntities(item, dict) {
  const text = `${item.headline} ${item.summary || ''}`;
  const ents = new Map();
  for (const e of item.provider_entities || []) {
    if (e.type === 'player') {
      const p = dict.playerById.get(e.id);
      ents.set(`player:${e.id}`, { type: 'player', id: e.id, name: p?.name || e.label, team_id: p?.team_id || null, method: 'provider_tag', on_current_roster: Boolean(p) });
    }
    if (e.type === 'team') ents.set(`team:${e.id}`, { type: 'team', id: e.id, name: dict.teamById.get(e.id)?.name || e.label, method: 'provider_tag' });
  }
  for (const p of findPhrases(text, dict.playerByName)) {
    const k = `player:${p.athlete_id}`;
    if (!ents.has(k)) ents.set(k, { type: 'player', id: String(p.athlete_id), name: p.name, team_id: p.team_id || null, method: 'exact_full_name', on_current_roster: true });
  }
  for (const t of findPhrases(text, dict.teamByName)) {
    const k = `team:${t.team_id}`;
    if (!ents.has(k)) ents.set(k, { type: 'team', id: String(t.team_id), name: t.name, method: 'exact_team_name' });
  }
  // Publisher tags are structured metadata: exact full names there count too.
  const tagText = (item.tags || []).join(' | ');
  for (const p of findPhrases(tagText, dict.playerByName)) {
    const k = `player:${p.athlete_id}`;
    if (!ents.has(k)) ents.set(k, { type: 'player', id: String(p.athlete_id), name: p.name, team_id: p.team_id || null, method: 'exact_full_name_tag', on_current_roster: true });
  }
  for (const t of findPhrases(tagText, dict.teamByName)) {
    const k = `team:${t.team_id}`;
    if (!ents.has(k)) ents.set(k, { type: 'team', id: String(t.team_id), name: t.name, method: 'exact_team_name_tag' });
  }
  // A bare nickname ("Wings") links a team ONLY when a linked player on that
  // team's current roster is also named in the same item.
  const raw = ` ${String(text).replace(/[’‘]/g, "'")} `;
  for (const t of dict.teamById.values()) {
    if (!t.short_name || ents.has(`team:${t.team_id}`)) continue;
    const re = new RegExp(`[^A-Za-z]${t.short_name}('s|')?[^A-Za-z]`);
    if (!re.test(raw)) continue;
    const mate = [...ents.values()].find((e) => e.type === 'player' && String(e.team_id) === String(t.team_id));
    if (mate) ents.set(`team:${t.team_id}`, { type: 'team', id: String(t.team_id), name: t.name, method: `nickname_with_rostered_player:${mate.id}` });
  }
  return [...ents.values()];
}

/**
 * WNBA relevance gate. Returns { accept, score, reasons }.
 * Accept only when the item is demonstrably about the WNBA — not merely
 * women's basketball, and never another sport riding in a "WNBA" feed.
 */
export function relevance(item, entities, source) {
  const text = `${item.headline} ${item.summary || ''}`;
  const tagText = (item.tags || []).join(' | ');
  const reasons = [];
  let score = 0;
  const wnbaWord = /\bwnba\b/i.test(text);
  const wnbaTag = /\bwnba\b/i.test(tagText);
  const teams = entities.filter((e) => e.type === 'team');
  const players = entities.filter((e) => e.type === 'player' && e.on_current_roster);
  if (wnbaWord) { score += 3; reasons.push('mentions WNBA'); }
  if (wnbaTag) { score += 1; reasons.push('publisher tag WNBA'); }
  if (teams.length) { score += 2 + Math.min(teams.length - 1, 1); reasons.push(`team: ${teams.map((t) => t.name).join(', ')}`); }
  if (players.length) { score += 1 + Math.min(players.length - 1, 2) * 0.5; reasons.push(`player: ${players.slice(0, 3).map((p) => p.name).join(', ')}`); }
  if (source.wnba_scope === 'wnba_only') { score += 2; reasons.push('official WNBA source'); }
  const type = storyType(text);
  if (['injury', 'trade', 'transaction', 'coaching', 'lineup', 'playoffs'].includes(type) && (players.length || teams.length)) { score += 1.5; reasons.push(`consequential type: ${type}`); }
  if (OFF_SPORT.test(item.headline) && !wnbaWord && !teams.length) { reasons.push('off-sport headline'); return { accept: false, score: 0, reasons, type }; }
  if (NCAA.test(text) && !wnbaWord && !teams.length) { reasons.push('college context without WNBA signal'); return { accept: false, score: 0, reasons, type }; }
  // International basketball naming WNBA players/teams is WNBA news only with an
  // explicit WNBA mention or a WNBA consequence (injury, transaction).
  if (INTERNATIONAL.test(text) && !wnbaWord && !['injury', 'trade', 'transaction'].includes(type)) { reasons.push('international competition without WNBA consequence'); return { accept: false, score: 0, reasons, type }; }
  // Player-only mentions (e.g. a World Cup story naming WNBA players) need a
  // consequence (injury/transaction) or an explicit WNBA mention to qualify.
  const accept = wnbaWord || teams.length > 0 || source.wnba_scope === 'wnba_only' || (wnbaTag && players.length > 0) || (players.length > 0 && ['injury', 'trade', 'transaction', 'lineup'].includes(type));
  if (!accept) reasons.push('no WNBA signal strong enough');
  return { accept, score: Math.round(score * 10) / 10, reasons, type };
}

const STOP = new Set('the a an and or of to in on at for with vs vs. by from as is are was be after before over into her his their its this that what how why who will says say said'.split(' '));

export function tokens(s) {
  return new Set(norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)));
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/**
 * Assign cluster ids. Same cluster when (within 48h):
 *   - headline token Jaccard >= 0.55, or
 *   - same story type AND same linked player set (non-empty) AND Jaccard >= 0.25.
 * The earliest-published item (ties: higher-priority source) is canonical.
 */
export function clusterItems(items) {
  const sorted = [...items].sort((a, b) => String(a.published_at).localeCompare(String(b.published_at)));
  const clusters = [];
  for (const it of sorted) {
    const tk = tokens(it.headline);
    const pset = it.entities.filter((e) => e.type === 'player').map((e) => e.id).sort().join(',');
    let home = null;
    for (const c of clusters) {
      const dt = Math.abs(Date.parse(it.published_at || 0) - Date.parse(c.first_published || 0));
      if (dt > 48 * 3600e3) continue;
      // Cross-publisher dedupe only: one publisher's distinct URLs are distinct
      // articles (e.g. a "quarterfinal preview" and a "semifinal preview").
      if (c.members.some((m) => m.source_id === it.source_id)) continue;
      const jac = Math.max(...c.members.map((m) => jaccard(tk, m.tk)));
      if (jac >= 0.55 || (pset && c.type === it.story_type && c.members.some((m) => m.pset === pset) && jac >= 0.25)) { home = c; break; }
    }
    if (!home) {
      home = { cluster_id: `c_${it.item_id}`, canonical_item_id: it.item_id, headline: it.headline, type: it.story_type, first_published: it.published_at, members: [] };
      clusters.push(home);
    }
    home.members.push({ item_id: it.item_id, tk, pset, source_id: it.source_id, priority: it.priority });
    it.cluster_id = home.cluster_id;
  }
  for (const c of clusters) {
    const byPriority = [...c.members].sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9));
    // canonical = earliest; if an official source is in the cluster, it wins.
    if (byPriority[0].priority === 1) c.canonical_item_id = byPriority[0].item_id;
  }
  return clusters.map((c) => ({ cluster_id: c.cluster_id, canonical_item_id: c.canonical_item_id, headline: c.headline, story_type: c.type, first_seen_at: c.first_published, item_count: c.members.length, members: c.members.map((m) => m.item_id) }));
}

export async function itemId(canonical) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(buf)].slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join('');
}
