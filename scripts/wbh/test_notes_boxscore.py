#!/usr/bin/env python3
"""Tests for the game-notes box-score pipeline.

    python scripts/wbh/test_notes_boxscore.py

Synthetic word geometry stands in for PDFs, so the column-assignment logic is tested directly rather
than through a file. Both real layout families are exercised with their own coordinates.
"""
from __future__ import annotations

import json, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import notes_boxscore as nb
import notes_assemble as na
import notes_sql as ns


def words(row):
    """[(text, x0, x1, top)] -> pdfplumber-shaped word dicts."""
    return [{"text": t, "x0": x0, "x1": x1, "top": top, "bottom": top + 8} for t, x0, x1, top in row]


SKY_HEADER = [
    ("DATE", 15.4, 37.7, 100), ("OPP.", 47.9, 67.5, 100), ("G-GS", 78.2, 99.2, 100),
    ("MIN", 111.1, 128.4, 100), ("FGM-A", 136.4, 165.1, 100), ("FG%", 172.2, 191.3, 100),
    ("3PM-A", 198.4, 227.2, 100), ("3P%", 234.3, 253.4, 100), ("FTM-A", 260.9, 288.8, 100),
    ("FT%", 296.7, 315.1, 100), ("OREB", 325.2, 348.7, 100), ("DREB", 356.4, 379.5, 100),
    ("REB", 390.6, 407.3, 100), ("AST", 421.2, 438.8, 100), ("STL", 453.2, 468.8, 100),
    ("BLK", 483.6, 500.4, 100), ("TO", 517.1, 529.1, 100), ("PF", 549.0, 559.4, 100),
    ("PTS", 577.4, 593.5, 100),
]

DREAM_HEADER = [
    ("Date", 37.0, 51.2, 190), ("Opp", 66.8, 79.2, 190), ("GS", 87.9, 96.2, 190),
    ("MP", 107.3, 116.7, 190), ("FGM-A", 132.1, 151.9, 190), ("3PM-A", 169.3, 188.7, 190),
    ("FTM-A", 206.6, 225.5, 190), ("OREB", 241.7, 258.4, 190), ("DREB", 272.8, 289.2, 190),
    ("REB", 302.1, 314.0, 190), ("AST", 327.3, 338.7, 190), ("STL", 349.7, 360.4, 190),
    ("BLK", 370.3, 381.8, 190), ("TO", 391.9, 400.1, 190), ("PF", 412.3, 419.8, 190),
    ("PTS", 432.4, 443.7, 190),
]


class FakePage:
    def __init__(self, rows):
        self._words = words(rows)

    def extract_words(self, **_):
        return self._words


def sky_row(y, cells):
    """cells in header order after DATE: builds a row on the Sky x-grid."""
    xs = [(16.7, 36.6), (51.5, 63.7), (83.1, 95.7), (115.2, 124.7), (145.1, 156.8), (174.1, 187.8),
          (207.2, 218.8), (236.1, 249.8), (269.2, 280.9), (298.7, 311.9), (334.6, 338.9),
          (365.7, 369.9), (396.7, 401.0), (427.7, 432.0), (458.7, 463.0), (489.8, 494.0),
          (520.8, 525.1), (551.9, 556.2), (583.2, 587.4)]
    return [(c, xs[i][0], xs[i][1], y) for i, c in enumerate(cells) if c is not None]


