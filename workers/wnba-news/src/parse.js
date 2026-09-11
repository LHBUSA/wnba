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
