#!/usr/bin/env python3
"""Turn extracted game-note artifacts into validated, canonical-ready player box-score rows.

    python scripts/wbh/notes_assemble.py --artifact chi.json --artifact atl.json \
        --ref ref.json --out assembled.json --receipt assemble-receipt.md [--sql out.sql]

Second half of the pipeline. The extractor knows about PDFs and geometry; this step knows about
canonical identity and refuses anything it cannot resolve deterministically:

  * a player is resolved only within the roster of the team whose notes we are reading, so a name
    match always carries team and season context. An unmatched or ambiguous name is held for review;
    no person is ever created here, and two people are never merged on a name.
  * a game is resolved only when exactly one canonical 2024 game has that date and that pair of
    clubs. Zero or several matches means held, never a new game.
  * a team-game is emitted only when every one of its rows parsed cleanly, the players' points sum
    to the canonical team score, and the minutes total is consistent with regulation plus the
    overtime the canonical game records.

Any failure holds the whole team-game. There is no best-guess mode.
"""
from __future__ import annotations

import argparse, collections, json, re, unicodedata
from pathlib import Path

TRANSFORMATION_VERSION = "wbh_notes_boxscore_v1"

# Team codes as the notes print them. Unknown codes fail closed rather than being guessed at.
TEAM_CODES = {
    "ATL": "Atlanta Dream", "CHI": "Chicago Sky", "CON": "Connecticut Sun", "CONN": "Connecticut Sun",
    "DAL": "Dallas Wings", "IND": "Indiana Fever", "LV": "Las Vegas Aces", "LVA": "Las Vegas Aces",
    "LAS": "Los Angeles Sparks", "LA": "Los Angeles Sparks", "MIN": "Minnesota Lynx",
    "NY": "New York Liberty", "NYL": "New York Liberty", "PHX": "Phoenix Mercury",
    "PHO": "Phoenix Mercury", "SEA": "Seattle Storm", "WAS": "Washington Mystics",
    "WSH": "Washington Mystics",
}

SECONDS_PER_REGULATION = 200 * 60      # five players x forty minutes
SECONDS_PER_OVERTIME = 25 * 60         # five players x five minutes
MINUTE_TOLERANCE_SECONDS = 120         # published minute columns round; two player-minutes of slack

STAT_FIELDS = [
    "seconds_played", "field_goals_made", "field_goals_attempted", "three_pointers_made",
    "three_pointers_attempted", "free_throws_made", "free_throws_attempted", "offensive_rebounds",
    "defensive_rebounds", "rebounds", "assists", "steals", "blocks", "turnovers",
    "personal_fouls", "points", "plus_minus",
]