class ColumnAssignment(unittest.TestCase):
    def test_header_detection_sky(self):
        page = FakePage(SKY_HEADER + sky_row(110, ["05.15", "DAL", "1-1", "34", "4-8", "50.0", "0-0",
                                                   "-", "4-6", "66.7", "5", "3", "8", "1", "1", "1",
                                                   "4", "3", "12"]))
        rows = nb.cluster_rows(page.extract_words())
        header, cols = nb.find_header(rows, nb.LAYOUTS["sky_2024"])
        self.assertIsNotNone(cols)
        self.assertEqual([c[0] for c in cols][:5], ["DATE", "OPP.", "G-GS", "MIN", "FGM-A"])

    def test_header_detection_dream(self):
        page = FakePage(DREAM_HEADER)
        rows = nb.cluster_rows(page.extract_words())
        _, cols = nb.find_header(rows, nb.LAYOUTS["dream_2024"])
        self.assertIsNotNone(cols)
        self.assertIn("MP", [c[0] for c in cols])

    def test_required_headers_missing_is_refused(self):
        page = FakePage([h for h in SKY_HEADER if h[0] not in ("FGM-A", "PTS")])
        rows = nb.cluster_rows(page.extract_words())
        _, cols = nb.find_header(rows, nb.LAYOUTS["sky_2024"])
        self.assertIsNone(cols)

    def test_cells_land_in_their_own_columns(self):
        page = FakePage(SKY_HEADER + [("#1", 192, 210, 58), ("ELIZABETH", 220, 320, 58),
                                      ("WILLIAMS", 325, 420, 58)]
                        + sky_row(110, ["05.15", "DAL", "1-1", "34", "4-8", "50.0", "0-0", "-",
                                        "4-6", "66.7", "5", "3", "8", "1", "1", "1", "4", "3", "12"]))
        out = nb.extract_player_rows(page, nb.LAYOUTS["sky_2024"], 2024)
        row = out["rows"][0]
        self.assertEqual(row["status"], "ok")
        self.assertEqual((row["field_goals_made"], row["field_goals_attempted"]), (4, 8))
        self.assertEqual((row["free_throws_made"], row["free_throws_attempted"]), (4, 6))
        self.assertEqual((row["offensive_rebounds"], row["defensive_rebounds"], row["rebounds"]), (5, 3, 8))
        self.assertEqual(row["points"], 12)
        self.assertEqual(row["personal_fouls"], 3)
        self.assertEqual(row["turnovers"], 4)

    def test_last_column_is_closed_against_a_side_panel(self):
        """A side panel to the right of PTS must not be swallowed by the last column."""
        page = FakePage(DREAM_HEADER + [
            ("#7", 37, 50, 170), ("LAETICIA", 55, 110, 170), ("AMIHERE", 115, 170, 170),
            ("5/15", 36.9, 43.9, 200), ("@LAS", 63, 80, 200), ("2:36", 104.4, 111.9, 200),
            ("1-1", 137.9, 141.9, 200), ("0-0", 173.1, 178.9, 200), ("0-0", 210.1, 215.9, 200),
            ("0", 247.8, 249.9, 200), ("0", 278.6, 280.9, 200), ("0", 305.6, 307.9, 200),
            ("0", 330.6, 332.9, 200), ("0", 353.5, 354.9, 200), ("0", 373.6, 375.9, 200),
            ("0", 393.6, 395.9, 200), ("0", 414.5, 415.9, 200), ("2", 435.7, 437.9, 200),
            ("Points", 456, 480, 200), ("6", 536, 540, 200),
        ])
        out = nb.extract_player_rows(page, nb.LAYOUTS["dream_2024"], 2024)
        row = out["rows"][0]
        self.assertEqual(row["points"], 2, "the side panel must not collide with PTS")
        self.assertEqual(row["seconds_played"], 156)


class Parsing(unittest.TestCase):
    def test_made_attempted(self):
        self.assertEqual(nb.parse_made_attempted("4-8"), (4, 8))
        self.assertEqual(nb.parse_made_attempted("0-0"), (0, 0))
        self.assertEqual(nb.parse_made_attempted("-"), (None, None))
        self.assertEqual(nb.parse_made_attempted("NP"), ("malformed", "malformed"))

    def test_minutes_to_seconds(self):
        self.assertEqual(nb.parse_minutes("34", "int"), 34 * 60)
        self.assertEqual(nb.parse_minutes("2:36", "mmss"), 156)
        self.assertEqual(nb.parse_minutes("0:53", "mmss"), 53)
        self.assertIsNone(nb.parse_minutes("-", "mmss"))
        self.assertEqual(nb.parse_minutes("oops", "int"), "malformed")

    def test_zero_is_a_value_and_dash_is_not(self):
        self.assertEqual(nb.parse_int("0"), 0)
        self.assertIsNone(nb.parse_int("-"))
        self.assertIsNone(nb.parse_int(None))

    def test_opponent_and_venue(self):
        self.assertEqual(nb.parse_opponent("@ DAL"), ("DAL", "away"))
        self.assertEqual(nb.parse_opponent("CON"), ("CON", "home"))
        self.assertEqual(nb.parse_opponent("vs. MIN"), ("MIN", "home"))


