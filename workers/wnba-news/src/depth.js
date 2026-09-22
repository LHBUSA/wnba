// Newsroom depth ladder — wnba-depth/1.0.0.
//
// Every generated story receives a deterministic EDITORIAL DEPTH CLASS from its evidence, then is scored against the
// SUBSTANCE CONTRACT of its desk. Word count is a diagnostic reported against the class's target range; it never
// decides publication on its own. A well-covered 620-word story passes; a repetitive 900-word story fails.
//
//   class  flash   genuinely breaking and sparse; provisional; upgrades in place (same id and URL) as facts arrive
//          brief   a legitimate event with limited evidence and some PropBetEdge context
//          full    the default for a meaningful event with rich verified records
//          deep    a significant event (medal game, trade, star injury, labor/expansion, record) with the richest records
//
// Classification reads the FACT BLOCK (what records exist), never the prose, so a thin generator cannot talk its way
// into a lower bar: rich evidence sets a high class, and a story that does not develop that evidence is held.
//
// Publication = no hard failure AND every supported core element met AND substance score ≥ the class threshold.
// Hard failures: gross shallowness (under the class floor), repeated paragraphs/sentences/phrases, empty or duplicate
// sections, an Intelligence module restating the body, play-by-play language without play-by-play, and unsupported
// characterisation.

import { sentencesOf, contentTokens, restates, duplicatedIdeas, repeatsIdea } from '../../../src/lib/semantic.js';

export const DEPTH_VERSION = 'wnba-depth/1.1.0';

export const DEPTH_CLASSES = {
  flash: { label: 'Flash', rank: 0, range: [150, 350], floor: 40, pass: 0.6, sections: 1, developed: 0, evidence: 1 },
  brief: { label: 'Brief', rank: 1, range: [350, 650], floor: 120, pass: 0.75, sections: 2, developed: 1, evidence: 2 },
  full: { label: 'Full', rank: 2, range: [650, 1100], floor: 300, pass: 0.8, sections: 4, developed: 2, evidence: 3 },
  deep: { label: 'Deep', rank: 3, range: [1000, 1600], floor: 480, pass: 0.85, sections: 5, developed: 3, evidence: 3 }
};

const f1 = (v) => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '') : null);
export const wordsOf = (body) => (body || []).join(' ').split(/\s+/).filter(Boolean).length;
const ms = (x) => { const v = Date.parse(x || ''); return Number.isFinite(v) ? v : null; };

// ------------------------------------------------------------ desks

// Event types a News Brief can carry, by the desk contract that applies to them.
const BRIEF_DESK = {
  injury: 'injury', availability: 'injury',
  trade: 'transaction', signing: 'transaction', waiver: 'transaction', roster_move: 'transaction',
  record: 'record', awards: 'record',
  draft: 'draft',
  cba: 'league', expansion: 'league', league: 'league', business: 'league', front_office: 'league', coaching: 'league', playoff: 'league'
};

/** The newsroom desk a story reports for (a News Brief files under its event's desk). */
export function deskOfStory(a) {
  if (a.kind === 'brief') return BRIEF_DESK[a.facts?.brief?.event_type] || 'external';
  return contractOf(a);
}

/**
 * The substance contract a story is held to. Every story derived from external reporting — whatever its desk — is held
 * to the external-report contract, the strictest: an underlying event, PropBetEdge's original value, developed records.
 */
export function contractOf(a) {
  if (a.kind === 'international') return 'international';
  if (a.kind === 'result' || a.kind === 'performance') return 'game';
  if (a.kind === 'injury' || a.kind === 'transaction' || a.kind === 'preview') return a.kind;
  if (a.kind === 'trend' || a.kind === 'props' || a.kind === 'market') return 'market';
  return 'external';
}

