#!/usr/bin/env python3
"""Find a club's official game-note PDFs on the WNBA CDN by trying its naming conventions.

    python scripts/wbh/notes_discover.py --ref ref.json --club "Connecticut Sun" --site-id 1611661323 \
        --out found-con.json [--limit 40]

Team notes index pages only publish the current season, so historical documents have to be addressed
directly. Every club names its files in its own way, but each club is internally consistent, so the
approach is: take the club's real 2024 fixtures from canonical data, render them through a handful of
observed filename templates, and ask the CDN which ones exist.

This is discovery of documents we are already permitted to read, not a crawl: one HEAD per candidate,
no directory walking, and it stops early once a club's convention is identified.
"""
from __future__ import annotations

import argparse, json, os, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from notes_assemble import TEAM_CODES, load_ref

UA = "PropBetEdge-History/1.0 (support@proptechusa.ai; official team game notes)"
CDN = "https://cdn.wnba.com/sites/{site}/2024/{mm}/{name}"

# Filename shapes seen across clubs. {m}/{d} are unpadded, {mm}/{dd} padded, {opp} the opponent's
# three-letter code, {vs} the club's own venue word.
TEMPLATES = [
    "{m}.{d}-{vs}-{opp}.pdf",
    "{m}.{d}-{vs}.-{opp}.pdf",
    "{m}-{d}-{vs}-{opp}.pdf",
    "{abbr}-GAME-NOTES-{m}-{d}.pdf",
    "{abbr}-GAME-NOTES-{m}{dd}.pdf",
    "{abbr}.{opp}-{mm}.{dd}.24.pdf",
    "{abbr}.{opp}-{mm}.{dd}.24-1.pdf",
    "{abbr}-Game-Notes-{m}-{d}-24.pdf",
    "{abbr}-Notes-{mm}{dd}24.pdf",
    "{mm}.{dd}-{vs}-{opp}.pdf",
    "{m}.{d}.24-{club_word}-Game-Notes-{vs}-{opp}.pdf",
    "{club_word}-Game-Notes-{m}.{d}.pdf",
    "{club_word}-Gamenotes-{vs}-{opp}-{m}.{d}.pdf",
    # clubs that number their notes by game, with the opponent spelled out
    "{club_word}-Gamenotes-Game-{n}-{vs}-{opp_word}-{m}.{d}.pdf",
    "{club_word}-Gamenote-Game-{n}-{vs}-{opp_word}-{m}.{d}.pdf",
    "{club_word}-Game-Notes-Game-{n}-{vs}-{opp_word}-{m}.{d}.pdf",
    "{club_word}-Gamenotes-Game-{n}-{vs}-{opp_word}-{m}.{d}-1.pdf",
]

# how each club is written when an opponent's name is spelled out in a filename
OPP_WORD = {
    "ATL": "Atlanta", "CHI": "Chicago", "CON": "Connecticut", "DAL": "Dallas", "IND": "Indiana",
    "LVA": "Las-Vegas", "LAS": "Los-Angeles", "MIN": "Minnesota", "NYL": "New-York",
    "PHX": "Phoenix", "SEA": "Seattle", "WAS": "Washington",
}

ABBR = {
    "Atlanta Dream": "ATL", "Chicago Sky": "CHI", "Connecticut Sun": "CON", "Dallas Wings": "DAL",
    "Indiana Fever": "IND", "Las Vegas Aces": "LVA", "Los Angeles Sparks": "LAS",
    "Minnesota Lynx": "MIN", "New York Liberty": "NYL", "Phoenix Mercury": "PHX",
    "Seattle Storm": "SEA", "Washington Mystics": "WAS",
}
CODE_OF = {v: k for k, v in TEAM_CODES.items() if v in ABBR}


def fixtures(ref_path: Path, club: str):
    teams, games, _roster, _persons = load_ref(ref_path)
    me = teams[club]
    out = []
    for g in games:
        if me not in (g["home"], g["away"]):
            continue
        opp_id = g["away"] if g["home"] == me else g["home"]
        opp_name = next((n for n, i in teams.items() if i == opp_id), None)
        if not opp_name:
            continue
        out.append({"date": g["date"], "home": g["home"] == me, "opp": ABBR[opp_name],
                    "type": g.get("type")})
    out = sorted(out, key=lambda x: x["date"])
    n = 0
    for f in out:                      # game number within the regular season, as the notes count it
        if f.get("type") == "regular":
            n += 1
        f["n"] = n
    return out


def candidates(fixture, site_id, club):
    y, m, d = (int(x) for x in fixture["date"].split("-"))
    ctx = {"m": m, "d": d, "mm": f"{m:02d}", "dd": f"{d:02d}", "opp": fixture["opp"],
           "abbr": ABBR[club], "club_word": club.split()[-1],
           "opp_word": OPP_WORD[fixture["opp"]], "n": fixture.get("n", 0),
           "vs": "vs." if fixture["home"] else "at"}
    urls = []
    for t in TEMPLATES:
        urls.append(CDN.format(site=site_id, mm=f"{m:02d}", name=t.format(**ctx)))
        if not fixture["home"]:
            urls.append(CDN.format(site=site_id, mm=f"{m:02d}",
                                   name=t.format(**{**ctx, "vs": "@"})))
    return urls


def head(url: str, timeout=10):
    # no custom User-Agent: the CDN silently stalls unfamiliar agents, and curl's default works
    run = subprocess.run(["curl", "-sS", "-I", "--max-time", str(timeout),
                          "-o", os.devnull, "-w", "%{http_code} %{size_header} %{header_json}", url],
                         capture_output=True, text=True)
    if run.returncode != 0:
        return None, 0
    parts = run.stdout.split(" ", 2)
    try:
        status = int(parts[0])
    except (ValueError, IndexError):
        return None, 0
    size = 0
    if len(parts) > 2:
        try:
            headers = json.loads(parts[2])
            size = int((headers.get("content-length") or ["0"])[0])
        except Exception:
            size = 0
    return status, size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", required=True)
    ap.add_argument("--club", required=True)
    ap.add_argument("--site-id", required=True)
    ap.add_argument("--out")
    ap.add_argument("--limit", type=int, default=0, help="stop after this many fixtures")
    ap.add_argument("--from-date", help="only fixtures on or after this date")
    ap.add_argument("--stop-after-found", type=int, default=0,
                    help="stop once this many documents have been located")
    a = ap.parse_args()

    fx = fixtures(Path(a.ref), a.club)
    if a.from_date:
        fx = [f for f in fx if f["date"] >= a.from_date]
    if a.limit:
        fx = fx[:a.limit]
    found, tried = [], 0
    known_template = None
    for f in fx:
        urls = candidates(f, a.site_id, a.club)
        if known_template:                      # once the convention is known, try it first
            urls.sort(key=lambda u: 0 if known_template in u else 1)
        for u in urls:
            tried += 1
            status, size = head(u)
            if status == 200 and size > 200_000:
                found.append({"date": f["date"], "opp": f["opp"], "home": f["home"],
                              "url": u, "bytes": size})
                known_template = u.split("/")[-1]
                break
        if a.stop_after_found and len(found) >= a.stop_after_found:
            break

    result = {"club": a.club, "site_id": a.site_id, "fixtures_checked": len(fx),
              "urls_tried": tried, "found": found}
    if a.out:
        Path(a.out).write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps({"club": a.club, "fixtures": len(fx), "tried": tried, "found": len(found)}))
    for f in found[:10]:
        print(f"  {f['date']} {'vs' if f['home'] else '@'} {f['opp']}  {f['url']}")


if __name__ == "__main__":
    main()
