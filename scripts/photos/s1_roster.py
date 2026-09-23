"""Stage 1: ESPN rosters (identity authority).

Also records each athlete's ESPN headshot URLs and writes data/player-headshots.json,
the hotlink map the wnba-api photo providers read (workers/wnba-api/src/photos.js).
Headshots are external_editorial: URLs only, never downloaded or mirrored.
A WNBA.com player id is attached only from a reviewed data/wnba-player-ids.json
({"<espn id>": "<wnba id>"}); nothing here guesses one.
"""
from common import *

ESPN_HEADSHOT_FULL = "https://a.espncdn.com/i/headshots/wnba/players/full/{id}.png"
ESPN_HEADSHOT_SQUARE = "https://a.espncdn.com/combiner/i?img=/i/headshots/wnba/players/full/{id}.png&w=350&h=254"
REPO = os.path.dirname(BASE)  # BASE is scripts/
HEADSHOTS_OUT = os.path.join(REPO, "data", "player-headshots.json")
WNBA_ID_MAP = os.path.join(REPO, "data", "wnba-player-ids.json")
wnba_ids = {}
if os.path.exists(WNBA_ID_MAP):
    with open(WNBA_ID_MAP, encoding="utf-8") as f:
        wnba_ids = {str(k): str(v) for k, v in json.load(f).items() if v}

TEAMS_URL = "https://site.web.api.espn.com/apis/site/v2/sports/basketball/wnba/teams"
ROSTER_URL = "https://site.web.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/{tid}/roster"

d = http_json(TEAMS_URL, ua=ESPN_UA)
teams = [t["team"] for t in d["sports"][0]["leagues"][0]["teams"]]
print("teams:", len(teams))
players = []
status_counts = {}
seasons = set()
for t in teams:
    r = http_json(ROSTER_URL.format(tid=t["id"]), ua=ESPN_UA)
    seasons.add(json.dumps(r.get("season")))
    for a in r["athletes"]:
        st = (a.get("status") or {}).get("type")
        status_counts[st] = status_counts.get(st, 0) + 1
        dob = a.get("dateOfBirth")
        # ESPN only lists a headshot object when one exists; no object -> no hotlink (avoids a guaranteed 404).
        has_headshot = bool((a.get("headshot") or {}).get("href"))
        players.append({
            "espn_athlete_id": a["id"],
            "display_name": a.get("displayName"),
            "full_name": a.get("fullName"),
            "first_name": a.get("firstName"),
            "last_name": a.get("lastName"),
            "team_id": t["id"],
            "team_abbr": t["abbreviation"],
            "dob_raw": dob,
            "dob": dob[:10] if dob else None,
            "position": (a.get("position") or {}).get("abbreviation"),
            "jersey": a.get("jersey"),
            "espn_status": st,
            "injuries": [i.get("status") for i in (a.get("injuries") or [])],
            "espn_headshot_full": ESPN_HEADSHOT_FULL.format(id=a["id"]) if has_headshot else None,
            "espn_headshot_square": ESPN_HEADSHOT_SQUARE.format(id=a["id"]) if has_headshot else None,
            "wnba_player_id": wnba_ids.get(str(a["id"])),
        })
    print(t["abbreviation"], len(r["athletes"]))
save_json("cache/roster.json", {"fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                "teams": [{"id": t["id"], "abbr": t["abbreviation"], "name": t["displayName"]} for t in teams],
                                "seasons": sorted(seasons), "players": players})
fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
hs = {}
for p in sorted(players, key=lambda p: int(p["espn_athlete_id"])):
    if p["espn_headshot_full"] or p["wnba_player_id"]:
        hs[str(p["espn_athlete_id"])] = {
            "name": p["display_name"],
            "espn_headshot_full": p["espn_headshot_full"],
            "espn_headshot_square": p["espn_headshot_square"],
            "wnba_player_id": p["wnba_player_id"],
        }
with open(HEADSHOTS_OUT, "w", encoding="utf-8", newline="\n") as f:
    json.dump({"generated_at": fetched_at, "source": "ESPN WNBA team rosters (s1_roster.py)",
               "rights": "external_editorial", "mirrored": False,
               "note": "Hotlink URLs only. Commons approved photos (player-photos.json) remain the licensed fallback.",
               "players": hs}, f, indent=1, ensure_ascii=False)
    f.write("\n")
print("headshots:", sum(1 for v in hs.values() if v["espn_headshot_full"]), "espn,",
      sum(1 for v in hs.values() if v["wnba_player_id"]), "wnba ->", HEADSHOTS_OUT)
print("players", len(players), "status", status_counts, "seasons", seasons)
print("missing dob:", [p["display_name"] for p in players if not p["dob"]])
ids = [p["espn_athlete_id"] for p in players]
print("dup ids:", len(ids) - len(set(ids)))
