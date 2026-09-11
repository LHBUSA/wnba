import json
import os
import re
import time
import unicodedata
import urllib.parse
import urllib.request
import urllib.error

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(BASE, "cache")
os.makedirs(CACHE, exist_ok=True)

WM_UA = "PropBetEdgeWNBA/1.0 (sales@localhomebuyersusa.com) photo-manifest"
ESPN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PropBetEdgeWNBA/1.0"

_last = [0.0]


def throttle(min_interval=0.25):
    dt = time.time() - _last[0]
    if dt < min_interval:
        time.sleep(min_interval - dt)
    _last[0] = time.time()


def http_get(url, ua=WM_UA, accept=None, retries=4, binary=False, timeout=60):
    headers = {"User-Agent": ua}
    if accept:
        headers["Accept"] = accept
    err = None
    for i in range(retries):
        throttle()
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = r.read()
                return data if binary else data.decode("utf-8")
        except urllib.error.HTTPError as e:
            err = e
            if e.code in (429, 503, 502, 500):
                ra = e.headers.get("Retry-After")
                wait = int(ra) if ra and ra.isdigit() else 5 * (i + 1)
                time.sleep(min(wait, 60))
                continue
            raise
        except Exception as e:  # network
            err = e
            time.sleep(3 * (i + 1))
    raise err


def http_json(url, **kw):
    return json.loads(http_get(url, **kw))


def load_json(name, default=None):
    p = os.path.join(BASE, name)
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(name, obj):
    p = os.path.join(BASE, name)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
    os.replace(tmp, p)


def norm_name(s):
    """casefold, strip diacritics, remove punctuation, collapse whitespace.
    Suffixes like 'Jr.' are kept literally (only the dot is removed as punctuation)."""
    if s is None:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.casefold()
    # punctuation -> removed (apostrophes, periods, hyphens become nothing / space)
    s = s.replace("-", " ")
    s = re.sub(r"[^\w\s]", "", s)
    s = s.replace("_", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def norm_hay(s):
    """Like norm_name but every non-alphanumeric run becomes a space (for searching names in titles/descriptions)."""
    if not s:
        return " "
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).casefold()
    s = re.sub(r"[^0-9a-z]+", " ", s)
    return " " + s.strip() + " "


def strip_html(s):
    if s is None:
        return None
    s = re.sub(r"<[^>]+>", " ", s)
    import html
    s = html.unescape(s)
    s = re.sub(r"\s+", " ", s).strip()
    return s
