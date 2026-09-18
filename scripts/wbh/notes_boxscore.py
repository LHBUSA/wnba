#!/usr/bin/env python3
"""Layout-aware extraction of per-game player box-score rows from official WNBA team game notes.

    python scripts/wbh/notes_boxscore.py --pdf <file.pdf> --layout sky_2024 \
        --url <source url> --team "Chicago Sky" --out artifact.json --receipt receipt.md

The pipeline never goes PDF -> database. It emits an inspectable JSON artifact and a human-readable
receipt; a separate step resolves identity, matches canonical games and writes SQL.

Geometry, not flattened text. Words are read with x/y coordinates, rows are rebuilt by y, and each
cell is assigned to the column whose header span contains its centre. A cell that falls near a
column boundary makes the whole row ambiguous, and an ambiguous row is held, never guessed.

Rules that hold everywhere in this file:
  * missing is not zero. A column the source does not print stays None.
  * a printed 0 is a real zero.
  * every row is checked against its own arithmetic (points must equal the made shots) and rows that
    fail are held with a reason rather than repaired.
"""
from __future__ import annotations

import argparse, collections, dataclasses, datetime as dt, hashlib, json, re, sys
from pathlib import Path

try:
    import pdfplumber
except ImportError:  # pragma: no cover - environment guard
    sys.exit("pdfplumber is required: pip install pdfplumber")

TRANSFORMATION_VERSION = "wbh_notes_boxscore_v1"

# ---------------------------------------------------------------------------- layout specifications
#
# A layout is a declaration, not code: which header tokens identify the table, what each column
# means, and how minutes are printed. Adding a team's layout should mean adding an entry here.

LAYOUTS = {
    # Chicago Sky 2024 game notes: one player per page, integer minutes, percentage columns present,
    # a combined "G-GS" column that states games played and games started.
    "sky_2024": {
        "family": "A",
        # the heading prints the position on the same line; it is captured separately so it never
        # becomes part of the player's name
        "player_heading": r"^#(?P<number>\d+)\s+(?P<name>[A-Z][A-Z .'’\-]+?)(?:\s+(?P<pos>[GFC](?:[/-][GFC])?))?$",
        "required_headers": ["DATE", "OPP.", "MIN", "FGM-A", "PTS"],
        "columns": {
            "DATE": "date", "OPP.": "opponent", "G-GS": "g_gs", "MIN": "minutes_int",
            "FGM-A": "fg", "FG%": "ignore", "3PM-A": "fg3", "3P%": "ignore",
            "FTM-A": "ft", "FT%": "ignore", "OREB": "oreb", "DREB": "dreb", "REB": "reb",
            "AST": "ast", "STL": "stl", "BLK": "blk", "TO": "tov", "PF": "pf", "PTS": "pts",
        },
        "date_pattern": r"^\d{2}\.\d{2}$",
        "minutes": "int",
        # this layout states non-participation structurally: games-started reads 0-0 and every stat
        # cell is a dash. It gives no reason, so it is recorded as non-participation, not as a DNP.
        "zero_game_marker": "0-0",
    },
    # Atlanta Dream 2024 game notes: one player per page, mm:ss minutes, no percentage columns,
    # an explicit "DNP - Coach's Decision" row form, and a separate starter flag column.
    "dream_2024": {
        "family": "C",
        "player_heading": r"^#(?P<number>\d+)\s+(?P<name>[A-Z][A-Z .'’\-]+?)(?:\s+(?P<pos>[GFC](?:[/-][GFC])?))?$",
        "required_headers": ["Date", "Opp", "FGM-A", "PTS"],
        "columns": {
            "Date": "date", "Opp": "opponent", "GS": "gs_flag", "MP": "minutes_mmss",
            "FGM-A": "fg", "3PM-A": "fg3", "FTM-A": "ft", "OREB": "oreb", "DREB": "dreb",
            "REB": "reb", "AST": "ast", "STL": "stl", "BLK": "blk", "TO": "tov",
            "PF": "pf", "PTS": "pts",
        },
        "date_pattern": r"^\d{1,2}/\d{1,2}$",
        "minutes": "mmss",
    },
    # Phoenix Mercury 2024 game notes: one player per page, mm:ss minutes, separate made and
    # attempted columns, a started flag, a real plus/minus column and the final score of each game.
    "mercury_2024": {
        "family": "D",
        "player_heading": r"^#?(?P<number>\d+)?\s*(?P<name>[A-Z][A-Za-z .'’\-]+)$",
        "required_headers": ["DATE", "OPP", "MIN", "PTS"],
        "columns": {
            "DATE": "date", "OPP": "opponent", "P/S": "start_flag", "MIN": "minutes_mmss",
            "FG": "fgm", "FGA": "fga", "FG%": "ignore",
            "3PM": "fg3m", "3PA": "fg3a", "3P%": "ignore",
            "FT": "ftm", "FTA": "fta", "FT%": "ignore",
            "OR": "oreb", "DR": "dreb", "TOT": "reb", "A": "ast", "ST": "stl", "BS": "blk",
            "TO": "tov", "PF": "pf", "+/-": "plus_minus", "PTS": "pts",
            "W/L": "ignore", "SCORE": "team_score_pair",
        },
        "date_pattern": r"^\d{2}/\d{2}/\d{2}$",
        "minutes": "mmss",
    },
}

