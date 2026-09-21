"""Stage 9: Commons-category discovery for players whose VERIFIED Wikidata identity has no usable P18.

Ported from the UFC fighter-portrait worker (LHBUSA/UFC scripts/images/fetch_fighter_portraits.mjs
categoryName/findCommonsCategoryFallback), tightened to the WNBA photo rules:

  * Only players already matched by exact name + exact DOB (ledger wikidata_qid) whose P18 is missing or
    was rejected for an image problem (head clipped, low resolution, face hidden, crowded frame). Identity
    holds (jersey/category-only matches) and license holds are NOT candidates: their problem is not the file.
  * The QID is re-checked live: P31=Q5 and best-rank day-precision P569 == ledger DOB, else skipped.
  * Category = the item's own P373 (first claim) or its commonswiki sitelink when that is a Category: page.
    Exactly that category, files only (cmtype=file), no subcategory recursion, newest uploads first,
    at most MAX_FILES files. No free-text / global image search, ever.
  * Per file: license allowlist (CC0 / PD / CC BY / CC BY-SA; NC, ND, non-free rejected — commonsmeta.classify),
    jpeg/png/webp, short edge >= MIN_EDGE, aspect 0.38-1.8.
  * Identity: category membership is NOT identity proof (the UFC gate reads categories and so passes every
    member, group shots included). Primary evidence must come from the file itself: the player's surname in
    the file title/description, or Commons depicts (P180) = the QID. Another rostered player named on the
    page, or depicts naming other people, flags the file.
  * Faces: same Haar + YuNet detector as stage 5; exactly one dominant face (multi-face => review only).
  * Crops: croplib (identical to stage 6); head fully inside the source; portrait >= 280 px tall.
  * Nothing ships from here: output is a candidate report + staged derivatives + contact sheets. Shipping
    requires a recorded visual review in data/photo-discovery-review.json and scripts/photos/s10_promote.py.
"""
import sys
from common import *
from commonsmeta import fetch_records, API
from croplib import SPECS, pick_face, compute_crop, render, open_img, YN_MIN
from s5_detect import detect, iou
from PIL import Image, ImageDraw, ImageFont

LEDGER = os.path.join(os.path.dirname(BASE), "data", "player-photos.json")
MAX_FILES = 40
MIN_EDGE = 500
MIN_PORTRAIT_H = 280
ASPECT = (0.38, 1.8)
MIMES = {"image/jpeg", "image/png", "image/webp"}
STAGE = os.path.join(BASE, "out-discovery")
IMG = os.path.join(CACHE, "img9")
os.makedirs(IMG, exist_ok=True)

ledger = json.load(open(LEDGER, encoding="utf-8"))
players = ledger["players"]
roster_names = {p["espn_athlete_id"]: p["display_name"] for p in players}
qid_to_pid = {p["wikidata_qid"]: p["espn_athlete_id"] for p in players if p.get("wikidata_qid")}

IMAGE_PROBLEM = re.compile(r"clips the top of the head|low resolution|face largely hidden|multiple similar-size faces|"
                           r"wide game photo|names a different player", re.I)


def is_candidate(p):
    if not p.get("wikidata_qid"):
        return False
    if p["status"] == "no_image":
        return True
    # An approved photo can be factually correct and still wrong for the
    # product: a college-uniform frame is not the visual identity of a WNBA
    # ranking. Such a player is a candidate only when the ledger names the
    # reason, per player. No identity, license, face or crop rule is relaxed
    # here, and nothing ships without a recorded review plus s10_promote.
    if p["status"] == "approved":
        return bool((p.get("upgrade_review") or {}).get("reason"))
    if p["status"] == "rejected":
        r = p.get("reason") or ""
        if r.startswith("held:") and "face largely hidden" not in r:
            return False  # identity-review and license holds: the file was not the problem
        return bool(IMAGE_PROBLEM.search(r))
    return False


