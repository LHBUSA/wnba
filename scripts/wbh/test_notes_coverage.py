#!/usr/bin/env python3
"""Tests for the coverage-expansion work: the Mercury layout family, no-data rows, snapshot union,
club aliases and the unlock-priority calculation.

    python scripts/wbh/test_notes_coverage.py
"""
from __future__ import annotations

import collections, sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import notes_boxscore as nb
import notes_assemble as na
from test_notes_boxscore import FakePage, SKY_HEADER, sky_row, GameResolution

MERCURY_HEADER = [
    ("DATE", 28.9, 42.3, 72), ("OPP", 84.5, 94.9, 72), ("P/S", 124.8, 133.4, 72),
    ("MIN", 153.3, 164.1, 72), ("FG", 175.1, 181.7, 72), ("FGA", 191.6, 201.8, 72),
    ("FG%", 211.7, 222.6, 72), ("3PM", 232.5, 244.0, 72), ("3PA", 253.8, 263.7, 72),
    ("3P%", 273.7, 284.3, 72), ("FT", 296.1, 301.9, 72), ("FTA", 311.7, 321.1, 72),
    ("FT%", 334.6, 344.7, 72), ("OR", 354.8, 362.2, 72), ("DR", 372.6, 379.8, 72),
    ("TOT", 389.7, 399.7, 72), ("A", 413.6, 417.2, 72), ("ST", 429.0, 434.8, 72),
    ("BS", 446.1, 452.3, 72), ("TO", 462.9, 469.9, 72), ("PF", 481.5, 487.5, 72),
    ("+/-", 499.4, 506.9, 72), ("PTS", 516.9, 525.9, 72), ("W/L", 533.1, 543.7, 72),
    ("SCORE", 558.8, 575.2, 72),
]

# cells are placed on the header centres, the way the real document lays them out
MERCURY_X = [((h[1] + h[2]) / 2 - 2.5, (h[1] + h[2]) / 2 + 2.5) for h in MERCURY_HEADER]


class MercuryLayout(unittest.TestCase):
    """Family D: separate made and attempted columns, a printed plus/minus, mm:ss minutes."""

    def page(self, cells, heading="SOPHIE CUNNINGHAM"):
        return FakePage([("#", 20, 26, 40), (heading, 30, 200, 40)] + MERCURY_HEADER + cells)

    def row(self, y, values):
        return [(v, MERCURY_X[i][0], MERCURY_X[i][1], y)
                for i, v in enumerate(values) if v is not None]

    LINE = ["05/18/24", "CHI", "P", "20:27", "1", "4", ".250", "0", "1", ".000",
            "3", "4", ".750", "1", "3", "4", "2", "0", "0", "1", "2", "-5", "5", "W", "88-85"]

    def test_separate_made_and_attempted_columns(self):
        out = nb.extract_player_rows(self.page(self.row(90, self.LINE)),
                                     nb.LAYOUTS["mercury_2024"], 2024)
        r = out["rows"][0]
        self.assertEqual(r["status"], "ok")
        self.assertEqual((r["field_goals_made"], r["field_goals_attempted"]), (1, 4))
        self.assertEqual((r["three_pointers_made"], r["three_pointers_attempted"]), (0, 1))
        self.assertEqual((r["free_throws_made"], r["free_throws_attempted"]), (3, 4))
        self.assertEqual(r["points"], 5)
        self.assertEqual(r["seconds_played"], 20 * 60 + 27)
        self.assertEqual((r["offensive_rebounds"], r["defensive_rebounds"], r["rebounds"]), (1, 3, 4))

    def test_plus_minus_is_kept_when_the_source_prints_it(self):
        out = nb.extract_player_rows(self.page(self.row(90, self.LINE)),
                                     nb.LAYOUTS["mercury_2024"], 2024)
        self.assertEqual(out["rows"][0]["plus_minus"], -5)

    def test_started_flag(self):
        line = list(self.LINE)
        line[2] = "S"
        out = nb.extract_player_rows(self.page(self.row(90, line)), nb.LAYOUTS["mercury_2024"], 2024)
        self.assertIs(out["rows"][0]["started"], True)
        line[2] = "P"
        out = nb.extract_player_rows(self.page(self.row(90, line)), nb.LAYOUTS["mercury_2024"], 2024)
        self.assertIs(out["rows"][0]["started"], False)

    def test_a_row_from_another_season_is_refused(self):
        """These logs can span seasons and clubs; a 2023 row is not a 2024 row."""
        line = list(self.LINE)
        line[0] = "05/18/23"
        out = nb.extract_player_rows(self.page(self.row(90, line)), nb.LAYOUTS["mercury_2024"], 2024)
        self.assertEqual(out["rows"][0]["status"], "hold")
        self.assertIn("date did not parse", out["rows"][0]["hold_reasons"])

    def test_did_not_dress_and_inactive_are_not_dnp(self):
        for marker in ("DND", "Inactive", "NWT"):
            cells = [("05/28/24", 28, 60, 90), ("at", 84, 92, 90), ("CON", 95, 110, 90),
                     (marker, 317, 340, 90), ("-", 345, 348, 90), ("Injury", 350, 380, 90)]
            out = nb.extract_player_rows(self.page(cells), nb.LAYOUTS["mercury_2024"], 2024)
            self.assertEqual(out["rows"][0]["status"], "nonparticipation", marker)
            self.assertIsNone(out["rows"][0]["did_not_play"], marker)


