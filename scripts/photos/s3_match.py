"""Stage 3: deterministic identity match ESPN athlete -> Wikidata item."""
from common import *

Q_HUMAN = "Q5"
Q_BASKETBALL = "Q5372"
Q_BB_PLAYER = "Q3665646"

roster = load_json("cache/roster.json")
ents = load_json("cache/wd_entities.json")


def best_dobs(p569):
    """Day-precision dates of the best rank (preferred if any, else normal)."""
    pref = [v for v in p569 if v["rank"] == "preferred"]
    use = pref if pref else [v for v in p569 if v["rank"] == "normal"]
    days = sorted({v["time"].lstrip("+")[:10] for v in use if v["precision"] >= 11})
    coarse = [v for v in use if v["precision"] < 11]
    return days, coarse


def qualifies(e):
    if Q_HUMAN not in e["P31"]:
        return False
    return bool(e["P3588"]) or Q_BASKETBALL in e["P641"] or Q_BB_PLAYER in e["P106"]


name_idx = {}
for qid, e in ents.items():
    for n in e["names"]:
        name_idx.setdefault(norm_name(n), set()).add(qid)

results = {}
stats = {}
for p in roster["players"]:
    keys = {norm_name(p["display_name"]), norm_name(p["full_name"])} - {""}
    name_hits = set()
    for k in keys:
        name_hits |= name_idx.get(k, set())
    qual = sorted(q for q in name_hits if qualifies(ents[q]))
    nonqual = sorted(q for q in name_hits if not qualifies(ents[q]))
    matches, notes = [], []
    for q in qual:
        days, coarse = best_dobs(ents[q]["P569"])
        if not days:
            notes.append(f"{q}: no day-precision P569" + (" (coarse only)" if coarse else ""))
            continue
        if len(days) > 1:
            notes.append(f"{q}: conflicting P569 {days}")
            if p["dob"] in days:
                notes.append(f"{q}: ESPN dob among conflicting values -> not accepted")
            continue
        if p["dob"] and days[0] == p["dob"]:
            matches.append(q)
        else:
            notes.append(f"{q}: P569 {days[0]} != ESPN {p['dob']}")
    r = {"name_hits": sorted(name_hits), "qualifying": qual, "nonqualifying": nonqual, "notes": notes}
    if not p["dob"]:
        r.update(status="no_identity_match", reason="ESPN dateOfBirth missing")
    elif len(matches) == 1:
        e = ents[matches[0]]
        r.update(status="matched", qid=matches[0], wnba_com_id=(e["P3588"][0] if e["P3588"] else None),
                 p18=e["P18"], reason="name+dob exact match")
    elif len(matches) > 1:
        r.update(status="no_identity_match", reason=f"ambiguous: {len(matches)} Wikidata items match name+dob: {matches}")
    elif not name_hits:
        r.update(status="no_identity_match", reason="no Wikidata item with exact normalized English label/alias")
    elif not qual:
        r.update(status="no_identity_match", reason=f"name matches only non-basketball/non-human items {nonqual}")
    else:
        r.update(status="no_identity_match", reason="name match but DOB not exact: " + "; ".join(notes))
    results[p["espn_athlete_id"]] = r
    stats[r["status"]] = stats.get(r["status"], 0) + 1

save_json("cache/match.json", results)
print(stats)
m = [k for k, v in results.items() if v["status"] == "matched"]
print("matched with P18:", sum(1 for k in m if results[k]["p18"]), "multiple P18:", sum(1 for k in m if len(results[k]["p18"]) > 1))
pl = {p["espn_athlete_id"]: p for p in roster["players"]}
for k, v in results.items():
    if v["status"] != "matched":
        print(k, pl[k]["display_name"], pl[k]["team_abbr"], pl[k]["dob"], "|", v["reason"][:160])