// Section titles written by the generators, mapped to the element they carry. Sections may also carry `key`.
const TITLE_KEY = {
  // Current sports-desk labels.
  'The latest': 'change', 'Who picks up the minutes': 'role', 'Team context': 'team', 'The line': 'market', 'Next up': 'next',
  'Game outlook': 'lede', Availability: 'availability', 'How they match up': 'matchup', 'Before tip': 'next',
  'What happened': 'change', 'The players involved': 'move', 'How it fits': 'roster', 'Recent moves': 'moves',
  'Game story': 'lede', 'Who stood out': 'performers', 'How it happened': 'flow', 'What it means': 'context',
  'The run': 'lede', 'The numbers': 'evidence', 'The next line': 'market', 'Next matchup': 'team', 'What could break the trend': 'counter',
  // Legacy labels remain readable for archived stories and migration audits.
  'The read': 'lede', 'The listing': 'change', 'Her role and the rotation': 'role', 'Her role': 'role', 'The rotation without her': 'rotation',
  'The market': 'market', 'The counter-case': 'counter', 'What matters next': 'next', 'What comes next': 'next',
  'The matchup': 'matchup', 'The move': 'move', 'The player': 'move', 'The roster it lands in': 'roster',
  'The performances': 'performers', 'Who delivered': 'performers', 'How the game unfolded': 'flow',
  'Why it went this way': 'why', 'The evidence': 'evidence', 'The development': 'change',
  'What PropBetEdge can verify': 'records', 'What PropBetEdge’s records show': 'records', 'Why it matters': 'why',
  'The team around her': 'team', 'Where the team stands': 'team', 'The standings picture': 'team',
  'The stretch that decided it': 'decisive', 'WNBA connection': 'wnba'
};
export function sectionKey(s, i = 0) {
  if (s?.key) return s.key;
  if (!s?.title) return i === 0 ? 'lede' : null;
  if (TITLE_KEY[s.title]) return TITLE_KEY[s.title];
  if (/^Why .+ won$/.test(s.title)) return 'why';
  if (/^What .+ couldn’t overcome$/.test(s.title)) return 'opponent';
  if (/^What (gold|silver|bronze|it) means$|^Where it leaves/.test(s.title)) return 'context';
  return null;
}
const sectionText = (a, key) => (a.sections || []).map((s, i) => ({ s, k: sectionKey(s, i) })).filter((x) => x.k === key).flatMap((x) => (a.body || []).slice(x.s.first, x.s.first + x.s.count));

// ------------------------------------------------------------ classification

/** Verified evidence dimensions present in the fact block. */
export function evidenceDimensions(a) {
  const f = a.facts || {};
  const v = f.brief?.verified || {};
  const ev = a.evidence || [];
  const g = f.game || null; // international game-story facts
  const dims = new Set();
  const add = (k, cond) => { if (cond) dims.add(k); };
  if (a.kind === 'international' && g) {
    add('game_record', true);
    add('quarters', g.quarters);
    add('box_score', g.totals || (f.box_lines || []).length);
    add('play_by_play', g.pbp);
    add('tournament_path', g.path?.winner?.games?.length);
    add('player_form', [...(g.lines?.winner || []), ...(g.lines?.loser || [])].some((p) => p.prior));
    add('wnba_crosswalk', (g.wnba || []).length);
    return [...dims];
  }
  add('primary_record', ev.some((e) => e.kind === 'record'));
  add('corroboration', new Set(ev.filter((e) => e.kind === 'publisher_report').map((e) => e.publisher)).size >= 2);
  add('player_season', f.season_log || (f.profiles || []).some((p) => p.current || p.prior) || v.season || (f.comparisons || []).length || f.player_season);
  add('player_recent', f.season_log?.last10 || f.recent_games?.length || v.season?.last5 || (f.comparisons || []).some((c) => c.entering?.last10));
  add('rotation', (f.rotation || []).length || f.away?.rotation?.rows?.length);
  add('injury_feed', f.injury || (f.injury_scope || []).length || v.injury);
  add('team_standing', f.standing || f.after?.w || v.standing || f.away?.standing || f.team_form);
  add('schedule', f.next_game || (f.next || []).length || v.next_game || a.context?.next_game);
  add('box_score', (f.box_lines || []).length || f.team_stats?.w);
  add('play_by_play', f.lead);
  add('history', (f.series_games || []).length || (f.rows || []).length >= 8 || f.since?.n || (f.team_moves || []).length);
  add('market', a.market_watch?.market || f.market || f.ats || ['props', 'market', 'trend'].includes(a.kind));
  add('transaction_log', (f.moves || []).length || v.transaction);
  add('observed_absence', f.observed);
  return [...dims];
}

