"""Shared Commons metadata helpers (license classification + record builder)."""
from common import *

API = "https://commons.wikimedia.org/w/api.php"


def em(ii, k):
    v = (ii.get("extmetadata") or {}).get(k)
    return v.get("value") if v else None


def classify(ii):
    lic = (em(ii, "License") or "").strip().lower()
    short = strip_html(em(ii, "LicenseShortName") or "") or ""
    nonfree = str(em(ii, "NonFree") or "").lower() in ("true", "1", "yes")
    s = (lic + " " + short.lower())
    toks = set(re.split(r"[\s\-_/.,()]+", s))
    if nonfree or "fair use" in s or "non-free" in s:
        return None, "non-free / fair use"
    if "nc" in toks or "noncommercial" in s or "non-commercial" in s:
        return None, "NC license"
    if "nd" in toks or "noderivs" in s or "no derivatives" in s or "noderivatives" in s:
        return None, "ND license"
    if lic.startswith("cc0") or short.lower().startswith("cc0") or "cc-zero" in s:
        return "CC0", None
    if lic.startswith("pd") or "public domain" in s:
        return "Public domain", None
    if lic.startswith("cc-by-sa") or short.lower().startswith("cc by-sa"):
        return "CC BY-SA", None
    if lic.startswith("cc-by") or short.lower().startswith("cc by"):
        return "CC BY", None
    if not lic and not short:
        return None, "no license metadata"
    return None, f"license not in allowlist ({short or lic})"


def build_record(ii, title, depicts):
    fam, why = classify(ii)
    dto = strip_html(em(ii, "DateTimeOriginal")) or strip_html(em(ii, "DateTime"))
    yrs = re.findall(r"\b(19\d\d|20\d\d)\b", dto or "")
    desc = strip_html(em(ii, "ImageDescription"))
    return {
        "license_ok": fam is not None, "license_family": fam, "license_reason": why,
        "license_short": strip_html(em(ii, "LicenseShortName")), "license_code": em(ii, "License"),
        "license_url": em(ii, "LicenseUrl"), "artist": strip_html(em(ii, "Artist")),
        "credit": strip_html(em(ii, "Credit")), "capture_date": dto,
        "capture_year": int(yrs[0]) if yrs else None,
        "description": (desc[:300] if desc else None), "description_full": desc,
        "restrictions": em(ii, "Restrictions"), "attribution_required": em(ii, "AttributionRequired"),
        "usage_terms": strip_html(em(ii, "UsageTerms")),
        "source_page_url": ii.get("descriptionurl"), "original_url": ii.get("url"),
        "thumb_url": ii.get("thumburl"), "thumb_w": ii.get("thumbwidth"), "thumb_h": ii.get("thumbheight"),
        "width": ii.get("width"), "height": ii.get("height"), "mime": ii.get("mime"),
        "depicts": depicts, "title": title,
    }


def fetch_records(fnames):
    """imageinfo + depicts for a list of file names (without 'File:')."""
    out = {}
    for i in range(0, len(fnames), 20):
        batch = fnames[i:i + 20]
        url = API + "?" + urllib.parse.urlencode({"action": "query", "titles": "|".join("File:" + f for f in batch),
                                                  "prop": "imageinfo", "iiprop": "url|size|extmetadata|mime",
                                                  "iiurlwidth": 1600, "format": "json", "formatversion": 2})
        d = http_json(url)
        norm = {n["to"]: n["from"] for n in d["query"].get("normalized", [])}
        pages = {}
        for pg in d["query"]["pages"]:
            src = norm.get(pg["title"], pg["title"])[5:]
            if pg.get("missing") or not pg.get("imageinfo"):
                out[src] = None
                continue
            pages[src] = pg
        if pages:
            url = API + "?" + urllib.parse.urlencode({"action": "wbgetentities", "format": "json",
                                                      "ids": "|".join("M%d" % p["pageid"] for p in pages.values())})
            ents = http_json(url).get("entities", {})
        for src, pg in pages.items():
            e = ents.get("M%d" % pg["pageid"], {})
            st = e.get("statements") or {}
            if isinstance(st, list):
                st = {}
            dep = [c["mainsnak"]["datavalue"]["value"]["id"] for c in st.get("P180", []) if c.get("mainsnak", {}).get("datavalue")]
            out[src] = build_record(pg["imageinfo"][0], pg["title"], dep)
    return out


def wikitext(fname):
    url = API + "?" + urllib.parse.urlencode({"action": "query", "titles": "File:" + fname, "prop": "revisions",
                                              "rvprop": "content", "rvslots": "main", "format": "json", "formatversion": 2})
    d = http_json(url)
    pg = d["query"]["pages"][0]
    if pg.get("missing"):
        return None
    return pg["revisions"][0]["slots"]["main"]["content"]