def normalize_name(name: str) -> str:
    """Casefold, strip accents and punctuation. For candidate lookup only, never for merging."""
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace("’", "'")
    s = re.sub(r"[^a-z ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def load_ref(path: Path):
    raw = json.loads(path.read_text(encoding="utf-8"))
    ref = raw[0]["ref"] if isinstance(raw, list) else raw["ref"] if "ref" in raw else raw
    if isinstance(ref, str):
        ref = json.loads(ref)
    teams = {t["name"]: t["id"] for t in ref["team_editions"]}
    games = ref["games"]
    roster = collections.defaultdict(list)
    for r in ref["roster"]:
        roster[r["team_edition_id"]].append(r)
    persons = ref.get("persons") or []
    by_name = collections.defaultdict(list)
    for p in persons:
        by_name[normalize_name(p["name"])].append(p)
    return teams, games, roster, by_name


def resolve_person(name, team_edition_id, roster, persons_by_name=None, allow_league_unique=False):
    """Resolve within this club's 2024 roster only. Returns (person_id, tier, note, reason).

    Two tiers are accepted, both scoped to a twelve-player roster so that a name always carries team
    and season context:
      roster_exact         the normalized names are identical
      roster_name_variant  the given name matches and the surnames share a component, and exactly
                           one roster member qualifies. This is the married-name case (for example
                           "Cheyenne Parker" appearing later as "Cheyenne Parker-Tyus"). It is
                           reported explicitly as an alias to confirm, never applied silently.
    Anything else is held. No person is created and no two people are merged here.
    """
    target = normalize_name(name)
    members = roster.get(team_edition_id, [])
    hits = [r for r in members if normalize_name(r["name"]) == target]
    if len(hits) == 1:
        return hits[0]["person_id"], "roster_exact", None, None
    if len(hits) > 1:
        return None, None, None, f"'{name}' matches {len(hits)} roster entries; ambiguous"

    parts = target.split(" ")
    given, surnames = parts[0], set(parts[1:])
    variants = []
    for r in members:
        rp = normalize_name(r["name"]).split(" ")
        if rp[0] == given and surnames & set(rp[1:]):
            variants.append(r)
    if len(variants) == 1:
        return (variants[0]["person_id"], "roster_name_variant",
                f"'{name}' resolved to roster member '{variants[0]['name']}' "
                f"(same given name, shared surname component, unique within the roster)", None)
    if len(variants) > 1:
        return None, None, None, f"'{name}' matches {len(variants)} roster members by name variant; ambiguous"

    # Third tier, off by default. The club's own official season document lists this player, and
    # exactly one canonical person in the whole database carries that name. Rosters in the database
    # hold only twelve players per club, so mid-season signings legitimately fall outside them.
    # Every resolution at this tier is reported and counted separately; none of it is silent.
    if allow_league_unique and persons_by_name is not None:
        candidates = persons_by_name.get(target, [])
        if len(candidates) == 1:
            return (candidates[0]["person_id"], "league_unique_in_club_document",
                    f"'{name}' is not in this club's twelve-player roster evidence but is the only "
                    f"person of that name in the database, and the club's own notes list her",
                    None)
        if len(candidates) > 1:
            return None, None, None, f"'{name}' matches {len(candidates)} canonical people; ambiguous"
    return None, None, None, f"'{name}' has no match in the 2024 roster of this club"


def resolve_game(date, team_edition_id, opponent_code, home_away, teams, games):
    if opponent_code not in TEAM_CODES:
        return None, f"unknown opponent code {opponent_code!r}"
    opp_name = TEAM_CODES[opponent_code]
    opp_id = teams.get(opp_name)
    if not opp_id:
        return None, f"opponent {opp_name!r} is not a 2024 club"
    hits = [g for g in games
            if g["date"] == date and {g["home"], g["away"]} == {team_edition_id, opp_id}]
    if len(hits) != 1:
        return None, f"{len(hits)} canonical games match {date} {team_edition_id} vs {opp_id}"
    # Identity comes from the date and the pair of clubs, which is already unique. Home/away is a
    # cross-check, aggregated per team-game below: a single stray row is a misprint (these documents
    # contain a few), while every row disagreeing means the canonical game is wrong.
    g = hits[0]
    return g, None


def assemble(artifacts, teams, games, roster, persons_by_name=None, allow_league_unique=False):
    out = {"transformation_version": TRANSFORMATION_VERSION, "sources": [], "team_games": [],
           "held": [], "alias_candidates": {}}
    by_game = collections.defaultdict(lambda: {"rows": [], "holds": []})

    for art in artifacts:
        team_edition_id = teams.get(art["team"])
        if not team_edition_id:
            out["held"].append({"scope": "artifact", "team": art["team"], "reason": "team is not a 2024 club"})
            continue
        out["sources"].append({
            "team": art["team"], "team_edition_id": team_edition_id, "layout": art["layout"],
            "layout_family": art["layout_family"], "source_url": art["source_url"],
            "source_sha256": art["source_sha256"], "pages": art["pages_with_tables"],
        })
        for player in art["players"]:
            for row in player["rows"]:
                if row["status"] == "nonparticipation":
                    continue
                game, why = resolve_game(row["date"], team_edition_id, row["opponent_code"],
                                         row["home_away"], teams, games)
                key = (game["game_id"], team_edition_id) if game else ("unmatched", team_edition_id)
                if not game:
                    by_game[key]["holds"].append({"player": player["name"], "date": row["date"], "reason": why})
                    continue
                if row["status"] == "hold":
                    by_game[key]["holds"].append({"player": player["name"], "date": row["date"],
                                                  "reason": "; ".join(row["hold_reasons"])})
                    continue
                person_id, tier, note, why = resolve_person(
                    player["name"], team_edition_id, roster, persons_by_name, allow_league_unique)
                if not person_id:
                    by_game[key]["holds"].append({"player": player["name"], "date": row["date"], "reason": why})
                    continue
                if note:
                    out["alias_candidates"][f"{team_edition_id}|{player['name']}"] = {
                        "team_edition_id": team_edition_id, "source_name": player["name"],
                        "person_id": person_id, "tier": tier, "note": note}
                canonical_home = (game["home"] == team_edition_id)
                orientation_conflict = (row["home_away"] is not None
                                        and (row["home_away"] == "home") != canonical_home)
                rec = {"person_id": person_id, "identity_tier": tier, "player_name": player["name"],
                       "orientation_conflict": orientation_conflict,
                       "source_page": player["page"], "raw_text": row["raw_text"],
                       "did_not_play": bool(row.get("did_not_play")),
                       "started": row.get("started")}
                for f in STAT_FIELDS:
                    rec[f] = row.get(f)
                if rec["did_not_play"]:
                    for f in STAT_FIELDS:
                        rec[f] = None
                # several documents from the same club can cover the same game; identical rows are
                # corroboration, a disagreement is a conflict and holds the team-game
                prior = next((x for x in by_game[key]["rows"] if x["person_id"] == person_id), None)
                if prior is not None:
                    differing = [f for f in STAT_FIELDS
                                 if prior.get(f) is not None and rec.get(f) is not None
                                 and prior.get(f) != rec.get(f)]
                    if differing:
                        by_game[key]["holds"].append({
                            "player": player["name"], "date": row["date"],
                            "reason": f"two source documents disagree on {', '.join(differing)}"})
                    else:
                        for f in STAT_FIELDS:      # fill gaps one document left blank
                            if prior.get(f) is None and rec.get(f) is not None:
                                prior[f] = rec[f]
                        prior.setdefault("corroborating_sources", 1)
                        prior["corroborating_sources"] += 1
                    continue
                by_game[key]["rows"].append(rec)
                by_game[key]["game"] = game
                by_game[key]["source_sha256"] = art["source_sha256"]
                by_game[key]["source_url"] = art["source_url"]
                by_game[key]["layout"] = art["layout"]

    for (game_id, team_edition_id), block in sorted(by_game.items()):
        if game_id == "unmatched" or "game" not in block:
            out["held"].append({"scope": "unmatched", "team_edition_id": team_edition_id,
                                "holds": block["holds"]})
            continue
        game = block["game"]
        side = "home" if game["home"] == team_edition_id else "away"
        canonical_points = game["home_points"] if side == "home" else game["away_points"]
        played = [r for r in block["rows"] if not r["did_not_play"]]
        problems = list(block["holds"])

        # orientation cross-check: unanimous disagreement means the canonical game is inverted
        conflicts = [r for r in block["rows"] if r.get("orientation_conflict")]
        if conflicts and len(conflicts) == len(block["rows"]):
            problems.append({"reason": f"every row says this club was {'home' if side == 'away' else 'away'}; "
                                       f"canonical game has it {side}. Canonical orientation is in dispute."})
        elif conflicts:
            entry_notes = f"{len(conflicts)} of {len(block['rows'])} rows misprint the venue; majority follows canonical"
        else:
            entry_notes = None

        pts = [r["points"] for r in played]
        if any(p is None for p in pts):
            problems.append({"reason": "a participating player has no points value"})
        elif canonical_points is None:
            problems.append({"reason": "canonical game has no score to reconcile against"})
        elif sum(pts) != canonical_points:
            problems.append({"reason": f"player points sum {sum(pts)} != canonical team score {canonical_points}"})

        secs = [r["seconds_played"] for r in played]
        if any(s is None for s in secs):
            problems.append({"reason": "a participating player has no minutes"})
        else:
            expected = SECONDS_PER_REGULATION + SECONDS_PER_OVERTIME * int(game.get("ot") or 0)
            if abs(sum(secs) - expected) > MINUTE_TOLERANCE_SECONDS:
                problems.append({"reason": f"minutes total {sum(secs)/60:.1f} vs expected {expected/60:.1f} "
                                           f"(canonical overtime periods: {game.get('ot')})"})

        entry = {
            "game_id": game_id, "date": game["date"], "team_edition_id": team_edition_id, "side": side,
            "canonical_points": canonical_points, "layout": block.get("layout"),
            "source_url": block.get("source_url"), "source_sha256": block.get("source_sha256"),
            "players": len(block["rows"]), "participants": len(played),
            "points_sum": None if any(p is None for p in pts) else sum(pts),
            "minutes_sum": None if any(s is None for s in secs) else round(sum(secs) / 60, 1),
            "rows": block["rows"], "problems": problems, "notes": entry_notes,
            "status": "ok" if not problems else "held",
        }
        (out["team_games"] if not problems else out["held"]).append(entry)

    ok_games = {e["game_id"] for e in out["team_games"]}
    sides = collections.Counter(e["game_id"] for e in out["team_games"])
    out["summary"] = {
        "team_games_ok": len(out["team_games"]),
        "team_games_held": len([h for h in out["held"] if h.get("scope") != "unmatched"]),
        "games_with_one_side": len([g for g in ok_games if sides[g] == 1]),
        "games_with_both_sides": len([g for g in ok_games if sides[g] == 2]),
        "player_rows_ok": sum(len(e["rows"]) for e in out["team_games"]),
        "distinct_persons": len({r["person_id"] for e in out["team_games"] for r in e["rows"]}),
        "alias_candidates": len(out["alias_candidates"]),
        "identity_tiers": dict(collections.Counter(
            r.get("identity_tier") for e in out["team_games"] for r in e["rows"])),
    }
    return out


def write_receipt(assembled, path: Path):
    L = ["# Assembly receipt — 2024 player box scores", ""]
    L.append(f"summary: `{json.dumps(assembled['summary'])}`")
    L.append("")
    for s in assembled["sources"]:
        L.append(f"- **{s['team']}** ({s['layout']}, family {s['layout_family']}) — {s['source_url']}")
        L.append(f"  - sha256 `{s['source_sha256']}` · pages {s['pages']}")
    L.append("")
    if assembled.get("alias_candidates"):
        L.append("## Name variants resolved inside the roster (confirm these)")
        L.append("")
        for v in assembled["alias_candidates"].values():
            L.append(f"- {v['note']} — person `{v['person_id']}`")
        L.append("")
    L.append("## Validated team-games")
    L.append("")
    L.append("| game | team | side | players | participants | points sum | canonical | minutes |")
    L.append("|---|---|---|---|---|---|---|---|")
    for e in assembled["team_games"]:
        L.append(f"| {e['date']} `{e['game_id']}` | {e['team_edition_id']} | {e['side']} | {e['players']} | "
                 f"{e['participants']} | {e['points_sum']} | {e['canonical_points']} | {e['minutes_sum']} |")
    L.append("")
    if assembled["held"]:
        L.append("## Held (nothing below is written)")
        L.append("")
        for h in assembled["held"]:
            if h.get("scope") == "unmatched":
                for x in h.get("holds", [])[:10]:
                    L.append(f"- unmatched: {x.get('player')} {x.get('date')} — {x.get('reason')}")
            else:
                L.append(f"- {h.get('date')} {h.get('game_id')} {h.get('team_edition_id')}: "
                         + "; ".join(p.get("reason", "") for p in h.get("problems", [])[:4]))
        L.append("")
    path.write_text("\n".join(L), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--artifact", action="append", required=True)
    ap.add_argument("--ref", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--receipt")
    ap.add_argument("--allow-league-unique", action="store_true",
                    help="resolve a player absent from roster evidence when exactly one canonical "
                         "person carries that name and the club's own notes list her")
    a = ap.parse_args()
    teams, games, roster, persons_by_name = load_ref(Path(a.ref))
    artifacts = [json.loads(Path(p).read_text(encoding="utf-8")) for p in a.artifact]
    assembled = assemble(artifacts, teams, games, roster, persons_by_name, a.allow_league_unique)
    Path(a.out).write_text(json.dumps(assembled, indent=1), encoding="utf-8")
    if a.receipt:
        write_receipt(assembled, Path(a.receipt))
    print(json.dumps(assembled["summary"]))


if __name__ == "__main__":
    main()