class RowValidation(unittest.TestCase):
    def base(self, **over):
        rec = {"ambiguities": [], "date": "2024-05-15", "opponent_code": "DAL", "seconds_played": 600,
               "field_goals_made": 2, "field_goals_attempted": 4, "three_pointers_made": 1,
               "three_pointers_attempted": 2, "free_throws_made": 1, "free_throws_attempted": 1,
               "offensive_rebounds": 1, "defensive_rebounds": 2, "rebounds": 3, "assists": 0,
               "steals": 0, "blocks": 0, "turnovers": 0, "personal_fouls": 1, "points": 6}
        rec.update(over)
        return rec

    def test_good_row_passes(self):
        self.assertEqual(nb.validate_row(self.base())[0], "ok")

    def test_points_must_match_the_made_shots(self):
        status, reasons = nb.validate_row(self.base(points=7))
        self.assertEqual(status, "hold")
        self.assertTrue(any("points 7" in r for r in reasons))

    def test_made_cannot_exceed_attempted(self):
        status, reasons = nb.validate_row(self.base(field_goals_made=9, field_goals_attempted=4, points=6))
        self.assertEqual(status, "hold")
        self.assertTrue(any("made 9 > attempted 4" in r for r in reasons))

    def test_rebounds_must_add_up(self):
        status, reasons = nb.validate_row(self.base(offensive_rebounds=4, defensive_rebounds=0, rebounds=0))
        self.assertEqual(status, "hold")
        self.assertTrue(any("OREB + DREB" in r for r in reasons))

    def test_negative_stat_is_refused(self):
        self.assertEqual(nb.validate_row(self.base(assists=-1))[0], "hold")

    def test_ambiguous_cell_holds_the_row(self):
        self.assertEqual(nb.validate_row(self.base(ambiguities=["'4' sits on a column edge"]))[0], "hold")

    def test_missing_optional_field_is_not_a_failure(self):
        rec = self.base(offensive_rebounds=None, defensive_rebounds=None)
        self.assertEqual(nb.validate_row(rec)[0], "ok")


class NonParticipation(unittest.TestCase):
    def test_dnp_is_only_set_when_stated(self):
        page = FakePage(DREAM_HEADER + [
            ("#2", 37, 50, 170), ("JORDIN", 55, 100, 170), ("CANADA", 105, 160, 170),
            ("5/21", 36, 44, 222), ("vs.", 60, 68, 222), ("DAL", 71, 85, 222),
            ("D", 215, 220, 222), ("NP", 221, 231, 222), ("-", 232, 235, 222),
            ("Coach's", 236, 264, 222), ("Decision", 265, 300, 222),
        ])
        out = nb.extract_player_rows(page, nb.LAYOUTS["dream_2024"], 2024)
        self.assertEqual(out["rows"][0]["status"], "dnp")
        self.assertTrue(out["rows"][0]["did_not_play"])

    def test_not_with_team_is_not_a_dnp_and_emits_no_stats(self):
        page = FakePage(DREAM_HEADER + [
            ("#7", 37, 50, 170), ("LAETICIA", 55, 110, 170), ("AMIHERE", 115, 170, 170),
            ("7/12", 36, 44, 222), ("vs.", 60, 68, 222), ("LVA", 71, 85, 222),
            ("N", 215, 220, 222), ("WT", 221, 231, 222), ("-", 232, 235, 222),
            ("International", 236, 290, 222),
        ])
        row = nb.extract_player_rows(page, nb.LAYOUTS["dream_2024"], 2024)["rows"][0]
        self.assertEqual(row["status"], "nonparticipation")
        self.assertIsNone(row["did_not_play"])

    def test_sky_zero_game_marker_is_non_participation(self):
        page = FakePage(SKY_HEADER + [("#0", 192, 210, 58), ("DIAMOND", 220, 300, 58),
                                      ("DESHIELDS", 305, 400, 58)]
                        + sky_row(110, ["05.23", "NYL", "0-0"] + ["-"] * 16))
        row = nb.extract_player_rows(page, nb.LAYOUTS["sky_2024"], 2024)["rows"][0]
        self.assertEqual(row["status"], "nonparticipation")
        self.assertIsNone(row["seconds_played"])

    def test_started_comes_from_the_source_only(self):
        page = FakePage(SKY_HEADER + [("#1", 192, 210, 58), ("ELIZABETH", 220, 320, 58),
                                      ("WILLIAMS", 325, 420, 58)]
                        + sky_row(110, ["05.15", "DAL", "1-0", "34", "4-8", "50.0", "0-0", "-",
                                        "4-6", "66.7", "5", "3", "8", "1", "1", "1", "4", "3", "12"]))
        self.assertIs(nb.extract_player_rows(page, nb.LAYOUTS["sky_2024"], 2024)["rows"][0]["started"], False)


