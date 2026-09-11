"""Stage 4b: Commons categories for every candidate file (secondary identity evidence only)."""
from common import *

API = "https://commons.wikimedia.org/w/api.php"
commons = load_json("cache/commons.json")
cats = load_json("cache/commons_cats.json", {})
files = [f for f in commons if f not in cats]
for i in range(0, len(files), 20):
    batch = files[i:i + 20]
    url = API + "?" + urllib.parse.urlencode({"action": "query", "titles": "|".join("File:" + f for f in batch),
                                              "prop": "categories", "cllimit": "max", "clshow": "!hidden",
                                              "format": "json", "formatversion": 2})
    d = http_json(url)
    norm = {n["to"]: n["from"] for n in d["query"].get("normalized", [])}
    for pg in d["query"]["pages"]:
        src = norm.get(pg["title"], pg["title"])
        cats[src[5:]] = [c["title"][9:] for c in pg.get("categories", [])]
    save_json("cache/commons_cats.json", cats)
print(len(cats))
