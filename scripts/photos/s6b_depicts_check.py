"""Identity safety: for every chosen file, list Commons 'depicts' (P180) humans other than the matched player."""
from common import *

crops = load_json("cache/crops.json")
commons = load_json("cache/commons.json")
match = load_json("cache/match.json")
API = "https://www.wikidata.org/w/api.php"
others = {}
for pid, r in crops.items():
    if not r.get("file"):
        continue
    q = match[pid]["qid"]
    dep = [d for d in commons[r["file"]].get("depicts") or [] if d != q]
    if dep:
        others[pid] = dep
allq = sorted({d for v in others.values() for d in v})
info = {}
for i in range(0, len(allq), 50):
    d = http_json(API + "?" + urllib.parse.urlencode({"action": "wbgetentities", "ids": "|".join(allq[i:i + 50]),
                                                       "props": "claims|labels", "languages": "en", "format": "json"}))
    for qid, e in d.get("entities", {}).items():
        p31 = [c["mainsnak"]["datavalue"]["value"]["id"] for c in e.get("claims", {}).get("P31", []) if c["mainsnak"].get("datavalue")]
        info[qid] = {"human": "Q5" in p31, "label": e.get("labels", {}).get("en", {}).get("value")}
out = {}
for pid, dep in others.items():
    hum = [f"{d} {info.get(d, {}).get('label')}" for d in dep if info.get(d, {}).get("human")]
    if hum:
        out[pid] = hum
        print(pid, crops[pid]["file"], "->", hum)
save_json("cache/depicts_other_humans.json", out)
print("files depicting other humans:", len(out))