DNP_PATTERN = re.compile(r"\bD\s*NP\b|\bDNP\b|did not play", re.I)
# "NWT" (not with team) and in-game notes are explicit non-participation markers, but they are not
# the same claim as a coach's DNP, so they produce no stat row and no did_not_play assertion.
NONPARTICIPATION_PATTERN = re.compile(r"\bN\s*WT\b|not with team|Left the (game|team)", re.I)
ROW_Y_TOLERANCE = 3.0          # points; words within this vertical distance are one row
BOUNDARY_MARGIN = 2.0          # points; a cell centre this close to a column edge is ambiguous
TABLE_RIGHT_MARGIN = 10.0      # points past the last header where the table is considered to end


@dataclasses.dataclass
class Cell:
    text: str
    x0: float
    x1: float

    @property
    def center(self) -> float:
        return (self.x0 + self.x1) / 2


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cluster_rows(words, tolerance=ROW_Y_TOLERANCE):
    """Group words into rows by vertical position, preserving x order within a row."""
    rows = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        for row in rows:
            if abs(row["top"] - w["top"]) <= tolerance:
                row["words"].append(w)
                break
        else:
            rows.append({"top": w["top"], "words": [w]})
    for row in rows:
        row["words"].sort(key=lambda w: w["x0"])
    return rows


def find_header(rows, spec):
    """Return (row, columns) where columns is [(label, field, x0, x1)] in x order."""
    labels = list(spec["columns"])
    required = spec["required_headers"]
    for row in rows:
        texts = [w["text"] for w in row["words"]]
        if not all(any(t == req for t in texts) for req in required):
            continue
        cols = []
        for w in row["words"]:
            if w["text"] in spec["columns"]:
                cols.append((w["text"], spec["columns"][w["text"]], w["x0"], w["x1"]))
        # a header must be strictly ordered and cover the required labels once each
        seen = [c[0] for c in cols]
        if any(seen.count(req) != 1 for req in required):
            continue
        if len(cols) < len(required):
            continue
        cols.sort(key=lambda c: c[2])
        return row, cols
    return None, None


def column_bounds(cols, table_right):
    """Midpoint boundaries between adjacent header centres.

    The final column is closed at the table's right edge rather than left open: these pages carry a
    side panel a little to the right of the last column, and an open-ended last column would quietly
    swallow it.
    """
    centers = [(c[2] + c[3]) / 2 for c in cols]
    bounds = []
    for i, c in enumerate(cols):
        left = -1e9 if i == 0 else (centers[i - 1] + centers[i]) / 2
        right = table_right if i == len(cols) - 1 else (centers[i] + centers[i + 1]) / 2
        bounds.append((c[0], c[1], left, right))
    return bounds


