#!/usr/bin/env python3
"""Classify official team documents: does this PDF contain per-game player logs we can parse?

    python scripts/wbh/notes_probe.py --pdf a.pdf [--pdf b.pdf] --out probe.json
    python scripts/wbh/notes_probe.py --url https://... --club "Seattle Storm" --out probe.json

Answers one question per document, so the coverage matrix can be built without hand-inspection:

  known_layout          a layout family in notes_boxscore.LAYOUTS matches; parse it now
  new_layout_candidate  a per-game player table exists but no family matches; the header tokens and
                        their x-spans are reported so a declarative spec can be added
  no_player_game_log    career highs, season aggregates or prose only; a dead end, record and move on

A new family is only suggested when a table really has a date column and made-attempted columns.
"""
from __future__ import annotations

import argparse, collections, json, re, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import notes_boxscore as nb

try:
    import pdfplumber
except ImportError:  # pragma: no cover
    sys.exit("pdfplumber is required: pip install pdfplumber")

UA = "PropBetEdge-History/1.0 (support@proptechusa.ai; official team game notes)"

DATE_HEADERS = {"DATE", "Date", "DATES"}
MADE_ATT_HEADERS = {"FGM-A", "FG-A", "FGM", "FG", "3PM-A", "3FGM-A", "FTM-A"}
POINT_HEADERS = {"PTS", "Pts", "PTS."}


def fetch(url: str, dest: Path) -> Path:
    """curl, not urllib: the CDN is slow to first byte and urllib's timeouts fire first."""
    run = subprocess.run(["curl", "-sS", "--max-time", "180", "-o", str(dest), "-w", "%{http_code}", url],
                         capture_output=True, text=True)
    if run.returncode != 0 or run.stdout.strip() != "200":
        raise RuntimeError(f"fetch failed ({run.stdout.strip() or run.returncode}) {url}")
    return dest


class CachedPage:
    """Words are the expensive part of pdfplumber; read them once and let every layout try them."""

    def __init__(self, page):
        self._words = page.extract_words()

    def extract_words(self, **_):
        return self._words


def candidate_tables(page):
    """Rows that look like a table header carrying a date column and shooting columns."""
    rows = nb.cluster_rows(page.extract_words())
    found = []
    for row in rows:
        texts = [w["text"] for w in row["words"]]
        if not (set(texts) & DATE_HEADERS):
            continue
        if not (set(texts) & MADE_ATT_HEADERS):
            continue
        if not (set(texts) & POINT_HEADERS):
            continue
        found.append({
            "headers": texts,
            "x_spans": {w["text"]: [round(w["x0"], 1), round(w["x1"], 1)] for w in row["words"]},
            "y": round(row["top"], 1),
        })
    return found


def probe_pdf(path: Path, url=None, club=None):
    result = {"club": club, "url": url, "file": path.name,
              "sha256": nb.sha256_file(path), "bytes": path.stat().st_size}
    matched = collections.Counter()
    candidates = []
    dates_seen = []
    players = set()
    with pdfplumber.open(str(path)) as pdf:
        result["pages"] = len(pdf.pages)
        for i, raw_page in enumerate(pdf.pages):
            page = CachedPage(raw_page)
            for key, spec in nb.LAYOUTS.items():
                out = nb.extract_player_rows(page, spec, 2024)
                if out and "error" not in out and out.get("rows"):
                    matched[key] += 1
                    players.add(out["player"]["name"])
                    dates_seen += [r["date"] for r in out["rows"] if r.get("date")]
                    break
            else:
                for cand in candidate_tables(page):
                    cand["page"] = i
                    candidates.append(cand)

    if matched:
        layout, pages = matched.most_common(1)[0]
        result.update({"classification": "known_layout", "layout": layout,
                       "pages_with_logs": pages, "players": len(players),
                       "earliest_game": min(dates_seen) if dates_seen else None,
                       "latest_game": max(dates_seen) if dates_seen else None,
                       "reason": f"{pages} player pages parsed with the {layout} family"})
    elif candidates:
        result.update({"classification": "new_layout_candidate", "layout": None,
                       "candidate_tables": candidates[:3], "players": 0,
                       "reason": "a per-game table exists but no current family matches its headers"})
    else:
        result.update({"classification": "no_player_game_log", "layout": None, "players": 0,
                       "reason": "no table with a date column, made-attempted columns and points"})
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", action="append", default=[])
    ap.add_argument("--url", action="append", default=[])
    ap.add_argument("--club")
    ap.add_argument("--cache", default=".")
    ap.add_argument("--out")
    a = ap.parse_args()

    results = []
    for p in a.pdf:
        results.append(probe_pdf(Path(p), club=a.club))
    for u in a.url:
        dest = Path(a.cache) / re.sub(r"[^A-Za-z0-9._-]", "_", u.split("/")[-1])[:120]
        try:
            fetch(u, dest)
        except Exception as exc:
            results.append({"club": a.club, "url": u, "classification": "unavailable", "reason": str(exc)})
            continue
        results.append(probe_pdf(dest, url=u, club=a.club))

    if a.out:
        Path(a.out).write_text(json.dumps(results, indent=1), encoding="utf-8")
    for r in results:
        print(f"{r.get('classification'):22s} {r.get('layout') or '-':12s} "
              f"players={r.get('players', 0):3} pages={r.get('pages', 0):3} "
              f"{r.get('file') or r.get('url')}")


if __name__ == "__main__":
    main()