/** Event importance, 0–3, from facts only. */
export function importanceOf(a) {
  const f = a.facts || {};
  switch (a.kind) {
    case 'international': return { medal: 3, elimination: 2, recap: 1, breaking: 2 }[f.game?.story_class] ?? 1;
    case 'performance': return 2;
    case 'result': return 1;
    case 'injury': {
      const s = f.season_log || {};
      const star = (s.pts ?? 0) >= 15 || (s.min ?? 0) >= 28;
      const mode = f.absence?.mode;
      if (mode === 'long') return 1; // the absence is not new
      if (star) return mode === 'intermittent' ? 2 : 3;
      return (s.min ?? 0) >= 18 ? 2 : 1;
    }
    case 'transaction': {
      if ((f.moves || []).some((m) => /\b(Traded|in exchange for)\b/i.test(m))) return 3;
      return (f.profiles || []).some((p) => (p.current?.min ?? 0) >= 20) ? 2 : 1;
    }
    case 'brief': {
      const t = f.brief?.event_type;
      if (!f.brief?.underlying_event && f.brief?.underlying_event !== undefined) return 0;
      if (['trade', 'cba', 'expansion'].includes(t)) return 3;
      if (['injury', 'signing', 'waiver', 'roster_move', 'coaching', 'front_office', 'awards', 'record', 'draft'].includes(t)) return 2;
      return 1;
    }
    default: return 1;
  }
}

/**
 * Developing = the record behind the story is still arriving: an international result whose box score is not
 * published, or a News Brief whose only evidence is the report itself, observed within the last three hours.
 */
export function developingOf(a, { now = Date.now() } = {}) {
  const f = a.facts || {};
  if (a.kind === 'international') return f.game?.story_class === 'breaking';
  if (a.kind === 'brief') {
    const pbe = (a.evidence || []).filter((e) => e.kind === 'record').length;
    const first = ms(a.published_at);
    return pbe === 0 && first !== null && now - first <= 3 * 3600e3;
  }
  return Boolean(f.developing);
}

/** Deterministic depth class. */
export function classifyDepth(a, { now = Date.now() } = {}) {
  const dims = evidenceDimensions(a);
  const importance = importanceOf(a);
  const developing = developingOf(a, { now });
  const n = dims.length;
  let cls;
  const reasons = [`${n} evidence dimensions (${dims.join(', ') || 'none'})`, `importance ${importance}`];
  // A story derived from external reporting reaches Full only when PropBetEdge's own records confirm the event (a
  // matching transaction or injury listing) or independent publishers corroborate it, on top of rich records.
  const b = a.kind === 'brief' ? a.facts?.brief || {} : null;
  // Full needs BOTH a PropBetEdge record that confirms the event (or, lacking one, a second publisher) and rich records;
  // a single-publisher report stays Brief even when a record confirms it.
  const pbeConfirms = b ? Boolean(b.verified?.transaction || b.verified?.record?.verified || (['injury', 'availability'].includes(b.event_type) && b.verified?.injury?.status)) : true;
  const confirmed = b ? (pbeConfirms && dims.includes('corroboration')) || (!pbeConfirms && dims.includes('corroboration') && (b.value?.count ?? 0) >= 5) : true;
  if (developing && n <= 3) { cls = 'flash'; reasons.push('developing event with sparse verified records'); }
  else if (b && (!confirmed || (b.value?.count ?? 0) < 5)) { cls = n >= 2 || !developing ? 'brief' : 'flash'; reasons.push(confirmed ? 'external report with limited PropBetEdge records' : 'external report not yet confirmed by a PropBetEdge record or a second publisher'); }
  else if (importance >= 3 && n >= 6) { cls = 'deep'; reasons.push('significant event with the richest records'); }
  else if (n >= 6 || (importance >= 2 && n >= 4)) { cls = 'full'; reasons.push('meaningful event with rich verified records'); }
  else { cls = 'brief'; reasons.push('legitimate event with limited verified records'); }
  return { class: cls, dimensions: dims, importance, developing, provisional: cls === 'flash', reasons };
}

// ------------------------------------------------------------ substance contracts

const has = (xs, re) => re.test((xs || []).join(' '));
const words = (xs) => (xs || []).join(' ').split(/\s+/).filter(Boolean).length;
const BOILERPLATE = /(context,? (rather than|not) a signal|matters (for a line or prop )?only if|is revised when one does|this story does not restate it|remains .{0,40} reporting; this story|captured only inside 36 hours|not a PropBetEdge projection|check the availability panel)/i;
const recordIn = (text, w, l) => Number.isFinite(w) && Number.isFinite(l) && new RegExp(`\\b${w}[-–]${l}\\b`).test(text);