def assign_cells(row_words, bounds, table_right):
    """Place each word in a column. Returns (cells_by_field, ambiguities)."""
    cells = collections.defaultdict(list)
    ambiguities = []
    for w in row_words:
        cell = Cell(w["text"], w["x0"], w["x1"])
        if cell.x0 > table_right:
            continue  # side panel content, outside the table
        placed = None
        for label, field, left, right in bounds:
            if left <= cell.center < right:
                placed = (label, field, left, right)
                break
        if placed is None:
            ambiguities.append(f"{cell.text!r} at x={cell.center:.1f} fell outside every column")
            continue
        _, field, left, right = placed
        for edge in (left, right):
            if abs(edge) < 1e8 and abs(cell.center - edge) < BOUNDARY_MARGIN:
                ambiguities.append(
                    f"{cell.text!r} centre {cell.center:.1f} sits within {BOUNDARY_MARGIN}pt of a column edge")
        cells[field].append(cell)
    return cells, ambiguities


def one(cells, field):
    vals = cells.get(field) or []
    if len(vals) != 1:
        return None
    return vals[0].text


def joined(cells, field):
    vals = cells.get(field) or []
    return " ".join(v.text for v in vals) if vals else None


def parse_int(text):
    if text is None or text in ("-", "--", "—"):
        return None
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    return None


def parse_made_attempted(text):
    """'4-8' -> (4, 8). Returns (None, None) when the source printed nothing."""
    if text is None or text in ("-", "--", "—"):
        return None, None
    m = re.fullmatch(r"(\d+)-(\d+)", text)
    if not m:
        return "malformed", "malformed"
    return int(m.group(1)), int(m.group(2))


def parse_minutes(text, mode):
    """Minutes -> whole seconds, deterministically. None when absent."""
    if text is None or text in ("-", "--", "—"):
        return None
    if mode == "mmss":
        m = re.fullmatch(r"(\d+):(\d{2})", text)
        if not m:
            return "malformed"
        return int(m.group(1)) * 60 + int(m.group(2))
    m = re.fullmatch(r"(\d+)", text)
    if not m:
        return "malformed"
    return int(m.group(1)) * 60


def parse_date(text, season_year, pattern):
    if text is None or not re.fullmatch(pattern, text):
        return None
    parts = re.split(r"[./]", text)
    month, day = parts[0], parts[1]
    year = season_year
    if len(parts) > 2:                       # layouts that print the year, e.g. 05/14/24
        year = int(parts[2])
        year += 2000 if year < 100 else 0
        if year != season_year:
            return None                      # a row from another season is not this season's row
    try:
        return dt.date(year, int(month), int(day)).isoformat()
    except ValueError:
        return None


def parse_opponent(text):
    """'@ DAL' / 'vs. MIN' / 'CON' -> (code, home_away). home_away is None when not printed."""
    if not text:
        return None, None
    t = text.replace("vs.", " ").replace("vs", " ")
    away = "@" in t
    code = re.sub(r"[^A-Z]", "", t.upper())
    if not code:
        return None, None
    return code, ("away" if away else "home")