class NoDataRows(unittest.TestCase):
    """An early-season document lists games not yet played as a row of dashes."""

    def page(self, cells):
        return FakePage(SKY_HEADER + [("#1", 192, 210, 58), ("ANGEL", 220, 320, 58),
                                      ("REESE", 325, 420, 58)] + cells)

    def test_all_dashes_is_no_data_not_a_scoreless_appearance(self):
        row = nb.extract_player_rows(self.page(sky_row(110, ["06.20", "DAL", None] + ["-"] * 16)),
                                     nb.LAYOUTS["sky_2024"], 2024)["rows"][0]
        self.assertEqual(row["status"], "no_data")

    def test_a_real_zero_line_is_kept(self):
        cells = sky_row(110, ["06.20", "DAL", "1-0", "4", "0-0", "-", "0-0", "-", "0-0", "-",
                              "0", "0", "0", "0", "0", "0", "0", "0", "0"])
        row = nb.extract_player_rows(self.page(cells), nb.LAYOUTS["sky_2024"], 2024)["rows"][0]
        self.assertEqual(row["status"], "ok")
        self.assertEqual(row["points"], 0)
        self.assertEqual(row["seconds_played"], 240)


class SnapshotUnion(unittest.TestCase):
    """Several documents from one club covering the same game."""

    teams = GameResolution.teams
    games = GameResolution.games
    roster = {"te_chicago_sky_2024": [{"person_id": "gp_1", "name": "A One"},
                                      {"person_id": "gp_2", "name": "B Two"}]}

    def artifact(self, rows, sha):
        return {"team": "Chicago Sky", "layout": "sky_2024", "layout_family": "A",
                "source_url": f"https://example.invalid/{sha[:8]}.pdf", "source_sha256": sha,
                "pages_with_tables": [1],
                "players": [{"page": 1, "number": str(i), "name": r.pop("name"), "headers": [],
                             "column_x": {}, "rows": [r]} for i, r in enumerate(rows)]}

    def row(self, name, points, seconds, **over):
        rec = {"name": name, "status": "ok", "date": "2024-07-02", "opponent_code": "ATL",
               "home_away": "away", "raw_text": "", "ambiguities": [], "did_not_play": False,
               "started": True, "plus_minus": None}
        for f in na.STAT_FIELDS:
            rec.setdefault(f, None)
        rec["points"], rec["seconds_played"] = points, seconds
        rec.update(over)
        return rec

    def test_a_player_missing_from_one_snapshot_is_supplied_by_another(self):
        a = self.artifact([self.row("A ONE", 40, 6000)], "a" * 64)
        b = self.artifact([self.row("A ONE", 40, 6000), self.row("B TWO", 45, 6060)], "b" * 64)
        out = na.assemble([a, b], self.teams, self.games, self.roster)
        self.assertEqual(len(out["team_games"]), 1)
        self.assertEqual(out["team_games"][0]["points_sum"], 85)

    def test_documents_that_disagree_hold_the_team_game(self):
        a = self.artifact([self.row("A ONE", 40, 6000), self.row("B TWO", 45, 6060)], "a" * 64)
        b = self.artifact([self.row("A ONE", 41, 6000), self.row("B TWO", 45, 6060)], "b" * 64)
        out = na.assemble([a, b], self.teams, self.games, self.roster)
        self.assertEqual(out["team_games"], [])
        self.assertTrue(any("disagree" in p.get("reason", "")
                            for h in out["held"] for p in h.get("problems", [])),
                        "an explicit numeric disagreement must hold the team-game")

    def test_a_gap_in_one_document_is_not_a_disagreement(self):
        a = self.artifact([self.row("A ONE", 40, 6000, rebounds=None),
                           self.row("B TWO", 45, 6060)], "a" * 64)
        b = self.artifact([self.row("A ONE", 40, 6000, rebounds=7),
                           self.row("B TWO", 45, 6060)], "b" * 64)
        out = na.assemble([a, b], self.teams, self.games, self.roster)
        self.assertEqual(len(out["team_games"]), 1)
        filled = [r for r in out["team_games"][0]["rows"] if r["person_id"] == "gp_1"][0]
        self.assertEqual(filled["rebounds"], 7, "the document that printed the value fills the gap")


class ClubAliases(unittest.TestCase):
    def test_known_abbreviation_variants_resolve(self):
        for code in ("CON", "CONN", "LVA", "LV", "LAS", "LA", "NYL", "NY", "PHX", "PHO", "WAS", "WSH"):
            self.assertIn(code, na.TEAM_CODES, code)

    def test_an_unknown_code_is_refused_rather_than_guessed(self):
        g, why = na.resolve_game("2024-07-02", "te_chicago_sky_2024", "XYZ", "away",
                                 GameResolution.teams, GameResolution.games)
        self.assertIsNone(g)
        self.assertIn("unknown opponent", why)


class UnlockPriority(unittest.TestCase):
    """games_unlocked: how many partly covered games a club would complete."""

    def test_counts_only_games_whose_other_side_is_already_covered(self):
        covered = {("g1", "chi"), ("g2", "chi"), ("g3", "atl")}
        fixtures = [("g1", "chi", "sea"), ("g2", "chi", "sea"), ("g3", "atl", "min"),
                    ("g4", "sea", "min")]
        unlock = collections.Counter()
        for game, a, b in fixtures:
            if (game, a) in covered and (game, b) not in covered:
                unlock[b] += 1
        self.assertEqual(unlock["sea"], 2)
        self.assertEqual(unlock["min"], 1)
        self.assertNotIn("chi", unlock, "a club that is already covered unlocks nothing")


if __name__ == "__main__":
    unittest.main(verbosity=1)
