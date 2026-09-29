// Live newsroom regression scan: every listed article (and the correction pages) against the defects this production
// pass fixed. Read-only.   node scripts/newsroom-live-regressions.mjs
const NEWS = process.env.WNBA_NEWS || 'https://wnba-news.sales-fd3.workers.dev';
const get = async (p) => (await fetch(`${NEWS}${p}${p.includes('?') ? '&' : '?'}cb=${Date.now()}`)).json();
const PATTERNS = [
  ['0-0 records', /\bwere 0-0 and the\b/],
  ['"1 assists"-type agreement', /(?<![\d.,])1 (points|rebounds|assists|steals|blocks|turnovers|minutes|games|starts)\b/],
  ['"a 18" article', /\ba (8|11|18|8\d)(\.\d)?[- ]/],
  ['zero minutes', /\bplayed 0(\.0)? minutes\b|\bstarted none\b/],
  ['placeholder', /\bnull \(undefined\)|\bundefined\b|\bNaN\b/],
  ['award "conversation"', /enters the .{0,40}conversation/i],
  ['false coaching change', /make coaching change/i],
  ['bench tie "outscored"', /outscored[^.]*?\b(\d+)[–-]\1\b/],
  ['uneven recent stretch', /uneven recent stretch/i]
];
const list = (await get('/v1/articles?limit=200')).data.items;
const problems = [];
let editorial = 0; let visuals = 0; let checked = 0;
const kinds = {};
for (const c of list) {
  const a = (await get(`/v1/articles/${c.id}`)).data?.article;
  if (!a) { problems.push(`${c.id}: listed card has no article`); continue; }
  checked += 1;
  const text = [a.headline, a.deck, ...(a.body || [])].join(' \n ');
  for (const [name, re] of PATTERNS) { const m = text.match(re); if (m) problems.push(`${c.id} ${a.kind} [${name}] “${m[0]}” — ${a.headline.slice(0, 70)}`); }
  // identity: card and article resolve the same subject and the same pictured person
  const cs = JSON.stringify(c.subject || null); const as = JSON.stringify(a.subject || null);
  if (c.subject && a.subject && cs !== as) problems.push(`${c.id} subject drift card ${cs} vs article ${as}`);
  const cm = (c.media?.subjects || []).map((s) => s.player_id).join(','); const am = (a.media?.subjects || []).map((s) => s.player_id).join(',');
  if (cm !== am) problems.push(`${c.id} media drift card [${cm}] vs article [${am}]`);
  if (a.subject?.type === 'player' && (a.media?.subjects || []).some((s) => s.player_id !== a.subject.id)) problems.push(`${c.id} WRONG SUBJECT PHOTO: subject ${a.subject.id} pictured ${am}`);
  if (a.editorial?.status === 'applied') editorial += 1;
  if ((a.visuals || []).length) visuals += 1;
  (kinds[a.kind] ||= { n: 0, visuals: 0, editorial: 0 }).n += 1;
  if ((a.visuals || []).length) kinds[a.kind].visuals += 1;
  if (a.editorial?.status === 'applied') kinds[a.kind].editorial += 1;
}
for (const [id, want] of [['467ed1ad4743', /^corrected: /], ['316e67086ede', /^withdrawn: /]]) {
  const a = (await get(`/v1/articles/${id}`)).data?.article;
  if (!a || a.quality_state !== 'retired_from_index' || !want.test(a.quality_review?.reason || '')) problems.push(`${id}: correction/withdrawal page not intact`);
  if (list.some((c) => c.id === id)) problems.push(`${id}: retired story is still listed`);
}
console.log(`listed ${list.length}, checked ${checked}; editorial rewrites live ${editorial}; with contract visuals ${visuals}`);
console.log(JSON.stringify(kinds));
console.log(problems.length ? `PROBLEMS ${problems.length}\n  ${problems.join('\n  ')}` : 'PROBLEMS 0');
process.exit(problems.length ? 1 : 0);