class Identity(unittest.TestCase):
    roster = {"te_chicago_sky_2024": [
        {"person_id": "gp_AAAAAAAAAAAA", "name": "Angel Reese"},
        {"person_id": "gp_BBBBBBBBBBBB", "name": "Cheyenne Parker"},
        {"person_id": "gp_CCCCCCCCCCCC", "name": "Dana Evans"},
    ]}

    def test_exact_roster_match(self):
        pid, tier, _, _ = na.resolve_person("ANGEL REESE", "te_chicago_sky_2024", self.roster)
        self.assertEqual((pid, tier), ("gp_AAAAAAAAAAAA", "roster_exact"))

    def test_married_name_variant_is_resolved_but_reported(self):
        pid, tier, note, _ = na.resolve_person("CHEYENNE PARKER-TYUS", "te_chicago_sky_2024", self.roster)
        self.assertEqual(pid, "gp_BBBBBBBBBBBB")
        self.assertEqual(tier, "roster_name_variant")
        self.assertIn("shared surname component", note)

    def test_unknown_name_is_held_not_invented(self):
        pid, _, _, why = na.resolve_person("SOMEBODY ELSE", "te_chicago_sky_2024", self.roster)
        self.assertIsNone(pid)
        self.assertIn("no match", why)

    def test_league_unique_tier_is_off_by_default(self):
        persons = {na.normalize_name("Rachel Banham"): [{"person_id": "gp_DDDDDDDDDDDD", "name": "Rachel Banham"}]}
        pid, _, _, _ = na.resolve_person("RACHEL BANHAM", "te_chicago_sky_2024", self.roster, persons, False)
        self.assertIsNone(pid, "must not resolve outside the roster unless explicitly allowed")
        pid, tier, _, _ = na.resolve_person("RACHEL BANHAM", "te_chicago_sky_2024", self.roster, persons, True)
        self.assertEqual((pid, tier), ("gp_DDDDDDDDDDDD", "league_unique_in_club_document"))

    def test_two_people_of_the_same_name_are_never_merged(self):
        persons = {na.normalize_name("Jane Doe"): [{"person_id": "gp_1", "name": "Jane Doe"},
                                                   {"person_id": "gp_2", "name": "Jane Doe"}]}
        pid, _, _, why = na.resolve_person("JANE DOE", "te_chicago_sky_2024", self.roster, persons, True)
        self.assertIsNone(pid)
        self.assertIn("ambiguous", why)


class GameResolution(unittest.TestCase):
    teams = {"Chicago Sky": "te_chicago_sky_2024", "Atlanta Dream": "te_atlanta_dream_2024"}
    games = [{"game_id": "gm_x", "date": "2024-07-02", "home": "te_atlanta_dream_2024",
              "away": "te_chicago_sky_2024", "home_points": 77, "away_points": 85, "ot": 0}]

    def test_resolves_by_date_and_pair(self):
        g, why = na.resolve_game("2024-07-02", "te_chicago_sky_2024", "ATL", "away", self.teams, self.games)
        self.assertEqual(g["game_id"], "gm_x")
        self.assertIsNone(why)

    def test_unknown_opponent_code_fails_closed(self):
        g, why = na.resolve_game("2024-07-02", "te_chicago_sky_2024", "ZZZ", "away", self.teams, self.games)
        self.assertIsNone(g)
        self.assertIn("unknown opponent", why)

    def test_no_canonical_game_is_held(self):
        g, why = na.resolve_game("2024-07-03", "te_chicago_sky_2024", "ATL", "away", self.teams, self.games)
        self.assertIsNone(g)
        self.assertIn("0 canonical games", why)


