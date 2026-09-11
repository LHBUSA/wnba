"""Stage 10: promote reviewed stage-9 (Commons-category) candidates into the Git ledger.

Reads scripts/cache/discovery.json (stage 9 output) and data/photo-discovery-review.json (the recorded visual
review). An "approve" decision ships only if the stage-9 pick is unflagged, names the player at file level and
its staged derivatives exist. Every inspected player gets a `discovery` record (category, files inspected,
outcome) so the ledger explains why a photo does or does not exist.
"""
import shutil
from collections import Counter
from common import *

ROOT = os.path.dirname(BASE)
LEDGER = os.path.join(ROOT, "data", "player-photos.json")
REVIEW = os.path.join(ROOT, "data", "photo-discovery-review.json")
STAGE = os.path.join(BASE, "out-discovery")
MEDIA = os.path.join(ROOT, "public", "media", "players")
NOW = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

ledger = json.load(open(LEDGER, encoding="utf-8"))
disc = load_json("cache/discovery.json")
review = json.load(open(REVIEW, encoding="utf-8"))["decisions"]
by_pid = {r["espn_athlete_id"]: r for r in disc["results"]}


def attribution(s):
    artist = re.sub(r"\s+", " ", s.get("artist") or "Unknown author").strip()
    if len(artist) > 80:
        artist = artist[:77].rstrip() + "..."
    return f"Photo: {artist} / {s.get('license_short') or s.get('license_family')} via Wikimedia Commons (cropped)"


promoted, recorded = [], 0
for p in ledger["players"]:
    r = by_pid.get(p["espn_athlete_id"])
    if not r:
        continue
    dec = review.get(p["espn_athlete_id"])
    rec = {"method": "commons_category", "run_at": disc["generated_at"], "category": r.get("category") and "Category:" + r["category"],
           "category_source": r.get("category_source"), "files_inspected": r.get("files_listed", 0),
           "outcome": r["result"], "review": dec and {"decision": dec["decision"], "note": dec["note"]}}
    p["discovery"] = rec
    recorded += 1
    st = r.get("staged")
    if not (dec and dec["decision"] == "approve"):
        continue
    assert st and not st.get("flag") and not st.get("others_named") and st.get("identity_evidence_file"), p["display_name"]
    for k in ("portrait", "square"):
        assert os.path.exists(os.path.join(STAGE, p["espn_athlete_id"], f"{k}.webp")), (p["display_name"], k)
    ev = [f"name+dob exact match (ESPN {p['dob']})", f"wikidata {p['wikidata_qid']}", *st["identity_evidence_file"],
          f"file is in the item's own Commons {st['discovery']['category']} ({st['discovery']['category_source']})",
          f"reviewer: {dec['note']}"]
    img = {
        "commons_file": st["commons_file"], "p18_file": None,
        "source_page_url": st["source_page_url"], "original_url": st["original_url"],
        "license_short": st["license_short"], "license_family": st["license_family"], "license_url": st["license_url"],
        "artist": st["artist"], "credit": st["credit"], "attribution_text": attribution(st),
        "capture_date": st["capture_date"], "capture_year": st["capture_year"], "description": st["description"],
        "width": st["width"], "height": st["height"], "mime": st["mime"],
        "focal": st["focal"], "face_box": st["face_box"], "face_detector": st["face_detector"], "crops": st["crops"],
        "identity_confidence": "high", "identity_evidence": "; ".join(ev), "verified_at": NOW,
        "derivatives": {"portrait": f"public/media/players/{p['espn_athlete_id']}/portrait.webp",
                        "square": f"public/media/players/{p['espn_athlete_id']}/square.webp"},
        "review_status": "approved", "discovery": st["discovery"],
    }
    notes = [f"stage 9: found in the item's own Commons {st['discovery']['category']} after the P18 route failed"]
    if st.get("restrictions"):
        notes.append(f"commons restrictions: {st['restrictions']}")
    if (st["crops"]["portrait"]["out_h"] < 750) or (st["crops"]["square"]["out_h"] < 256):
        notes.append(f"source smaller than target: portrait {st['crops']['portrait']['out_w']}x{st['crops']['portrait']['out_h']} (not upscaled)")
    if p["status"] == "rejected":
        notes.append(f"previous P18 rejected: {p['reason']}")
    p.update(status="approved", reason="identity, license and visual crop review passed (Commons-category discovery)",
             notes=notes, image=img)
    dst = os.path.join(MEDIA, p["espn_athlete_id"])
    os.makedirs(dst, exist_ok=True)
    for k in ("portrait", "square"):
        shutil.copyfile(os.path.join(STAGE, p["espn_athlete_id"], f"{k}.webp"), os.path.join(dst, f"{k}.webp"))
    promoted.append(p["display_name"])

pl = ledger["players"]
st = Counter(p["status"] for p in pl)
appr = [p for p in pl if p["status"] == "approved"]
ledger["totals"] = {
    "active_players": len(pl),
    "matched_identity": sum(1 for p in pl if p.get("wikidata_qid")),
    "with_image": sum(1 for p in pl if p.get("image")),
    "license_ok": sum(1 for p in pl if p.get("image") and p["image"].get("license_family")),
    "approved": len(appr),
    "by_status": dict(st),
    "approved_by_license": dict(Counter(p["image"]["license_short"] for p in appr)),
    "approved_by_discovery": dict(Counter((p["image"].get("discovery") or {}).get("method", "p18") for p in appr)),
}
ledger["promoted_at"] = NOW
ledger["method"]["category_discovery"] = (
    "Stage 9 (scripts/photos/s9_category_discovery.py): for a verified identity whose P18 is missing or was rejected "
    "for an image problem, list at most 40 files (newest first, files only, no subcategories) of the item's own Commons "
    "category (P373, else a Category: commonswiki sitelink). Same license allowlist; jpeg/png/webp; short edge >= 500; "
    "the file itself must name the player (title/description) or depict the QID — category membership is never proof; "
    "one dominant face; stage-6 crop rules. Shipped only after the visual review recorded in "
    "data/photo-discovery-review.json (stage 10). No free-text image search.")
with open(LEDGER, 'w', encoding='utf-8', newline='') as fh:  # the ledger's own format: indent 1, UTF-8, no trailing newline
    fh.write(json.dumps(ledger, indent=1, ensure_ascii=False))
print("promoted", len(promoted), promoted)
print("discovery records", recorded)
print(json.dumps(ledger["totals"], indent=1))