def extract_player_rows(page, spec, season_year):
    rows = cluster_rows(page.extract_words())
    header_row, cols = find_header(rows, spec)
    if not cols:
        return None
    # the table ends just past the last header; anything further right belongs to a side panel
    table_right = max(c[3] for c in cols) + TABLE_RIGHT_MARGIN
    bounds = column_bounds(cols, table_right)

    # player identity comes from the page heading, above the table
    heading = None
    heading_re = re.compile(spec["player_heading"])
    for row in rows:
        if row["top"] >= header_row["top"]:
            break
        text = " ".join(w["text"] for w in row["words"]).strip()
        m = heading_re.match(text)
        if m:
            heading = {"number": m.group("number"), "name": m.group("name").strip()}
    if not heading:
        return {"error": "player heading not found", "headers": [c[0] for c in cols]}

    out_rows = []
    for row in rows:
        if row["top"] <= header_row["top"]:
            continue
        first = row["words"][0]["text"]
        if not re.fullmatch(spec["date_pattern"], first):
            continue
        cells, ambiguities = assign_cells(row["words"], bounds, table_right)
        raw_text = " ".join(w["text"] for w in row["words"] if w["x0"] <= table_right)

        rec = {
            "raw_text": raw_text,
            "y": round(row["top"], 1),
            "ambiguities": ambiguities,
            "date": parse_date(one(cells, "date"), season_year, spec["date_pattern"]),
            "opponent_raw": joined(cells, "opponent"),
        }
        rec["opponent_code"], rec["home_away"] = parse_opponent(rec["opponent_raw"])

        if spec.get("zero_game_marker") and one(cells, "g_gs") == spec["zero_game_marker"]:
            rec.update({"status": "nonparticipation", "note": raw_text,
                        "did_not_play": None, "started": None, "seconds_played": None})
            out_rows.append(rec)
            continue

        if NONPARTICIPATION_PATTERN.search(raw_text):
            rec.update({"status": "nonparticipation", "note": raw_text,
                        "did_not_play": None, "started": None, "seconds_played": None})
            out_rows.append(rec)
            continue

        if DNP_PATTERN.search(raw_text):
            rec.update({"did_not_play": True, "dnp_reason": raw_text.split("D NP")[-1].strip() or None,
                        "started": None, "seconds_played": None})
            rec["status"] = "dnp"
            out_rows.append(rec)
            continue

        rec["did_not_play"] = False
        rec["dnp_reason"] = None

        # started: only when the source states it
        started = None
        g_gs = one(cells, "g_gs")
        if g_gs and re.fullmatch(r"\d+-\d+", g_gs):
            started = g_gs.split("-")[1] != "0"
        gs_flag = one(cells, "gs_flag")
        if gs_flag is not None:
            started = gs_flag.strip() not in ("", "-")
        start_flag = one(cells, "start_flag")
        if start_flag is not None:
            started = start_flag.strip().upper() == "S"
        rec["started"] = started

        minutes_field = "minutes_int" if spec["minutes"] == "int" else "minutes_mmss"
        rec["seconds_played"] = parse_minutes(one(cells, minutes_field), spec["minutes"])

        # a layout prints shooting either combined ("4-8") or as separate made and attempted columns
        if "fg" in spec["columns"].values():
            fgm, fga = parse_made_attempted(one(cells, "fg"))
            f3m, f3a = parse_made_attempted(one(cells, "fg3"))
            ftm, fta = parse_made_attempted(one(cells, "ft"))
        else:
            fgm, fga = parse_int(one(cells, "fgm")), parse_int(one(cells, "fga"))
            f3m, f3a = parse_int(one(cells, "fg3m")), parse_int(one(cells, "fg3a"))
            ftm, fta = parse_int(one(cells, "ftm")), parse_int(one(cells, "fta"))
        rec.update({
            "field_goals_made": fgm, "field_goals_attempted": fga,
            "three_pointers_made": f3m, "three_pointers_attempted": f3a,
            "free_throws_made": ftm, "free_throws_attempted": fta,
            "offensive_rebounds": parse_int(one(cells, "oreb")),
            "defensive_rebounds": parse_int(one(cells, "dreb")),
            "rebounds": parse_int(one(cells, "reb")),
            "assists": parse_int(one(cells, "ast")),
            "steals": parse_int(one(cells, "stl")),
            "blocks": parse_int(one(cells, "blk")),
            "turnovers": parse_int(one(cells, "tov")),
            "personal_fouls": parse_int(one(cells, "pf")),
            "points": parse_int(one(cells, "pts")),
            # only populated by layouts that actually print it; unknown stays unknown
            "plus_minus": parse_int(one(cells, "plus_minus")),
        })
        # An early-season document prints every date on the schedule, including games not yet played,
        # as a row of dashes. That is the source saying nothing, not a player appearing and scoring
        # nothing, so it produces no stat row at all.
        if all(rec.get(f) is None for f in
               ("seconds_played", "points", "field_goals_made", "field_goals_attempted",
                "three_pointers_made", "free_throws_made", "rebounds", "assists")):
            rec["status"] = "no_data"
            out_rows.append(rec)
            continue

        rec["status"], rec["hold_reasons"] = validate_row(rec)
        out_rows.append(rec)

    return {"player": heading, "headers": [c[0] for c in cols],
            "column_x": {c[0]: [round(c[2], 1), round(c[3], 1)] for c in cols},
            "table_right": round(table_right, 1), "rows": out_rows}


