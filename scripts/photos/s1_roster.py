"""Stage 1: ESPN rosters (identity authority)."""
from common import *

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
        })
    print(t["abbreviation"], len(r["athletes"]))
save_json("cache/roster.json", {"fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                "teams": [{"id": t["id"], "abbr": t["abbreviation"], "name": t["displayName"]} for t in teams],
                                "seasons": sorted(seasons), "players": players})
print("players", len(players), "status", status_counts, "seasons", seasons)
print("missing dob:", [p["display_name"] for p in players if not p["dob"]])
ids = [p["espn_athlete_id"] for p in players]
print("dup ids:", len(ids) - len(set(ids)))