def entity(qid):
    return http_json(f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json")["entities"][qid]


def best_dob(e):
    vals = []
    for c in e.get("claims", {}).get("P569", []):
        dv = c.get("mainsnak", {}).get("datavalue")
        if dv:
            vals.append((c.get("rank"), dv["value"]["time"].lstrip("+")[:10], dv["value"]["precision"]))
    pref = [v for v in vals if v[0] == "preferred"]
    use = pref or [v for v in vals if v[0] == "normal"]
    days = sorted({v[1] for v in use if v[2] >= 11})
    return days


def category_of(e):
    p373 = (e.get("claims", {}).get("P373") or [{}])[0].get("mainsnak", {}).get("datavalue", {}).get("value")
    if p373:
        return re.sub(r"^Category:", "", str(p373), flags=re.I).strip(), "P373"
    sl = (e.get("sitelinks", {}).get("commonswiki") or {}).get("title")
    if sl and re.match(r"^Category:", sl, re.I):
        return re.sub(r"^Category:", "", sl, flags=re.I).strip(), "commonswiki sitelink"
    return None, None


def category_files(cat):
    url = API + "?" + urllib.parse.urlencode({"action": "query", "list": "categorymembers", "cmtitle": "Category:" + cat,
                                              "cmtype": "file", "cmnamespace": 6, "cmlimit": MAX_FILES,
                                              "cmsort": "timestamp", "cmdir": "desc", "format": "json", "formatversion": 2})
    d = http_json(url)
    return [m["title"][5:] for m in d.get("query", {}).get("categorymembers", [])][:MAX_FILES]


def evidence(p, rec, qid):
    ln = p["display_name"].split()[-1]
    sn = norm_hay(ln)
    hay = norm_hay(rec.get("title", "")) + "|" + norm_hay(rec.get("description_full") or "")
    prim = []
    if sn.strip() and sn in hay:
        prim.append("commons title/description contains surname")
    if qid in (rec.get("depicts") or []):
        prim.append("commons depicts=" + qid)
    others = []
    for opid, on in roster_names.items():
        if opid != p["espn_athlete_id"] and norm_hay(on).strip() and norm_hay(on) in hay:
            others.append(on)
    for q in rec.get("depicts") or []:
        if q != qid:
            others.append(f"depicts {q}" + (f" ({roster_names.get(qid_to_pid.get(q), '')})" if q in qid_to_pid else ""))
    return prim, others


def fetch_thumb(fname, rec):
    h = hashlib_md5(fname)
    pth = os.path.join(IMG, f"{h}_thumb.img")
    if not (os.path.exists(pth) and os.path.getsize(pth) > 0):
        url = rec["thumb_url"] or rec["original_url"]
        with open(pth, "wb") as f:
            f.write(http_get(url, binary=True, timeout=120))
    return pth


def fetch_orig(fname, rec):
    h = hashlib_md5(fname)
    pth = os.path.join(IMG, f"{h}_orig.img")
    if not (os.path.exists(pth) and os.path.getsize(pth) > 0):
        with open(pth, "wb") as f:
            f.write(http_get(rec["original_url"], binary=True, timeout=180))
    return pth


def hashlib_md5(s):
    import hashlib
    return hashlib.md5(s.encode("utf-8")).hexdigest()[:16]


def evaluate(p):
    pid, qid = p["espn_athlete_id"], p["wikidata_qid"]
    out = {"espn_athlete_id": pid, "name": p["display_name"], "team_abbr": p["team_abbr"], "qid": qid,
           "ledger_status": p["status"], "ledger_reason": p.get("reason"), "candidates": [], "result": None}
    e = entity(qid)
    p31 = [c["mainsnak"]["datavalue"]["value"]["id"] for c in e.get("claims", {}).get("P31", []) if c.get("mainsnak", {}).get("datavalue")]
    days = best_dob(e)
    if "Q5" not in p31 or days != [p["dob"]]:
        out["result"] = f"identity re-check failed (P31={p31}, P569={days}, ledger dob={p['dob']})"
        return out
    cat, how = category_of(e)
    out["category"], out["category_source"] = cat, how
    if not cat:
        out["result"] = "no P373 / commonswiki category on the verified item"
        return out
    files = category_files(cat)
    old = set()
    if p.get("image"):
        old |= {p["image"].get("commons_file", "")[5:], p["image"].get("p18_file", "")[5:]}
    files = [f for f in files if f not in old]
    out["files_listed"] = len(files)
    if not files:
        out["result"] = "category has no other files"
        return out
    recs = fetch_records(files)
    for f in files:
        rec = recs.get(f)
        c = {"file": f}
        out["candidates"].append(c)
        if not rec:
            c["reject"] = "missing"
            continue
        c.update(license=rec["license_short"], year=rec["capture_year"], w=rec["width"], h=rec["height"], source_page=rec["source_page_url"])
        if not rec["license_ok"]:
            c["reject"] = f"license: {rec['license_reason']}"
            continue
        if rec["mime"] not in MIMES:
            c["reject"] = f"mime {rec['mime']}"
            continue
        if min(rec["width"], rec["height"]) < MIN_EDGE:
            c["reject"] = f"short edge {min(rec['width'], rec['height'])} < {MIN_EDGE}"
            continue
        a = rec["width"] / rec["height"]
        if not (ASPECT[0] <= a <= ASPECT[1]):
            c["reject"] = f"aspect {a:.2f} outside {ASPECT}"
            continue
        prim, others = evidence(p, rec, qid)
        c["identity_primary"], c["others_named"] = prim, others
        if not prim:
            c["reject"] = "no file-level identity evidence (category membership alone is not proof)"
            continue
        try:
            det = detect(fetch_thumb(f, rec))
        except Exception as ex:  # download/decode
            c["reject"] = f"download/decode: {ex}"
            continue
        if not det:
            c["reject"] = "decode failed"
            continue
        face, flag = pick_face(det)
        c["n_faces"] = len([x for x in det.get("yunet", []) if x["score"] >= YN_MIN])
        if not face:
            c["reject"] = flag
            continue
        crops = {k: compute_crop(det["w"], det["h"], face, s) for k, s in SPECS.items()}
        scale = rec["width"] / det["w"]
        c.update(flag=flag, face=face, thumb_wh=(det["w"], det["h"]),
                 crops={k: {kk: v[kk] for kk in ("head_ok", "top_deficit", "face_frac", "notes")} for k, v in crops.items()},
                 portrait_src_h=round(crops["portrait"]["h"] * scale))
        if not all(v["head_ok"] for v in crops.values()):
            c["reject"] = "head not fully inside the source frame"
            continue
        if min(crops["portrait"]["h"] * scale, SPECS["portrait"]["out"][1]) < MIN_PORTRAIT_H:
            c["reject"] = f"low resolution: portrait crop {round(crops['portrait']['h'] * scale)} px tall"
            continue
        c["_rec"], c["_det"], c["_crops"] = rec, det, crops
        c["ok"] = True

    def score(c):
        return (not c.get("flag"), not c.get("others_named"), "commons depicts=" + qid in c.get("identity_primary", []),
                c.get("year") or 0, c.get("portrait_src_h") or 0)
    good = sorted([c for c in out["candidates"] if c.get("ok")], key=score, reverse=True)
    if not good:
        out["result"] = "no category file passed license, identity, face and crop checks"
        return out
    best = good[0]
    out["pick"] = best["file"]
    out["result"] = "candidate (needs visual review)" if not best.get("flag") and not best.get("others_named") else \
        f"candidate flagged ({best.get('flag') or 'other people named: ' + ', '.join(best['others_named'])}) — review only"
    # stage derivatives exactly like stage 6
    rec, det, crops = best["_rec"], best["_det"], best["_crops"]
    tw, th = det["w"], det["h"]
    need_orig = any(crops[k]["h"] < SPECS[k]["out"][1] for k in SPECS) and rec["width"] > tw
    src = open_img(fetch_orig(best["file"], rec)) if need_orig else open_img(fetch_thumb(best["file"], rec))
    rs = src.width / tw
    d = os.path.join(STAGE, pid)
    os.makedirs(d, exist_ok=True)
    crops_out = {}
    for k, spec in SPECS.items():
        img, (x0, y0, w_i, h_i), (ow, oh) = render(src, crops[k], spec, rs)
        img.save(os.path.join(d, f"{k}.webp"), "WEBP", quality=82, method=6)
        f_orig = (rec["width"] / tw) / rs
        crops_out[k] = {"x": round(x0 * f_orig), "y": round(y0 * f_orig), "w": round(w_i * f_orig), "h": round(h_i * f_orig),
                        "out_w": ow, "out_h": oh, "face_frac": crops[k]["face_frac"], "eye_frac": crops[k]["eye_frac"]}
    fx, fy, fw, fh = best["face"]["box"]
    out["staged"] = {
        "commons_file": "File:" + best["file"], "source_page_url": rec["source_page_url"],
        "original_url": rec["original_url"].split("?")[0], "license_short": rec["license_short"],
        "license_family": rec["license_family"], "license_url": rec["license_url"], "artist": rec["artist"],
        "credit": rec["credit"], "capture_date": rec["capture_date"], "capture_year": rec["capture_year"],
        "description": rec["description"], "width": rec["width"], "height": rec["height"], "mime": rec["mime"],
        "restrictions": rec["restrictions"],
        "focal": {"x": round((fx + fw / 2) / tw, 4), "y": round((fy + fh / 2) / th, 4)},
        "face_box": {"x": round(fx / tw, 4), "y": round(fy / th, 4), "w": round(fw / tw, 4), "h": round(fh / th, 4)},
        "face_detector": best["face"]["src"], "crops": crops_out,
        "identity_evidence_file": best["identity_primary"], "others_named": best["others_named"], "flag": best.get("flag"),
        "discovery": {"method": "commons_category", "category": "Category:" + cat, "category_source": how,
                      "files_inspected": len(files), "max_files": MAX_FILES}
    }
    return out


def sheet(results):
    rows = [r for r in results if r.get("staged")]
    if not rows:
        return None
    font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 15) if os.path.exists("C:/Windows/Fonts/arial.ttf") else ImageFont.load_default()
    cell_w, cell_h = 640, 420
    W = cell_w * 2
    H = cell_h * ((len(rows) + 1) // 2)
    im = Image.new("RGB", (W, H), (24, 22, 20))
    dr = ImageDraw.Draw(im)
    for i, r in enumerate(rows):
        x0, y0 = (i % 2) * cell_w, (i // 2) * cell_h
        pdir = os.path.join(STAGE, r["espn_athlete_id"])
        por = Image.open(os.path.join(pdir, "portrait.webp")).convert("RGB")
        por.thumbnail((280, 350))
        sq = Image.open(os.path.join(pdir, "square.webp")).convert("RGB").resize((150, 150))
        src = open_img(os.path.join(IMG, hashlib_md5(r["pick"]) + "_thumb.img"))
        src.thumbnail((180, 350))
        im.paste(por, (x0 + 10, y0 + 40))
        im.paste(sq, (x0 + 300, y0 + 40))
        im.paste(src, (x0 + 460, y0 + 40))
        dr.text((x0 + 10, y0 + 8), f"{r['name']} ({r['team_abbr']}) — {r['result'][:60]}", fill=(240, 230, 210), font=font)
        dr.text((x0 + 300, y0 + 200), r["staged"]["license_short"] or "", fill=(200, 200, 200), font=font)
        dr.text((x0 + 300, y0 + 222), (r["pick"] or "")[:34], fill=(180, 180, 180), font=font)
    p = os.path.join(STAGE, "discovery-sheet.png")
    im.save(p)
    return p


if __name__ == "__main__":
    only = set(sys.argv[1:])
    cands = [p for p in players if is_candidate(p) and (not only or p["espn_athlete_id"] in only)]
    print("candidates:", len(cands))
    results = []
    for p in cands:
        try:
            r = evaluate(p)
        except Exception as ex:
            r = {"espn_athlete_id": p["espn_athlete_id"], "name": p["display_name"], "result": f"error: {ex}"}
        for c in r.get("candidates", []):
            for k in [k for k in c if k.startswith("_")]:
                c.pop(k)
        results.append(r)
        print(f"{p['display_name']:28s} {p['team_abbr']:4s} {r.get('category_source') or '-':20s} files={r.get('files_listed', 0):3} -> {r['result']}")
    save_json("cache/discovery.json", {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                        "rules": {"max_files": MAX_FILES, "min_edge": MIN_EDGE, "aspect": ASPECT,
                                                  "mimes": sorted(MIMES), "min_portrait_h": MIN_PORTRAIT_H},
                                        "results": results})
    print("sheet:", sheet(results))
