"""Stage 7: contact sheets. sheet-XX.png = derivatives; src-XX.png = source with face box + crop rects."""
import glob
from common import *
from s5_detect import local_path
from PIL import Image, ImageDraw, ImageFont

roster = load_json("cache/roster.json")
match = load_json("cache/match.json")
commons = load_json("cache/commons.json")
crops = load_json("cache/crops.json")
faces = load_json("cache/faces.json")
pl = {p["espn_athlete_id"]: p for p in roster["players"]}
REV = os.path.join(BASE, "review")
os.makedirs(REV, exist_ok=True)
for f in glob.glob(os.path.join(REV, "*.png")):
    os.remove(f)
try:
    FONT = ImageFont.truetype("arial.ttf", 13)
    FONTB = ImageFont.truetype("arialbd.ttf", 13)
except Exception:
    FONT = FONTB = ImageFont.load_default()

ids = [p["espn_athlete_id"] for p in roster["players"] if crops.get(p["espn_athlete_id"], {}).get("crops")]
COLS, ROWS = 5, 5
PW, PH, SQ = 180, 225, 112
CW, CH = PW + SQ + 18, PH + 52


def caption(pid):
    c = crops[pid]
    cm = commons[c["file"]]
    return (f"{pid} {pl[pid]['display_name']}", f"{cm['license_short']} | {cm['capture_year']}")


def flags(pid):
    c = crops[pid]
    fl = []
    if c.get("flag"):
        fl.append(c["flag"])
    if not all(v["head_ok"] for v in c["crops"].values()):
        fl.append("TIGHT-TOP")
    if c["crops"]["portrait"]["out_h"] < 400:
        fl.append("LOWRES%d" % c["crops"]["portrait"]["out_h"])
    if not c.get("identity_ev"):
        fl.append("ID-REVIEW")
    if len(c.get("candidates", [])) > 1:
        fl.append("ALT x%d" % len(c["candidates"]))
    return fl


def pages(seq, n):
    for i in range(0, len(seq), n):
        yield i // n + 1, seq[i:i + n]