def validate_row(rec):
    """Fail closed. Returns ('ok'|'hold', reasons)."""
    reasons = []
    if rec["ambiguities"]:
        reasons.extend(rec["ambiguities"])
    if rec["date"] is None:
        reasons.append("date did not parse")
    if rec["opponent_code"] is None:
        reasons.append("opponent did not parse")
    if rec["seconds_played"] == "malformed":
        reasons.append("minutes malformed")
    for made, att, label in (
        (rec["field_goals_made"], rec["field_goals_attempted"], "FG"),
        (rec["three_pointers_made"], rec["three_pointers_attempted"], "3P"),
        (rec["free_throws_made"], rec["free_throws_attempted"], "FT"),
    ):
        if made == "malformed" or att == "malformed":
            reasons.append(f"{label} made-attempted malformed")
            continue
        if made is None or att is None:
            continue
        if made > att:
            reasons.append(f"{label} made {made} > attempted {att}")
    for field in ("offensive_rebounds", "defensive_rebounds", "rebounds", "assists", "steals",
                  "blocks", "turnovers", "personal_fouls", "points"):
        v = rec.get(field)
        if isinstance(v, int) and v < 0:
            reasons.append(f"{field} is negative")

    # the row must agree with its own arithmetic
    fgm, f3m, ftm, pts = (rec["field_goals_made"], rec["three_pointers_made"],
                          rec["free_throws_made"], rec["points"])
    if all(isinstance(v, int) for v in (fgm, f3m, ftm, pts)):
        expected = 2 * (fgm - f3m) + 3 * f3m + ftm
        if expected != pts:
            reasons.append(f"points {pts} != 2*(FGM-3PM)+3*3PM+FTM = {expected}")
    if isinstance(rec["rebounds"], int) and isinstance(rec["offensive_rebounds"], int) \
            and isinstance(rec["defensive_rebounds"], int):
        if rec["offensive_rebounds"] + rec["defensive_rebounds"] != rec["rebounds"]:
            reasons.append("OREB + DREB != REB")
    return ("hold" if reasons else "ok"), reasons


def extract(pdf_path: Path, layout_key: str, url: str, team: str, season_year: int):
    spec = LAYOUTS[layout_key]
    artifact = {
        "transformation_version": TRANSFORMATION_VERSION,
        "extracted_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source_url": url,
        "source_sha256": sha256_file(pdf_path),
        "source_bytes": pdf_path.stat().st_size,
        "layout": layout_key,
        "layout_family": spec["family"],
        "team": team,
        "season_year": season_year,
        "players": [],
        "pages_with_tables": [],
    }
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page_index, page in enumerate(pdf.pages):
            result = extract_player_rows(page, spec, season_year)
            if not result or "error" in (result or {}):
                continue
            artifact["pages_with_tables"].append(page_index)
            artifact["players"].append({
                "page": page_index,
                "number": result["player"]["number"],
                "name": result["player"]["name"],
                "headers": result["headers"],
                "column_x": result["column_x"],
                "rows": result["rows"],
            })
    counts = collections.Counter()
    for p in artifact["players"]:
        for r in p["rows"]:
            counts[r["status"]] += 1
    artifact["summary"] = {"players": len(artifact["players"]), "rows": sum(counts.values()),
                           "ok": counts["ok"], "held": counts["hold"], "dnp": counts["dnp"],
                           "nonparticipation": counts["nonparticipation"],
                           "no_data": counts["no_data"]}
    return artifact


