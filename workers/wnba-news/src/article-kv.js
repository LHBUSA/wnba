// Storage boundary for WNBA newsroom article bodies.
//
// Older generators passed a 120-day expiration on art:v1:item:* writes. Curation
// state can change; published article bodies cannot. This proxy strips expiry
// options only for article-body keys while leaving every other NEWS_KV write
// (leases, source snapshots, temporary telemetry, etc.) untouched.

const ARTICLE_PREFIX = 'art:v1:item:';

export function permanentArticleKv(kv) {
  if (!kv) return kv;
  return new Proxy(kv, {
    get(target, prop) {
      if (prop === 'put') {
        return async (key, value, options) => {
          if (String(key).startsWith(ARTICLE_PREFIX)) return target.put(key, value);
          return target.put(key, value, options);
        };
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

export function permanentArticleEnv(env) {
  if (!env?.NEWS_KV) return env;
  const durableKv = permanentArticleKv(env.NEWS_KV);
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'NEWS_KV') return durableKv;
      return target[prop];
    }
  });
}
