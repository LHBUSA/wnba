"""Stage 8: manifest.json + coverage.md. Derivatives are kept only for approved players."""
import shutil
from collections import Counter
from common import *

roster = load_json("cache/roster.json")
match = load_json("cache/match.json")
commons = load_json("cache/commons.json")
crops = load_json("cache/crops.json")
dec = load_json("review/decisions.json")
overrides = load_json("review/overrides.json", {})
MIN_PORTRAIT_H = 280
NOW = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
OUT = os.path.join(BASE, "out")


def attribution(c):
    artist = c.get("artist") or "Unknown author"
    artist = re.sub(r"\s+", " ", artist).strip()
    if len(artist) > 80:
        artist = artist[:77].rstrip() + "..."
    lic = c.get("license_short") or c.get("license_family")
    return f"Photo: {artist} / {lic} via Wikimedia Commons (cropped)"


players = []
for p in roster["players"]:
    pid = p["espn_athlete_id"]
    m = match[pid]
    e = {"espn_athlete_id": pid, "display_name": p["display_name"], "team_id": p["team_id"], "team_abbr": p["team_abbr"],
         "jersey": p["jersey"], "position": p["position"],
         "wikidata_qid": m.get("qid"), "wnba_com_id": m.get("wnba_com_id"), "dob": p["dob"],
         "status": None, "reason": None, "notes": [], "image": None}
    if m["status"] != "matched":
        e.update(status="no_identity_match", reason=m["reason"])
        players.append(e)
        continue
    r = crops.get(pid, {})
    if r.get("status") == "no_image":
        e.update(status="no_image", reason=r["reason"])
        players.append(e)
        continue
    if r.get("status") == "license_rejected":
        e.update(status="license_rejected", reason=r["reason"])
        players.append(e)
        continue
    f = r["file"]
    c = commons[f]
    ev_parts = [f"name+dob exact match (ESPN {p['dob']})", f"wikidata {m['qid']}"]
    for x in r.get("identity_ev") or []:
        ev_parts.append(x)
    sec = r.get("secondary") or {}
    if sec.get("categories_with_name"):
        ev_parts.append("commons category: " + ", ".join(sec["categories_with_name"]))
    if sec.get("other_roster_players_named"):
        ev_parts.append("NOTE other roster players named on file page: " + ", ".join(sec["other_roster_players_named"]))
    ov = overrides.get(pid, {})
    if ov.get("note"):
        ev_parts.append("reviewer: " + ov["note"])
    idr = (dec.get("identity_review") or {}).get(pid)
    if idr:
        ev_parts.append("reviewer: " + idr)
    high = bool(r.get("identity_ev")) and not idr
    img = {
        "commons_file": "File:" + f,
        "p18_file": ("File:" + r["parent_of"]) if r.get("parent_of") else ("File:" + f),
        "source_page_url": c["source_page_url"], "original_url": c["original_url"].split("?")[0],
        "license_short": c["license_short"], "license_family": c["license_family"], "license_url": c["license_url"],
        "artist": c["artist"], "credit": c["credit"], "attribution_text": attribution(c),
        "capture_date": c["capture_date"], "capture_year": c["capture_year"],
        "description": c["description"], "width": c["width"], "height": c["height"], "mime": c["mime"],
        "focal": r.get("focal"), "face_box": r.get("face_box"), "face_detector": r.get("face_src"),
        "crops": None,
        "identity_confidence": "high" if high else "review",
        "identity_evidence": "; ".join(ev_parts),
        "verified_at": NOW,
    }
    if r.get("parent_of"):
        e["notes"].append(f"uses the uncropped parent of the P18 file (P18 frame clipped the head); same subject located by template match")
    if c.get("capture_year") and c["capture_year"] < 2016:
        e["notes"].append(f"photo captured {c['capture_year']} (< 2016)")
    if c.get("restrictions"):
        e["notes"].append(f"commons restrictions: {c['restrictions']}")
    if (dec.get("notes") or {}).get(pid):
        e["notes"].append((dec["notes"])[pid])
    cr = r.get("crops")
    reject = (dec.get("reject") or {}).get(pid)
    if not reject and not cr:
        reject = r.get("flag") or "no usable face detected"
    if not reject and r.get("flag") == "multi_face_review":
        reject = "multi_face_review: several similar-size faces, target ambiguous"
    if not reject and cr["portrait"]["out_h"] < MIN_PORTRAIT_H:
        reject = f"low resolution: portrait crop only {cr['portrait']['out_w']}x{cr['portrait']['out_h']} px"
    if reject:
        e.update(status="rejected", reason=reject)
        d = os.path.join(OUT, pid)
        if os.path.isdir(d):
            shutil.rmtree(d)
    else:
        img["crops"] = {k: {kk: v[kk] for kk in ("x", "y", "w", "h", "out_w", "out_h", "face_frac", "eye_frac")}
                        for k, v in cr.items()}
        for k, v in img["crops"].items():  # thumb->original rounding can overshoot the edge by a few px
            a = v["w"] / v["h"]
            s = min(1.0, (c["width"] - v["x"]) / v["w"], (c["height"] - v["y"]) / v["h"])
            if s < 1.0:
                v["h"] = int(v["h"] * s)
                v["w"] = int(round(v["h"] * a))
        img["derivatives"] = {"portrait": f"out/{pid}/portrait.webp", "square": f"out/{pid}/square.webp"}
        if cr["portrait"]["out_h"] < 750 or cr["square"]["out_h"] < 256:
            e["notes"].append(f"source smaller than target: portrait {cr['portrait']['out_w']}x{cr['portrait']['out_h']}, "
                              f"square {cr['square']['out_w']}x{cr['square']['out_h']} (not upscaled)")
        e.update(status="approved", reason="identity, license and visual crop review passed" +
                 ("" if high else " (identity_confidence=review, see identity_evidence)"))
    img["review_status"] = "approved" if e["status"] == "approved" else "rejected"
    e["image"] = img
    players.append(e)

