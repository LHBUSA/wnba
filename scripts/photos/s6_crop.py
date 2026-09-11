"""Stage 6: pick best P18 file per matched player, compute face-anchored crops, write WebP derivatives."""
import shutil
from common import *
from s5_detect import fetch, local_path
from PIL import Image, ImageOps
from croplib import SPECS, HAIR_UP, HEAD_MARGIN, SIDE, YN_MIN, yface, pick_face, compute_crop, render, open_img

roster = load_json("cache/roster.json")
match = load_json("cache/match.json")
commons = load_json("cache/commons.json")
faces = load_json("cache/faces.json")
overrides = load_json("review/overrides.json", {})
OUT = os.path.join(BASE, "out")


cats = load_json("cache/commons_cats.json", {})
parents = load_json("cache/parents.json", {})
from s5_detect import iou
_pl_all = roster["players"]
_qid_to_pid = {m["qid"]: k for k, m in match.items() if m["status"] == "matched"}


def surname_ok(p, c, qid):
    """Primary evidence (drives identity_confidence=high): surname in title/description, or depicts=QID."""
    sn = norm_hay(p["last_name"] or p["display_name"].split()[-1])
    hay = norm_hay(c.get("title", "")) + "|" + norm_hay(c.get("description_full") or "")
    ev = []
    if sn.strip() and sn in hay:
        ev.append("commons title/description contains surname")
    if qid in (c.get("depicts") or []):
        ev.append("commons depicts=" + qid)
    return ev


def secondary_evidence(p, c, fname):
    out = {"categories_with_name": [], "other_roster_players_named": []}
    full = norm_hay(p["display_name"])
    for ct in cats.get(fname, []):
        if full.strip() and full in norm_hay(ct):
            out["categories_with_name"].append(ct)
    hay = norm_hay(c.get("title", "")) + "|" + norm_hay(c.get("description_full") or "")
    for o in _pl_all:
        if o["espn_athlete_id"] == p["espn_athlete_id"]:
            continue
        on = norm_hay(o["display_name"])
        if on.strip() and on in hay:
            out["other_roster_players_named"].append(o["display_name"])
    for q in c.get("depicts") or []:
        op = _qid_to_pid.get(q)
        if op and op != p["espn_athlete_id"]:
            out["other_roster_players_named"].append(f"depicts {q} ({op})")
    return out


pl = {p["espn_athlete_id"]: p for p in roster["players"]}
if os.path.isdir(OUT):
    shutil.rmtree(OUT)
