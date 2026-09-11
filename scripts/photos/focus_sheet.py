"""Ad-hoc review helper: large source views with numbered YuNet boxes for given espn ids (or 'file:' names).
usage: python focus_sheet.py out.png id1 id2 ..."""
import sys
from common import *
from s5_detect import local_path
from PIL import Image, ImageDraw, ImageFont

crops = load_json("cache/crops.json")
faces = load_json("cache/faces.json")
roster = load_json("cache/roster.json")
pl = {p["espn_athlete_id"]: p for p in roster["players"]}
FONT = ImageFont.truetype("arialbd.ttf", 16)
out = sys.argv[1]
items = []
for a in sys.argv[2:]:
    if a.startswith("file:"):
        items.append((a[5:], a[5:]))
    elif ":" in a:
        pid, i = a.split(":")
        items.append((pid + " alt" + i, crops[pid]["candidates"][int(i)]["file"]))
    else:
        items.append((a + " " + pl[a]["display_name"], crops[a]["file"]))
W, H = 500, 460
cols = 3
rows = (len(items) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (W + 10) + 10, rows * (H + 30) + 10), (230, 230, 230))
dr = ImageDraw.Draw(sheet)
for i, (lab, f) in enumerate(items):
    det = faces[f]
    im = Image.open(local_path(f, "thumb")).convert("RGB")
    s = min(W / im.width, H / im.height)
    im = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
    d2 = ImageDraw.Draw(im)
    for k, fc in enumerate(det.get("yunet", [])):
        if fc["score"] < 0.6:
            continue
        bx, by, bw, bh = [v * s for v in fc["box"]]
        col = (0, 255, 0) if fc["score"] >= 0.8 else (255, 160, 0)
        d2.rectangle([bx, by, bx + bw, by + bh], outline=col, width=2)
        d2.text((bx + 2, by - 16), str(k), font=FONT, fill=col)
    x0 = 10 + (i % cols) * (W + 10)
    y0 = 10 + (i // cols) * (H + 30)
    sheet.paste(im, (x0, y0))
    dr.text((x0, y0 + H + 5), lab[:55], font=FONT, fill=(0, 0, 0))
sheet.save(os.path.join(BASE, "review", out))