for pg, chunk in pages(ids, COLS * ROWS):
    sheet = Image.new("RGB", (COLS * CW + 10, ROWS * CH + 10), (235, 235, 235))
    dr = ImageDraw.Draw(sheet)
    for i, pid in enumerate(chunk):
        x0 = 10 + (i % COLS) * CW
        y0 = 10 + (i // COLS) * CH
        por = Image.open(os.path.join(BASE, "out", pid, "portrait.webp")).convert("RGB")
        sq = Image.open(os.path.join(BASE, "out", pid, "square.webp")).convert("RGB")
        por_t = por.resize((PW, PH), Image.LANCZOS)  # same aspect -> no distortion
        sq_t = sq.resize((SQ, SQ), Image.LANCZOS)
        sheet.paste(por_t, (x0, y0))
        sheet.paste(sq_t, (x0 + PW + 6, y0))
        dr.rectangle([x0 - 1, y0 - 1, x0 + PW, y0 + PH], outline=(0, 0, 0))
        dr.rectangle([x0 + PW + 5, y0 - 1, x0 + PW + 6 + SQ, y0 + SQ], outline=(0, 0, 0))
        dr.text((x0 + PW + 6, y0 + SQ + 4), f"{por.width}x{por.height}", font=FONT, fill=(60, 60, 60))
        dr.text((x0 + PW + 6, y0 + SQ + 20), f"{sq.width}x{sq.height}", font=FONT, fill=(60, 60, 60))
        fl = flags(pid)
        for j, t in enumerate(fl):
            dr.text((x0 + PW + 6, y0 + SQ + 40 + j * 16), t, font=FONTB, fill=(200, 0, 0))
        a, b = caption(pid)
        dr.text((x0, y0 + PH + 4), a, font=FONTB, fill=(0, 0, 0))
        dr.text((x0, y0 + PH + 20), b, font=FONT, fill=(0, 0, 0))
    sheet.save(os.path.join(REV, "sheet-%02d.png" % pg))

# source sheets: every player with a chosen file (incl. flagged), showing all faces + chosen crops
src_ids = [p["espn_athlete_id"] for p in roster["players"] if crops.get(p["espn_athlete_id"], {}).get("file")]
SW, SH = 290, 250
for pg, chunk in pages(src_ids, 5 * 5):
    sheet = Image.new("RGB", (5 * (SW + 10) + 10, 5 * (SH + 44) + 10), (235, 235, 235))
    dr = ImageDraw.Draw(sheet)
    for i, pid in enumerate(chunk):
        c = crops[pid]
        x0 = 10 + (i % 5) * (SW + 10)
        y0 = 10 + (i // 5) * (SH + 44)
        det = faces[c["file"]]
        im = Image.open(local_path(c["file"], "thumb")).convert("RGB")
        s = min(SW / im.width, SH / im.height)
        im = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
        d2 = ImageDraw.Draw(im)
        for k, f in enumerate(det["faces"]):
            bx, by, bw, bh = [v * s for v in f["box"]]
            d2.rectangle([bx, by, bx + bw, by + bh], outline=(255, 255, 0), width=1)
        for k, f in enumerate(det.get("yunet", [])):
            if f["score"] < 0.8:
                continue
            bx, by, bw, bh = [v * s for v in f["box"]]
            d2.rectangle([bx, by, bx + bw, by + bh], outline=(0, 255, 0), width=2)
            d2.text((bx + 2, by + 2), str(k), font=FONTB, fill=(0, 255, 0))
        if c.get("crops"):
            W0 = commons[c["file"]]["width"]
            r = s * det["w"] / W0
            for nm, col in (("portrait", (0, 120, 255)), ("square", (255, 0, 200))):
                cr = c["crops"][nm]
                d2.rectangle([cr["x"] * r, cr["y"] * r, (cr["x"] + cr["w"]) * r, (cr["y"] + cr["h"]) * r], outline=col, width=2)
        sheet.paste(im, (x0, y0))
        dr.text((x0, y0 + SH + 3), f"{pid} {pl[pid]['display_name']}  [{c.get('flag') or ''}]", font=FONTB, fill=(0, 0, 0))
        dr.text((x0, y0 + SH + 19), c["file"][:48], font=FONT, fill=(60, 60, 60))
    sheet.save(os.path.join(REV, "src-%02d.png" % pg))
print("sheets:", len(ids), "players;", "src:", len(src_ids))

# alternates: players with more than one P18 candidate
alt_ids = [pid for pid in src_ids if len(crops[pid].get("candidates", [])) > 1]
AW, AH = 230, 200
for pg, chunk in pages(alt_ids, 6):
    ncol = max(len(crops[p]["candidates"]) for p in chunk)
    sheet = Image.new("RGB", (ncol * (AW + 10) + 10, len(chunk) * (AH + 40) + 10), (235, 235, 235))
    dr = ImageDraw.Draw(sheet)
    for ri, pid in enumerate(chunk):
        for ci, cand in enumerate(crops[pid]["candidates"]):
            x0 = 10 + ci * (AW + 10)
            y0 = 10 + ri * (AH + 40)
            f = cand["file"]
            det = faces.get(f, {})
            if "path" not in det:
                dr.text((x0, y0), "no image: " + str(cand.get("flag")), font=FONT, fill=(0, 0, 0))
                continue
            im = Image.open(local_path(f, "thumb")).convert("RGB")
            s = min(AW / im.width, AH / im.height)
            im = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
            d2 = ImageDraw.Draw(im)
            pt = cand.get("portrait_thumb")
            if pt:
                d2.rectangle([pt["x"] * s, pt["y"] * s, (pt["x"] + pt["w"]) * s, (pt["y"] + pt["h"]) * s],
                             outline=(0, 120, 255), width=2)
            sheet.paste(im, (x0, y0))
            chosen = f == crops[pid].get("file")
            dr.text((x0, y0 + AH + 2), ("* " if chosen else "") + f"{pid} {pl[pid]['display_name']} #{ci}",
                    font=FONTB, fill=(200, 0, 0) if chosen else (0, 0, 0))
            dr.text((x0, y0 + AH + 18), f"{cand.get('year')} {cand.get('flag') or ''} {f[:26]}", font=FONT, fill=(60, 60, 60))
    sheet.save(os.path.join(REV, "alt-%02d.png" % pg))
print("alt players:", len(alt_ids))
