// Feed parsing without a DOM (Workers runtime). Only the fields we are allowed
// to keep are extracted: title, link, description/summary, dates, tags, byline.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', hellip: '…' };

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function stripHtml(s) {
  // Feeds often entity-encode their HTML (&lt;p&gt;), so decode, strip tags, decode again.
  const unwrapped = String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decodeEntities(decodeEntities(unwrapped).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = block.match(re);
  return m ? m[1] : null;
}

function tags(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi');
  return [...block.matchAll(re)].map((m) => stripHtml(m[1])).filter(Boolean);
}

function attr(block, name, attrName) {
  const re = new RegExp(`<${name}\\s[^>]*${attrName}="([^"]+)"`, 'i');
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : null;
}

const toIso = (v) => {
  if (!v) return null;
  const t = Date.parse(stripHtml(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

export function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const b = m[0];
    items.push({
      headline: stripHtml(tag(b, 'title')),
      url: stripHtml(tag(b, 'link')) || attr(b, 'link', 'href'),
      summary: stripHtml(tag(b, 'description')).slice(0, 400) || null,
      published_at: toIso(tag(b, 'pubDate') || tag(b, 'dc:date')),
      updated_at: null,
      byline: stripHtml(tag(b, 'dc:creator') || tag(b, 'author')) || null,
      tags: tags(b, 'category')
    });
  }
  if (!items.length) {
    for (const m of xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)) {
      const b = m[0];
      items.push({
        headline: stripHtml(tag(b, 'title')),
        url: attr(b, 'link', 'href') || stripHtml(tag(b, 'id')),
        summary: stripHtml(tag(b, 'summary') || tag(b, 'content')).slice(0, 400) || null,
        published_at: toIso(tag(b, 'published') || tag(b, 'updated')),
        updated_at: toIso(tag(b, 'updated')),
        byline: stripHtml(tag(b, 'name')) || null,
        tags: [...b.matchAll(/<category[^>]*term="([^"]+)"/gi)].map((x) => decodeEntities(x[1]))
      });
    }
  }
  return items.filter((i) => i.headline && i.url);
}

export function parseEspnNews(body) {
  return (body?.articles || []).map((a) => ({
    headline: a.headline || null,
    url: a.links?.web?.href || null,
    summary: a.description ? String(a.description).slice(0, 400) : null,
    published_at: a.published || null,
    updated_at: a.lastModified || null,
    byline: a.byline || null,
    tags: (a.categories || []).map((c) => c.description).filter(Boolean),
    provider_entities: (a.categories || [])
      // sportId 59 = WNBA in ESPN's taxonomy (verified in the canary). Tags from
      // other sports (NCAA, Olympics) are never turned into WNBA entity links.
      .map((c) => {
        if (Number(c.sportId) !== 59) return null;
        if (c.type === 'athlete' && (c.athleteId || c.athlete?.id)) return { type: 'player', id: String(c.athleteId || c.athlete.id), label: c.description };
        if (c.type === 'team' && (c.teamId || c.team?.id)) return { type: 'team', id: String(c.teamId || c.team.id), label: c.description };
        return null;
      })
      .filter(Boolean),
    provider_type: a.type || null,
    premium: Boolean(a.premium)
  })).filter((i) => i.headline && i.url);
}

export function parseWnbaCom(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('wnba_com_no_next_data');
  const data = JSON.parse(m[1]);
  const items = data?.props?.pageProps?.newsData?.items;
  if (!Array.isArray(items)) throw new Error('wnba_com_shape_changed');
  return items.map((i) => ({
    headline: stripHtml(i.title),
    url: i.permalink,
    summary: i.excerpt ? stripHtml(i.excerpt).slice(0, 400) : null,
    published_at: i.date ? new Date(i.date).toISOString() : null,
    updated_at: i.modified ? new Date(i.modified).toISOString() : null,
    byline: null,
    tags: [i.category?.name || i.category].filter((x) => typeof x === 'string')
  })).filter((i) => i.headline && i.url);
}

export const PARSE_VERSION = 'wnba-news-parse/2.0.0';

// Official WNBA platform pages (www.wnba.com and the <team>.wnba.com sites). No RSS/Atom/WP REST exists; the post
// list is embedded as structured JSON — `__NEXT_DATA__` on www, the App Router flight payload (`self.__next_f`) on
// team sites. Post objects share one schema. They also embed the full article body (`content`, `blocksV2`): only
// the whitelisted fields below are read, so the body never leaves this function.
function flightText(html) {
  let out = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { out += JSON.parse(m[1]); } catch { /* a malformed chunk is skipped, not fatal */ }
  }
  return out;
}

function balancedObject(s, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

const utc = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

export function parseWnbaPlatform(html, { excerpts = true } = {}) {
  const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  const text = nd ? nd[1] : flightText(html);
  if (!text) throw new Error('wnba_platform_no_payload');
  const posts = new Map();
  for (const m of text.matchAll(/\{"id":(\d+),"type":"post"/g)) {
    if (posts.has(m[1])) continue;
    const raw = balancedObject(text, m.index);
    if (!raw) continue;
    let o;
    try { o = JSON.parse(raw); } catch { continue; }
    if (!o.permalink || !o.title || o.hidefromNewsFeed) continue;
    const cats = o.taxonomy?.categories && typeof o.taxonomy.categories === 'object' ? Object.values(o.taxonomy.categories) : [];
    posts.set(m[1], {
      post_id: String(o.id),
      headline: stripHtml(o.title),
      url: o.permalink,
      summary: excerpts && o.excerpt ? stripHtml(o.excerpt).slice(0, 400) || null : null,
      published_at: utc(o.date),
      updated_at: utc(o.modified),
      byline: null,
      tags: [...new Set([typeof o.category === 'string' ? o.category : o.category?.name, ...cats].filter((x) => typeof x === 'string' && x))]
    });
  }
  if (!posts.size && nd) return parseWnbaCom(html).map((i) => ({ ...i, summary: excerpts ? i.summary : null }));
  if (!posts.size) throw new Error('wnba_platform_no_posts');
  return [...posts.values()].filter((i) => i.headline && i.url);
}

/** Google News sitemap (title, link, publication date). Date-only timestamps are flagged, never treated as exact. */
export function parseNewsSitemap(xml, { maxAgeMs = 8 * 86400e3, now = Date.now() } = {}) {
  const out = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const b = m[1];
    const loc = stripHtml(tag(b, 'loc'));
    const title = stripHtml(tag(b, 'news:title'));
    const date = stripHtml(tag(b, 'news:publication_date'));
    if (!loc || !title || !date) continue;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(date);
    const t = Date.parse(dateOnly ? `${date}T00:00:00Z` : date);
    if (!Number.isFinite(t) || t < now - maxAgeMs) continue;
    out.push({ headline: title, url: loc, summary: null, published_at: new Date(t).toISOString(), updated_at: null, byline: null, tags: [], timestamp_quality: dateOnly ? 'date_only' : 'publisher' });
  }
  return out;
}

export function canonicalUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|ex_cid|xid|ref|src|cmpid|mc_cid|mc_eid)/i.test(k)) x.searchParams.delete(k);
    x.hostname = x.hostname.toLowerCase().replace(/^m\./, 'www.');
    let s = x.toString();
    if (s.endsWith('/') && x.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}