results = {}
for pid, m in match.items():
    if m["status"] != "matched":
        continue
    p = pl[pid]
    ov = overrides.get(pid, {})
    cands = []
    for f in m["p18"]:
        c = commons.get(f, {})
        if ov.get("file") and f != ov["file"]:
            continue
        ev = surname_ok(p, c, m["qid"]) if c else []
        sec = secondary_evidence(p, c, f) if c else {}
        ent = {"file": f, "license_ok": c.get("license_ok", False), "license_reason": c.get("license_reason"),
               "identity_ev": ev, "secondary": sec, "year": c.get("capture_year")}
        det = faces.get(f)
        if c.get("license_ok") and det and "faces" in det:
            # ["yunet", i] | ["haar", i] | ["box", [x,y,w,h]] in thumb px; only for the file it was reviewed on
            forced = ov.get("face") if ov.get("face_file") == f else None
            face, flag = pick_face(det, forced)
            ent["flag"] = flag
            ent["n_faces"] = len([f for f in det.get("yunet", []) if f["score"] >= YN_MIN])
            if face:
                ent["face"] = face
                ent["crops"] = {k: compute_crop(det["w"], det["h"], face, s) for k, s in SPECS.items()}
                ent["thumb_wh"] = (det["w"], det["h"])
        elif det and "error" in det:
            ent["flag"] = det["error"]
        cands.append(ent)
        # uncropped parent ({{Extracted from}}) located by template match -> same person, more headroom
        pinfo = parents.get(f) or {}
        if ent.get("face") and pinfo.get("match_score", 0) >= 0.85 and commons.get(pinfo["parent"], {}).get("license_ok") \
                and (not ov.get("file") or ov.get("allow_parent")):
            par = pinfo["parent"]
            pc = commons[par]
            pdet = faces[par]
            sc = pinfo["scale"]
            ox, oy = pinfo["offset"]
            bx, by, bw, bh = ent["face"]["box"]
            mb = [bx * sc + ox, by * sc + oy, bw * sc, bh * sc]
            pface = {"box": [int(v) for v in mb], "eye_y": ent["face"]["eye_y"] * sc + oy, "src": "mapped_from_child"}
            for yf in pdet.get("yunet", []):
                if iou(mb, yf["box"]) > 0.5:
                    pface = yface(yf, "yunet_mapped")
                    break
            pev = surname_ok(p, pc, m["qid"])
            lineage = (f"uncropped parent of P18 file '{f}' via {{{{Extracted from}}}}; subject located by template "
                       f"match {pinfo['match_score']}")
            pent = {"file": par, "license_ok": True, "license_reason": None,
                    "identity_ev": pev + ([lineage] if ent["identity_ev"] else []),
                    "secondary": secondary_evidence(p, pc, par), "year": pc.get("capture_year"), "parent_of": f,
                    "flag": None, "face": pface, "thumb_wh": (pdet["w"], pdet["h"]),
                    "crops": {k: compute_crop(pdet["w"], pdet["h"], pface, s) for k, s in SPECS.items()}}
            cands.append(pent)

    def score(e):
        crop_ok = bool(e.get("crops")) and not e.get("flag") and all(v["head_ok"] for v in e["crops"].values())
        res = 0
        if e.get("crops"):
            res = e["crops"]["portrait"]["h"] * (commons[e["file"]]["width"] / e["thumb_wh"][0])
        has_crop = bool(e.get("crops")) and not e.get("flag")
        clean_id = bool(e["identity_ev"]) and (bool(e.get("parent_of")) or
                                               not (e.get("secondary") or {}).get("other_roster_players_named"))
        deficit = max(v["top_deficit"] for v in e["crops"].values()) if e.get("crops") else 9
        # recency first; head-fit then decides between same-year files (parent vs crop). Visual review overrides.
        return (e["license_ok"], clean_id, has_crop, e["year"] or 0, crop_ok, -round(deficit, 2), res)

    cands.sort(key=score, reverse=True)
    best = cands[0] if cands else None
    r = {"candidates": [dict({k: v for k, v in c.items() if k not in ("crops",)},
                             portrait_thumb=(c["crops"]["portrait"] if c.get("crops") else None)) for c in cands]}
    if not m["p18"]:
        r.update(status="no_image", reason="matched Wikidata item has no P18 image")
    elif not best["license_ok"]:
        r.update(status="license_rejected", reason="; ".join(sorted({c["license_reason"] or "?" for c in cands})))
    else:
        r["file"] = best["file"]
        r["flag"] = best.get("flag")
        c = commons[best["file"]]
        if best.get("crops"):
            tw, th = best["thumb_wh"]
            scale = c["width"] / tw  # thumb px -> original px
            # use original pixels when the thumb can't supply the target resolution
            need_orig = any(best["crops"][k]["h"] < SPECS[k]["out"][1] for k in SPECS) and c["width"] > tw
            if need_orig:
                src = open_img(fetch(best["file"], c, "orig"))
                rs = src.width / tw
            else:
                src = open_img(local_path(best["file"], "thumb"))
                rs = 1.0
            if abs(src.width / tw - rs) > 0.01:
                print("WARN size mismatch", pid)
            d = os.path.join(OUT, pid)
            os.makedirs(d, exist_ok=True)
            crops_out = {}
            for k, spec in SPECS.items():
                img, (x0, y0, w_i, h_i), (ow, oh) = render(src, best["crops"][k], spec, rs)
                img.save(os.path.join(d, f"{k}.webp"), "WEBP", quality=82, method=6)
                f_orig = scale / rs
                cr = best["crops"][k]
                crops_out[k] = {"x": round(x0 * f_orig), "y": round(y0 * f_orig), "w": round(w_i * f_orig),
                                "h": round(h_i * f_orig), "out_w": ow, "out_h": oh,
                                "face_frac": cr["face_frac"], "eye_frac": cr["eye_frac"],
                                "head_ok": cr["head_ok"], "top_deficit": cr["top_deficit"], "notes": cr["notes"]}
            fx, fy, fw, fh = best["face"]["box"]
            r["focal"] = {"x": round((fx + fw / 2) / tw, 4), "y": round((fy + fh / 2) / th, 4)}
            r["face_box"] = {"x": round(fx / tw, 4), "y": round(fy / th, 4), "w": round(fw / tw, 4), "h": round(fh / th, 4)}
            r["face_src"] = best["face"]["src"]
            r["crops"] = crops_out
            r["used_original_pixels"] = need_orig
        r["identity_ev"] = best["identity_ev"]
        r["secondary"] = best.get("secondary")
        r["parent_of"] = best.get("parent_of")
        if best.get("face"):
            r["face_thumb"] = best["face"]
            r["thumb_wh"] = best["thumb_wh"]
        r["status"] = "cropped" if best.get("crops") else "no_crop"
    results[pid] = r

save_json("cache/crops.json", results)
from collections import Counter
print(Counter(v["status"] for v in results.values()))
print(Counter(v.get("flag") for v in results.values()))
print("head_fail:", [k for k, v in results.items() if v.get("crops") and not all(c["head_ok"] for c in v["crops"].values())])
print("identity review:", [k for k, v in results.items() if v.get("file") and not v.get("identity_ev")])
print("small portrait:", sorted((v["crops"]["portrait"]["out_h"], k) for k, v in results.items() if v.get("crops"))[:40])