# sanity: no derivative dirs for non-approved
appr = {p["espn_athlete_id"] for p in players if p["status"] == "approved"}
for dname in os.listdir(OUT):
    if dname not in appr:
        shutil.rmtree(os.path.join(OUT, dname))
for pid in appr:
    for k in ("portrait", "square"):
        assert os.path.exists(os.path.join(OUT, pid, f"{k}.webp")), pid

st = Counter(p["status"] for p in players)
lic = Counter(p["image"]["license_short"] for p in players if p["status"] == "approved")
licfam = Counter(p["image"]["license_family"] for p in players if p["status"] == "approved")
totals = {
    "active_players": len(players),
    "matched_identity": sum(1 for p in players if p["wikidata_qid"]),
    "with_image": sum(1 for p in players if p["image"]),
    "license_ok": sum(1 for p in players if p["image"] and p["image"]["license_family"]),
    "approved": st["approved"],
    "approved_identity_high": sum(1 for p in players if p["status"] == "approved" and p["image"]["identity_confidence"] == "high"),
    "approved_identity_review": sum(1 for p in players if p["status"] == "approved" and p["image"]["identity_confidence"] == "review"),
    "by_status": dict(st),
    "approved_by_license": dict(lic),
    "approved_by_license_family": dict(licfam),
}
method = {
    "roster": "ESPN site.web.api.espn.com /apis/site/v2/sports/basketball/wnba/teams (15) + /teams/{id}/roster; every athlete "
              "listed (all status.type=active). DOB = date part of athlete.dateOfBirth. ESPN images NOT used.",
    "identity": "Deterministic. Candidates: SPARQL bulk of all Wikidata items with P3588 (WNBA.com ID) plus wbsearchentities "
                "for every player (so uniqueness is checked beyond the P3588 set), then wbgetentities for full claims. Match only if "
                "(a) P31=Q5 and (P3588 present or P641=Q5372 basketball or P106=Q3665646 basketball player); (b) normalized ESPN "
                "displayName/fullName equals an English label/alias (languages en, mul, en-us, en-gb, en-ca; normalize = NFKD strip "
                "diacritics, casefold, hyphen->space, drop punctuation, collapse whitespace; suffixes kept literally); (c) best-rank "
                "day-precision P569 equals ESPN DOB exactly (conflicting P569 values => no match). Exactly one item must pass; "
                "0 or >1 => no_identity_match.",
    "image": "P18 of the matched item. If the P18 frame clips the head and the Commons page has {{Extracted from|parent}}, "
             "the uncropped parent is used instead, with the P18 subject located inside it by template matching (score>=0.85).",
    "license": "Commons extmetadata. Accept CC0, Public domain, CC BY (any version), CC BY-SA (any version). Reject NC, ND, "
               "NonFree/fair use, missing or other licenses.",
    "commons_identity_check": "identity_confidence=high requires the player's surname in the file title/description or "
                              "Commons depicts (P180) = matched QID, and no reviewer-judgement dependency. Otherwise 'review'. "
                              "Also flagged: other roster players named on the file page; Commons categories recorded as "
                              "secondary evidence.",
    "face_detection": "OpenCV Haar frontalface_default (+alt2 confirmation, profile fallback) per brief, cross-validated with "
                      "OpenCV YuNet (face_detection_yunet_2023mar.onnx, sha256 8f2383e4...ed2552fa4) because Haar alone "
                      "picked balls/shoes/crowd. Largest YuNet face (score>=0.8) wins; another >=70% as wide => "
                      "multi_face_review (resolved only by manual reviewer selection, recorded in identity_evidence).",
    "crops": "portrait 4:5 600x750, face height target 33% (28-38%), eyes ~40% from top; square 1:1 256x256, face ~46% "
             "(45-55%), eyes ~42%. Head box = face box +45% upward +10% headroom, +12% each side; crop grows to contain it. "
             "Clamped to source; never stretched or upscaled (smaller output recorded as out_w/out_h). Source too small => "
             "largest crop at target aspect (face fraction may exceed range; noted). WebP q82. Crop coords are in original "
             "Commons pixels of image.commons_file.",
    "review": f"Every derivative inspected on contact sheets (review/sheet-XX.png) plus source, alternate, top-of-head and "
              f"focus sheets. Rejected: head clipped by source frame, ambiguous subject, occluded face, portrait < "
              f"{MIN_PORTRAIT_H}px tall.",
}
manifest = {"generated_at": NOW, "method": method,
            "roster_source": {"teams": "https://site.web.api.espn.com/apis/site/v2/sports/basketball/wnba/teams",
                              "roster": "https://site.web.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/{teamId}/roster",
                              "fetched_at": roster["fetched_at"], "season": roster["seasons"], "teams_count": len(roster["teams"])},
            "totals": totals, "players": players}