/** Elements per contract: [key, supported(a), met(a, ctx), core]. */
function elementsFor(contract, a, cls) {
  const f = a.facts || {};
  const body = a.body || [];
  const all = body.join(' ');
  const S = (k) => sectionText(a, k);
  const lede = S('lede').length ? S('lede') : body.slice(0, a.sections?.[0]?.count || 1);
  const ledeWords = words(lede.slice(0, 2));
  const E = [];
  const el = (key, supported, met, core = false) => E.push({ key, supported: Boolean(supported), met: Boolean(supported && met), core });
  el('lede', true, lede.length && (words(lede.slice(0, 1)) >= 20 || ledeWords >= 25), true);

  switch (contract) {
    case 'international': {
      const g = f.game || {};
      const winners = (g.lines?.winner || []).map((p) => p.name);
      const losers = (g.lines?.loser || []).map((p) => p.name);
      if (g.story_class === 'breaking') break;
      el('result_and_star', true, lede.join(' ').includes(String(g.winner?.score)) && winners.some((n) => lede.join(' ').includes(n)), true);
      el('game_flow', g.quarters, S('flow').length >= 2 && has(S('flow'), /quarter|halftime/i), true);
      el('decisive_stretch', g.quarters || g.pbp, S('decisive').length >= 1);
      const why = S('why');
      el('statistical_explanation', (g.separators || []).length, why.length >= 2 && /percent/i.test(why.join(' ')), true);
      const perf = S('performers').join(' ');
      el('player_performances', winners.length >= 2, winners.filter((n) => perf.includes(n)).length >= 2 && /\d+ points?/.test(perf), true);
      el('opponent', losers.length, losers.some((n) => S('opponent').join(' ').includes(n)));
      el('tournament_context', g.medal || g.next || g.path?.winner?.games?.length, S('context').length >= 1, true);
      el('wnba_decision', true, ((g.wnba || []).length > 0) === (S('wnba').length > 0), true);
      break;
    }
    case 'game': {
      const names = (f.box_lines || []).map((x) => x.name);
      el('performers', names.length, S('performers').length >= 1 && /\d+ points?/.test(S('performers').join(' ')), true);
      el('game_flow', (f.quarters || []).length, S('flow').length >= 1 && /quarter|halftime/i.test(S('flow').join(' ')), true);
      el('statistical_explanation', f.team_stats?.w, /from the field|%|percent/i.test(all) && /rebound|turnover/i.test(all), true);
      el('both_teams', names.length, (f.box_lines || []).some((x) => String(x.team_id) !== String(a.lead_team_id) && all.includes(x.name)) || S('opponent').length > 0);
      el('lead_changes', f.lead, /lead change|never trailed|led wire to wire/i.test(all));
      el('team_context', f.after?.w, recordIn(all, f.after?.w?.w, f.after?.w?.l), true);
      el('next', (f.next || []).length, S('next').length >= 1 || /\bNext(?: up)?:/.test(all), true);
      break;
    }
    case 'injury': {
      const s = f.season_log || {};
      el('what_changed', true, S('change').length >= 1 && /updated/i.test(S('change').join(' ')), true);
      el('role_and_production', s.games, all.includes(`${s.games} game`) || all.includes(`${s.games} games`) || /games?,/.test(all), true);
      el('minutes', Number.isFinite(s.min), all.includes(`${f1(s.min)} minute`) || all.includes(`${f1(s.min)} min`), true);
      el('recent_form', s.last10 || (f.recent_games || []).length, /\blast (five|ten|\d+|\w+)\b[^.]{0,40}\bgames?\b|previous \w+ games/i.test(all));
      el('rotation', (f.rotation || []).length, S('role').length + S('rotation').length >= 1 && /\bmin\b|minutes/i.test([...S('role'), ...S('rotation')].join(' ')), true);
      el('team_context', f.standing, recordIn(all, f.standing?.wins, f.standing?.losses) || /\bover their last 10\b/.test(all));
      el('schedule', f.next_game, S('next').length >= 1, true);
      el('market', f.market, S('market').length >= 1);
      break;
    }
    case 'transaction': {
      el('the_move', true, /transactions log/i.test(lede.join(' ') + S('move').join(' ')), true);
      el('player_profile', (f.profiles || []).length, S('move').length >= 1, true);
      el('player_production', (f.profiles || []).some((p) => p.current?.games || p.prior?.games), /\d+(\.\d)? (points|minutes)/.test(S('move').join(' ')));
      el('roster_context', (f.rotation || []).length, S('roster').length >= 1, true);
      el('availability', !f.injury_feed_unavailable, /injury feed/i.test(all));
      el('team_context', f.standing, recordIn(all, f.standing?.wins, f.standing?.losses));
      el('recent_moves', (f.team_moves || []).length, S('moves').length >= 1 || /earlier (move|transaction)|also (signed|waived|released)/i.test(all));
      el('schedule', a.context?.next_game, S('next').length >= 1 || /\bnext\b/i.test(all));
      break;
    }
    case 'preview': {
      el('availability', true, S('availability').length >= 1, true);
      el('matchup', true, S('matchup').length >= 2, true);
      el('form', f.home?.form, /last 10|last \d+/i.test(all), true);
      el('rest', (f.rest_days || []).length === 2, /days? of rest/.test(all));
      el('season_series', (f.series_games || []).length, /Season series/.test(all));
      el('market', f.market, S('market').length >= 1);
      el('counter_case', f.market && S('market').length > 1, S('counter').length >= 1);
      el('next', true, S('next').length >= 1, true);
      break;
    }
    case 'market': {
      el('evidence', true, S('evidence').length >= 1 || body.length >= 3, true);
      el('counter_case', a.kind === 'trend', S('counter').length >= 1, true);
      el('game_log', (f.rows || []).length, /Game by game/.test(all));
      el('next', f.next, /next game|next total|next spread/i.test(all));
      break;
    }
    default: {
      // external / league / record / draft briefs
      const b = f.brief || {};
      // League/business desk: corroboration by independent publishers is part of what the story establishes.
      const value = { dimensions: [...((b.value || {}).dimensions || []), ...(b.desk === 'league' && (b.publishers || 0) >= 2 ? ['corroboration'] : [])] };
      const recordDesk = b.desk === 'record';
      el('the_development', true, S('change').length >= 1, true);
      el('underlying_event', true, b.underlying_event === true, true);
      const leagueDesk = b.desk === 'league';
      el('original_value', true, value.dimensions.length >= (cls === 'full' || cls === 'deep' ? 4 : cls === 'brief' ? (leagueDesk ? 1 : 2) : 0), true);
      const developedRecords = S('records').length + S('team').length + S('context').length + S('game').length + S('history').length;
      el('records_developed', value.dimensions.length, developedRecords >= (value.dimensions.length >= 3 ? 2 : 1), recordDesk);
      const why = [
        ...S('why'),
        ...S('implication'),
        ...S('history'),
        ...(leagueDesk ? S('context') : [])
      ].filter((p) => !BOILERPLATE.test(p));
      // On league/front-office stories, grounded roster or standings context is
      // itself the relevance. Do not force a synthetic "why it matters" section
      // when the context already explains what the change inherits.
      el('why_it_matters', value.dimensions.length, why.length >= 1);

      if (recordDesk) {
        // A record story ends when the achievement and its basketball context
        // are explained. It must never grow a fake "what comes next" paragraph
        // merely to satisfy a template.
        el('record_verified', true, b.verified?.record?.verified === true, true);
        el('record_game_or_context', true, S('game').length + S('records').length >= 1, true);
        el('record_history', true, S('history').length >= 1, true);
      } else {
        // "Next" is core only when the facts actually support a forward-looking
        // basketball consequence. League/draft stories are not padded with an
        // unresolved/process paragraph just to fill a slot.
        const nextSupported = Boolean(b.verified?.next_game) || ['injury', 'availability', 'trade', 'signing', 'waiver', 'roster_move', 'lineup'].includes(b.event_type);
        if (nextSupported) {
          el('next', true, [...S('next'), ...S('implication')].filter((p) => !BOILERPLATE.test(p)).length >= 1, true);
        }
      }
    }
  }
  // Shared: sections developed for the class, and evidence cited for it.
  // Developed = a titled section carrying at least two paragraphs, or one paragraph of 60+ words (a real argument, not a note).
  const titled = (a.sections || []).filter((s) => s.title && s.count > 0);
  const developed = titled.filter((s) => s.count >= 2 || words(body.slice(s.first, s.first + s.count)) >= 60);
  el('sections_developed', cls !== 'flash', titled.length >= DEPTH_CLASSES[cls].sections && developed.length >= DEPTH_CLASSES[cls].developed, cls === 'full' || cls === 'deep');
  // An international game record is one consolidated citation (game, quarters and box score), so two records suffice there.
  el('evidence_cited', a.evidence !== undefined, (a.evidence || []).length >= (contract === 'international' ? Math.min(2, DEPTH_CLASSES[cls].evidence) : DEPTH_CLASSES[cls].evidence), true);
  return E;
}