def write_receipt(artifact, path: Path, max_rows_per_player=4):
    L = []
    L.append(f"# Extraction receipt — {artifact['team']} ({artifact['layout']}, family {artifact['layout_family']})")
    L.append("")
    L.append(f"- source: {artifact['source_url']}")
    L.append(f"- sha256: `{artifact['source_sha256']}`")
    L.append(f"- extracted_at: {artifact['extracted_at']}")
    L.append(f"- transformation_version: `{artifact['transformation_version']}`")
    L.append(f"- pages with tables: {artifact['pages_with_tables']}")
    L.append(f"- summary: {artifact['summary']}")
    L.append("")
    for p in artifact["players"]:
        L.append(f"## p{p['page']} · #{p['number']} {p['name']}")
        L.append("")
        L.append(f"headers: `{' | '.join(p['headers'])}`")
        L.append("")
        L.append("column x-spans: " + ", ".join(f"{k} [{v[0]},{v[1]}]" for k, v in p["column_x"].items()))
        L.append("")
        for r in p["rows"][:max_rows_per_player]:
            L.append(f"- raw: `{r['raw_text']}`")
            if r["status"] == "dnp":
                L.append(f"  - parsed: DNP ({r.get('dnp_reason')}) · date {r['date']} · opp {r['opponent_code']}")
            elif r["status"] == "nonparticipation":
                L.append(f"  - parsed: not with team · date {r['date']} · opp {r['opponent_code']} · no stat row emitted")
            else:
                L.append(
                    "  - parsed: date {date} · opp {opp} {ha} · started {st} · sec {sec} · "
                    "FG {fgm}-{fga} · 3P {f3m}-{f3a} · FT {ftm}-{fta} · OREB {o} DREB {d} REB {r} · "
                    "AST {a} STL {s} BLK {b} TOV {t} PF {pf} · PTS {pts} · +/- {pm}".format(
                        date=r["date"], opp=r["opponent_code"], ha=r["home_away"], st=r["started"],
                        sec=r["seconds_played"], fgm=r["field_goals_made"], fga=r["field_goals_attempted"],
                        f3m=r["three_pointers_made"], f3a=r["three_pointers_attempted"],
                        ftm=r["free_throws_made"], fta=r["free_throws_attempted"],
                        o=r["offensive_rebounds"], d=r["defensive_rebounds"], r=r["rebounds"],
                        a=r["assists"], s=r["steals"], b=r["blocks"], t=r["turnovers"],
                        pf=r["personal_fouls"], pts=r["points"], pm=r["plus_minus"]))
            L.append(f"  - status: **{r['status']}**" + (f" — {'; '.join(r.get('hold_reasons') or [])}" if r["status"] == "hold" else ""))
        if len(p["rows"]) > max_rows_per_player:
            L.append(f"- … {len(p['rows']) - max_rows_per_player} further rows in the JSON artifact")
        L.append("")
    path.write_text("\n".join(L), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--layout", required=True, choices=sorted(LAYOUTS))
    ap.add_argument("--url", required=True)
    ap.add_argument("--team", required=True)
    ap.add_argument("--season", type=int, default=2024)
    ap.add_argument("--out", required=True)
    ap.add_argument("--receipt")
    a = ap.parse_args()
    artifact = extract(Path(a.pdf), a.layout, a.url, a.team, a.season)
    Path(a.out).write_text(json.dumps(artifact, indent=1), encoding="utf-8")
    if a.receipt:
        write_receipt(artifact, Path(a.receipt))
    print(json.dumps(artifact["summary"]))


if __name__ == "__main__":
    main()
