"""Stage 2: Wikidata bulk (P3588) + per-player wbsearchentities, then full entity fetch
for every candidate whose normalized English label/alias equals the ESPN name."""
from common import *

SPARQL = "https://query.wikidata.org/sparql"
API = "https://www.wikidata.org/w/api.php"
EN_LANGS = ["en", "mul", "en-us", "en-gb", "en-ca"]  # 'mul' = Wikidata default label, applies to English

roster = load_json("cache/roster.json")
players = roster["players"]


def sparql(q):
    url = SPARQL + "?" + urllib.parse.urlencode({"query": q, "format": "json"})
    return http_json(url, accept="application/sparql-results+json")["results"]["bindings"]


# ---- bulk: all items with a WNBA.com player ID ----
bulk = load_json("cache/wd_bulk.json")
if bulk is None:
    q_labels = """
    SELECT ?item ?wnba ?lab ?lang WHERE {
      ?item wdt:P3588 ?wnba .
      OPTIONAL { ?item rdfs:label ?lab . BIND(LANG(?lab) AS ?lang)
                 FILTER(LANG(?lab) IN ("en","mul","en-us","en-gb","en-ca")) }
    }"""
    q_alias = """
    SELECT ?item ?alias WHERE {
      ?item wdt:P3588 ?wnba .
      ?item skos:altLabel ?alias . FILTER(LANG(?alias) IN ("en","mul","en-us","en-gb","en-ca"))
    }"""
    rows_l = sparql(q_labels)
    rows_a = sparql(q_alias)
    items = {}
    for r in rows_l:
        qid = r["item"]["value"].rsplit("/", 1)[1]
        it = items.setdefault(qid, {"wnba": set(), "names": set()})
        it["wnba"].add(r["wnba"]["value"])
        if "lab" in r:
            it["names"].add(r["lab"]["value"])
    for r in rows_a:
        qid = r["item"]["value"].rsplit("/", 1)[1]
        it = items.setdefault(qid, {"wnba": set(), "names": set()})
        it["names"].add(r["alias"]["value"])
    bulk = {k: {"wnba": sorted(v["wnba"]), "names": sorted(v["names"])} for k, v in items.items()}
    save_json("cache/wd_bulk.json", bulk)
print("bulk items with P3588:", len(bulk))

name_index = {}
for qid, it in bulk.items():
    for n in it["names"]:
        name_index.setdefault(norm_name(n), set()).add(qid)

# ---- per-player search (run for ALL players, so uniqueness is checked beyond the P3588 set) ----
search = load_json("cache/wd_search.json", {})
for p in players:
    key = p["espn_athlete_id"]
    if key in search:
        continue
    res = []
    for term in {p["display_name"], p["full_name"]}:
        if not term:
            continue
        url = API + "?" + urllib.parse.urlencode({"action": "wbsearchentities", "search": term, "language": "en",
                                                  "uselang": "en", "type": "item", "limit": 20, "format": "json"})
        d = http_json(url)
        res += [s["id"] for s in d.get("search", [])]
    search[key] = sorted(set(res))
    save_json("cache/wd_search.json", search)
print("searched", len(search))

# ---- candidate set: bulk name hits + search hits ----
cands = set()
for p in players:
    for nm in {p["display_name"], p["full_name"]}:
        cands |= name_index.get(norm_name(nm), set())
    cands |= set(search.get(p["espn_athlete_id"], []))
print("candidate qids:", len(cands))

ents = load_json("cache/wd_entities.json", {})
todo = sorted(c for c in cands if c not in ents)
for i in range(0, len(todo), 50):
    batch = todo[i:i + 50]
    url = API + "?" + urllib.parse.urlencode({"action": "wbgetentities", "ids": "|".join(batch),
                                              "props": "labels|aliases|claims|sitelinks", "format": "json"})
    d = http_json(url)
    for qid, e in d.get("entities", {}).items():
        if "missing" in e:
            continue
        cl = e.get("claims", {})

        def vals(pid, kind="id"):
            out = []
            for c in cl.get(pid, []):
                if c.get("rank") == "deprecated":
                    continue
                dv = c.get("mainsnak", {}).get("datavalue")
                if not dv:
                    continue
                v = dv["value"]
                if kind == "id":
                    out.append(v["id"])
                elif kind == "str":
                    out.append(v)
                elif kind == "time":
                    out.append({"time": v["time"], "precision": v["precision"], "rank": c.get("rank")})
            return out

        names = set()
        for lg in EN_LANGS:
            if lg in e.get("labels", {}):
                names.add(e["labels"][lg]["value"])
            for a in e.get("aliases", {}).get(lg, []):
                names.add(a["value"])
        ents[qid] = {
            "label_en": (e.get("labels", {}).get("en") or e.get("labels", {}).get("mul") or {}).get("value"),
            "names": sorted(names),
            "P31": vals("P31"), "P106": vals("P106"), "P641": vals("P641"),
            "P3588": vals("P3588", "str"), "P569": vals("P569", "time"),
            "P18": vals("P18", "str"), "enwiki": e.get("sitelinks", {}).get("enwiki", {}).get("title"),
        }
    save_json("cache/wd_entities.json", ents)
print("entities:", len(ents))