class TeamGameValidation(unittest.TestCase):
    """The assembler's whole-team gates, exercised through assemble()."""

    def artifact(self, rows, team="Chicago Sky"):
        return {"team": team, "layout": "sky_2024", "layout_family": "A",
                "source_url": "https://example.invalid/notes.pdf", "source_sha256": "a" * 64,
                "pages_with_tables": [1],
                "players": [{"page": 1, "number": str(i), "name": r.pop("name"), "headers": [],
                             "column_x": {}, "rows": [r]} for i, r in enumerate(rows)]}

    def row(self, name, points, seconds, **over):
        rec = {"name": name, "status": "ok", "date": "2024-07-02", "opponent_code": "ATL",
               "home_away": "away", "raw_text": "", "ambiguities": [], "did_not_play": False,
               "started": True, "seconds_played": seconds, "points": points, "plus_minus": None}
        for f in na.STAT_FIELDS:
            rec.setdefault(f, None)
        rec["points"], rec["seconds_played"] = points, seconds
        rec.update(over)
        return rec

    def setUp(self):
        self.teams = GameResolution.teams
        self.games = GameResolution.games
        self.roster = {"te_chicago_sky_2024": [
            {"person_id": "gp_1", "name": "A One"}, {"person_id": "gp_2", "name": "B Two"}]}

    def test_reconciling_team_game_is_accepted(self):
        art = self.artifact([self.row("A ONE", 40, 6000), self.row("B TWO", 45, 6060)])
        out = na.assemble([art], self.teams, self.games, self.roster)
        self.assertEqual(len(out["team_games"]), 1)
        self.assertEqual(out["team_games"][0]["points_sum"], 85)

    def test_points_mismatch_holds_the_whole_team_game(self):
        art = self.artifact([self.row("A ONE", 40, 6000), self.row("B TWO", 44, 6060)])
        out = na.assemble([art], self.teams, self.games, self.roster)
        self.assertEqual(out["team_games"], [])
        self.assertTrue(any("player points sum" in p["reason"]
                            for h in out["held"] for p in h.get("problems", [])))

    def test_impossible_minutes_hold_the_team_game(self):
        art = self.artifact([self.row("A ONE", 40, 3000), self.row("B TWO", 45, 3000)])
        out = na.assemble([art], self.teams, self.games, self.roster)
        self.assertEqual(out["team_games"], [])
        self.assertTrue(any("minutes total" in p["reason"]
                            for h in out["held"] for p in h.get("problems", [])))

    def test_overtime_raises_the_minute_expectation(self):
        games = [dict(self.games[0], ot=1)]
        art = self.artifact([self.row("A ONE", 40, 6750), self.row("B TWO", 45, 6750)])
        out = na.assemble([art], self.teams, games, self.roster)
        self.assertEqual(len(out["team_games"]), 1, "225 player-minutes is right for one overtime")

    def test_unresolved_identity_holds_the_team_game(self):
        art = self.artifact([self.row("A ONE", 40, 6000), self.row("NOT ON ROSTER", 45, 6060)])
        out = na.assemble([art], self.teams, self.games, self.roster)
        self.assertEqual(out["team_games"], [])

    def test_extraction_is_deterministic(self):
        art = self.artifact([self.row("A ONE", 40, 6000), self.row("B TWO", 45, 6060)])
        first = na.assemble([art], self.teams, self.games, self.roster)
        art2 = self.artifact([self.row("A ONE", 40, 6000), self.row("B TWO", 45, 6060)])
        second = na.assemble([art2], self.teams, self.games, self.roster)
        self.assertEqual(json.dumps(first["team_games"], sort_keys=True),
                         json.dumps(second["team_games"], sort_keys=True))


class GeneratedSql(unittest.TestCase):
    def assembled(self):
        return {"team_games": [{
            "game_id": "gm_x", "date": "2024-07-02", "team_edition_id": "te_chicago_sky_2024",
            "side": "away", "canonical_points": 85, "layout": "sky_2024",
            "source_url": "https://example.invalid/notes.pdf", "source_sha256": "a" * 64,
            "players": 1, "participants": 1, "points_sum": 85, "minutes_sum": 200.0,
            "rows": [{"person_id": "gp_1", "identity_tier": "roster_exact", "did_not_play": False,
                      "started": True, "points": 85, "seconds_played": 12000, "plus_minus": None,
                      "field_goals_made": 30, "field_goals_attempted": 60,
                      "three_pointers_made": 5, "three_pointers_attempted": 10,
                      "free_throws_made": 20, "free_throws_attempted": 22,
                      "offensive_rebounds": None, "defensive_rebounds": None, "rebounds": 10,
                      "assists": 5, "steals": 2, "blocks": 1, "turnovers": 3, "personal_fouls": 4}],
            "problems": [], "status": "ok"}]}

    def test_sql_checks_the_rights_gate_and_is_idempotent(self):
        sql, stats = ns.build(self.assembled(), "test_dataset_v1")
        self.assertIn("wbh_assert_ingestible('pbe_curation')", sql)
        self.assertIn("if v_existing > 0 then return; end if;", sql)
        self.assertIn("do not reconcile to the canonical score", sql)
        self.assertEqual(stats["player_rows"], 1)

    def test_missing_values_are_written_as_null_not_zero(self):
        sql, _ = ns.build(self.assembled(), "test_dataset_v1")
        insert = [l for l in sql.split("\n") if l.strip().startswith("values ('gm_x'")][0]
        self.assertIn("null", insert)
        self.assertNotIn(", 0,", insert.split("12000")[1][:40])

    def test_completeness_never_claims_full(self):
        sql, _ = ns.build(self.assembled(), "test_dataset_v1")
        self.assertIn("set completeness = 'box_score'", sql)
        self.assertNotIn("completeness = 'full'", sql)
        # and the upgrade only fires when both clubs are present
        self.assertIn("count(distinct s.team_edition_id)", sql)


if __name__ == "__main__":
    unittest.main(verbosity=1)