// ------------------------------------------------------------ hard failures

const PBP_LANGUAGE = /(lead changed hands|lead changes?\b|never trailed|score was tied|last (led|tie)|largest lead was|pulled away for good|over the next stretch|with \d{1,2}:\d{2} left|\bpossessions? (in a row|straight)|\b\d+[-–]0 run\b|unanswered)/i;
// Scouting language is opinion, never a record: rejected in PropBetEdge prose (quoted publisher headlines excepted).
export const SCOUTING_LANGUAGE = /\b(elite feel|high motor|(nba|wnba)[- ]ready|a (natural )?winner|winning mentality|generational|can['’]t[- ]miss|franchise[- ]altering|high ceiling|sky-high ceiling|upside|special talent|superstar|game[- ]changer|elite)\b/i;
// League / business / draft desks: no financial figures, motives, negotiating positions or legal conclusions of our own.
export const BUSINESS_CLAIMS = /(\$\s?\d|\b\d+(\.\d+)?\s?(million|billion)\b|\bvaluations?\b|\bin an? effort to\b|\bseeks? to\b|\bseek to\b|\baims? to\b|\bwants? to\b|\bmotivat\w*|\bleverage\b|\bnegotiating (position|stance|tactic)s?\b|\bhardball\b|\b(is|was|are|were) (illegal|unlawful|meritless|frivolous|baseless|justified)\b|\bviolat(e|ed|es|ion)\b|\bliable\b|\bwill (win|lose)\b)/i;
const UNSUPPORTED = /\b(momentum|wanted it more|refused to lose|willed (her|them|the)|clutch gene|statement win|sent a message|hungrier)\b/i;

function repetition(body) {
  const out = [];
  const paras = (body || []).map((p) => p.trim().toLowerCase());
  if (new Set(paras).size !== paras.length) out.push('depth: duplicate paragraphs');
  const sents = sentencesOf((body || []).join(' ')).map((s) => contentTokens(s).join(' ')).filter((s) => s.split(' ').length >= 6);
  const seen = new Map();
  for (const s of sents) seen.set(s, (seen.get(s) || 0) + 1);
  const dup = [...seen.values()].filter((c) => c > 1).length;
  if (dup) out.push(`depth: ${dup} repeated ${dup === 1 ? 'sentence' : 'sentences'}`);
  const tokens = contentTokens((body || []).join(' '));
  const grams = new Map();
  for (let i = 0; i + 5 <= tokens.length; i += 1) { const k = tokens.slice(i, i + 5).join(' '); grams.set(k, (grams.get(k) || 0) + 1); }
  const repeated = [...grams.values()].filter((c) => c > 2).reduce((s, c) => s + c, 0);
  const ratio = tokens.length ? Math.round((repeated / tokens.length) * 1000) / 1000 : 0;
  if (ratio > 0.1) out.push(`depth: phrase repetition ratio ${ratio}`);
  return { failures: out, ratio };
}

/** Intelligence copy that restates the body. Rendered copy (a.intelligence.copy) is what the reader sees. */
export function intelligenceDuplicates(a) {
  const copy = a.intelligence?.copy;
  if (!copy || !a.intelligence?.render?.intelligence) return [];
  return duplicatedIdeas([copy.summary, ...(copy.supporting || [])].filter(Boolean), [a.headline, a.deck, ...(a.body || [])].filter(Boolean));
}

// ------------------------------------------------------------ assessment

/**
 * The depth assessment for one generated article. `now` is the run instant (developing test); `pbp` overrides the
 * play-by-play availability for game desks (defaults to the facts).
 */
export function assessDepth(a, { now = Date.now() } = {}) {
  const c = classifyDepth(a, { now });
  const cls = c.class;
  const rule = DEPTH_CLASSES[cls];
  const contract = contractOf(a);
  const elements = elementsFor(contract, a, cls);
  const supported = elements.filter((e) => e.supported);
  const met = supported.filter((e) => e.met);
  const score = supported.length ? Math.round((met.length / supported.length) * 100) / 100 : 0;
  const unmetCore = supported.filter((e) => e.core && !e.met).map((e) => e.key);
  const unmet = supported.filter((e) => !e.met).map((e) => e.key);
  const words = wordsOf(a.body);
  const text = [a.headline, a.deck, ...(a.body || [])].join('\n');

  const hard = [];
  if (words < rule.floor) hard.push(`depth: ${words} words is below the ${rule.label} floor of ${rule.floor}`);
  const rep = repetition(a.body);
  hard.push(...rep.failures);
  const titles = (a.sections || []).map((s) => s.title).filter(Boolean);
  if (new Set(titles).size !== titles.length) hard.push('depth: duplicate section titles');
  if ((a.sections || []).some((s) => s.title && !s.count)) hard.push('depth: empty section');
  const pbpAvailable = contract === 'international' ? Boolean(a.facts?.game?.pbp) : contract === 'game' ? Boolean(a.facts?.lead) : true;
  if (!pbpAvailable && PBP_LANGUAGE.test(text)) hard.push(`depth: play-by-play language without play-by-play (“${text.match(PBP_LANGUAGE)[0]}”)`);
  if (UNSUPPORTED.test(text)) hard.push(`depth: unsupported characterisation (“${text.match(UNSUPPORTED)[0]}”)`);
  const own = text.replace(/“[^”]*”/g, ' '); // PropBetEdge's own words: quoted publisher headlines removed
  if (SCOUTING_LANGUAGE.test(own)) hard.push(`depth: scouting language is not a record (“${own.match(SCOUTING_LANGUAGE)[0]}”)`);
  const deskName = deskOfStory(a);
  if (['league', 'draft'].includes(deskName) && BUSINESS_CLAIMS.test(own)) hard.push(`depth: unsourced financial, motive or legal claim (“${own.match(BUSINESS_CLAIMS)[0]}”)`);
  const dupIntel = intelligenceDuplicates(a);
  if (dupIntel.length) hard.push(`depth: PropBetEdge Intelligence restates the article body (“${dupIntel[0].slice(0, 80)}”)`);

  // Diagnostic (not a hold): body sentences that repeat an idea from an EARLIER section without adding a figure or name.
  let ideaRepetitions = 0;
  const bySection = (a.sections || []).map((s) => sentencesOf((a.body || []).slice(s.first, s.first + s.count).join(' ')));
  for (let i = 1; i < bySection.length; i += 1) { const earlier = bySection.slice(0, i).flat(); ideaRepetitions += bySection[i].filter((x) => repeatsIdea(x, earlier)).length; }
  const failures = [...hard];
  if (unmetCore.length) failures.push(`depth: ${rule.label} ${contract} story is missing core substance: ${unmetCore.join(', ')}`);
  if (score < rule.pass) failures.push(`depth: substance score ${score} is below the ${rule.label} threshold ${rule.pass} (unmet: ${unmet.join(', ')})`);
  const diagnostics = [];
  if (words < rule.range[0]) diagnostics.push(`words ${words} below the ${rule.label} target range ${rule.range[0]}–${rule.range[1]} (diagnostic)`);
  if (words > rule.range[1]) diagnostics.push(`words ${words} above the ${rule.label} target range ${rule.range[0]}–${rule.range[1]} (diagnostic)`);
  return {
    version: DEPTH_VERSION,
    class: cls,
    label: rule.label,
    contract,
    desk: deskOfStory(a),
    provisional: c.provisional,
    developing: c.developing,
    importance: c.importance,
    dimensions: c.dimensions,
    reasons: c.reasons,
    score,
    elements: elements.map(({ key, supported: s, met: m, core }) => ({ key, supported: s, met: m, core })),
    unmet,
    words,
    target_range: rule.range,
    sections: titles.length,
    repetition_ratio: rep.ratio,
    idea_repetitions: ideaRepetitions,
    pass: failures.length === 0,
    failures,
    diagnostics
  };
}

export const depthRank = (cls) => DEPTH_CLASSES[cls]?.rank ?? -1;
