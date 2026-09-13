// The route table: one path authority shared by the browser router and the wnba-web publishing Worker.
// No page loaders here — the router maps ids to page modules; the Worker maps ids to server views.

export const ROUTE_TABLE = [
  { id: 'today', re: /^\/$/ },
  { id: 'cast', re: /^\/cast(?:\/(\d{6,12}))?$/, keys: ['gameId'] },
  { id: 'props', re: /^\/props$/ },
  { id: 'matchups', re: /^\/matchups(?:\/(\d{6,12}))?$/, keys: ['gameId'] },
  { id: 'players', re: /^\/players$/ },
  { id: 'player', re: /^\/players\/(\d{3,12})$/, keys: ['playerId'] },
  { id: 'injuries', re: /^\/injuries$/ },
  { id: 'news', re: /^\/news$/ },
  { id: 'news-cat', re: /^\/news\/c\/([a-z]+)$/, keys: ['kind'] },
  { id: 'story', re: /^\/news\/story\/(pbe_[a-f0-9]{18})$/, keys: ['storyId'] },
  { id: 'article', re: /^\/news\/([a-z0-9-]+-[a-f0-9]{6})$/, keys: ['slug'] },
  { id: 'standings', re: /^\/standings$/ },
  { id: 'stats', re: /^\/stats$/ },
  { id: 'teams', re: /^\/teams$/ },
  { id: 'team', re: /^\/teams\/(\d{1,8})$/, keys: ['teamId'] },
  { id: 'track-record', re: /^\/track-record$/ },
  { id: 'pro', re: /^\/pro$/ },
  { id: 'sources', re: /^\/sources$/ },
  { id: 'about', re: /^\/about$/ },
  { id: 'editorial-policy', re: /^\/editorial-policy$/ },
  { id: 'corrections', re: /^\/corrections$/ },
  { id: 'methodology', re: /^\/methodology$/ }
];

/** { id, params, path } — id is 'not-found' when nothing matches. */
export function resolveRoute(pathname) {
  const path = String(pathname || '/').replace(/\/+$/, '') || '/';
  for (const r of ROUTE_TABLE) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
      (r.keys || []).forEach((k, i) => { if (m[i + 1]) params[k] = m[i + 1]; });
      return { id: r.id, params, path };
    }
  }
  return { id: 'not-found', params: {}, path };
}