save_json("manifest.json", manifest)

# ---- coverage.md ----
L = []
L.append("# WNBA player photo coverage\n")
L.append(f"Generated {NOW}. Roster: ESPN (15 teams, 2026 regular season). Manifest: `manifest.json`.\n")
L.append("| metric | count |\n|---|---|")
for k in ("active_players", "matched_identity", "with_image", "license_ok", "approved", "approved_identity_high",
          "approved_identity_review"):
    L.append(f"| {k} | {totals[k]} |")
L.append("\n## Status breakdown\n")
L.append("| status | count |\n|---|---|")
for k, v in sorted(st.items(), key=lambda x: -x[1]):
    L.append(f"| {k} | {v} |")
L.append("\n## Approved by license\n")
L.append("| license | count |\n|---|---|")
for k, v in sorted(lic.items(), key=lambda x: -x[1]):
    L.append(f"| {k} | {v} |")
L.append("\n## Approved but identity_confidence = review\n")
L.append("| espn id | player | team | why |\n|---|---|---|---|")
for p in players:
    if p["status"] == "approved" and p["image"]["identity_confidence"] == "review":
        why = (dec.get("identity_review") or {}).get(p["espn_athlete_id"], "surname not in Commons title/description/depicts")
        L.append(f"| {p['espn_athlete_id']} | {p['display_name']} | {p['team_abbr']} | {why} |")
L.append("\n## Not approved (full list)\n")
L.append("| espn id | player | team | status | reason |\n|---|---|---|---|---|")
order = {"rejected": 0, "license_rejected": 1, "no_identity_match": 2, "no_image": 3}
for p in sorted([p for p in players if p["status"] != "approved"], key=lambda p: (order[p["status"]], p["team_abbr"], p["display_name"])):
    L.append(f"| {p['espn_athlete_id']} | {p['display_name']} | {p['team_abbr']} | {p['status']} | {p['reason']} |")
L.append("\n## Notes on approved entries\n")
for p in players:
    if p["status"] == "approved" and p["notes"]:
        L.append(f"- {p['espn_athlete_id']} {p['display_name']}: " + "; ".join(p["notes"]))
with open(os.path.join(BASE, "coverage.md"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(L) + "\n")
print(json.dumps(totals, indent=1))
