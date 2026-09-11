"""Stage 4: Commons metadata + license classification + Commons-side identity check."""
from common import *

API = "https://commons.wikimedia.org/w/api.php"
roster = load_json("cache/roster.json")
match = load_json("cache/match.json")
pl = {p["espn_athlete_id"]: p for p in roster["players"]}

files = set()
for k, m in match.items():
    if m["status"] == "matched":
        files |= set(m["p18"])
files = sorted(files)
print("files:", len(files))

meta = load_json("cache/commons_meta.json", {})
todo = [f for f in files if f not in meta]
for i in range(0, len(todo), 20):
    batch = todo[i:i + 20]
    titles = "|".join("File:" + f for f in batch)
    url = API + "?" + urllib.parse.urlencode({"action": "query", "titles": titles, "prop": "imageinfo",
                                              "iiprop": "url|size|extmetadata|mime", "iiurlwidth": 1600,
                                              "format": "json", "formatversion": 2})
    d = http_json(url)
    norm = {n["to"]: n["from"] for n in d["query"].get("normalized", [])}
    for pg in d["query"]["pages"]:
        title = pg["title"]
        src = norm.get(title, title)
        fname = src[5:] if src.startswith("File:") else src
        if pg.get("missing") or not pg.get("imageinfo"):
            meta[fname] = {"missing": True, "title": title}
            continue
        ii = pg["imageinfo"][0]
        meta[fname] = {"title": title, "pageid": pg.get("pageid"), "ii": ii}
    # structured data (depicts P180)
    mids = {f: meta[f].get("pageid") for f in batch if meta.get(f, {}).get("pageid")}
    if mids:
        url = API + "?" + urllib.parse.urlencode({"action": "wbgetentities", "ids": "|".join("M%d" % v for v in mids.values()),
                                                  "format": "json"})
        d = http_json(url)
        for f, pid in mids.items():
            e = d.get("entities", {}).get("M%d" % pid, {})
            st = e.get("statements") or {}
            if isinstance(st, list):
                st = {}
            dep = []
            for c in st.get("P180", []):
                dv = c.get("mainsnak", {}).get("datavalue")
                if dv:
                    dep.append(dv["value"]["id"])
            meta[f]["depicts"] = dep
    save_json("cache/commons_meta.json", meta)
    print(i + len(batch), "/", len(todo))


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


out = {}
for f in files:
    m = meta[f]
    if m.get("missing"):
        out[f] = {"license_ok": False, "license_reason": "file missing on Commons"}
        continue
    ii = m["ii"]
    fam, why = classify(ii)
    dto = strip_html(em(ii, "DateTimeOriginal")) or strip_html(em(ii, "DateTime"))
    yrs = re.findall(r"\b(19\d\d|20\d\d)\b", dto or "")
    desc = strip_html(em(ii, "ImageDescription"))
    out[f] = {
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
        "depicts": m.get("depicts", []), "title": m["title"],
    }
save_json("cache/commons.json", out)
from collections import Counter
print(Counter((v.get("license_family") or v.get("license_reason")) for v in out.values()))
print(Counter(v.get("license_short") for v in out.values()))
