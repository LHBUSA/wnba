"""Review helper: larger portrait + square views for crops whose 45%-hair box hits the source edge (TIGHT-TOP)."""
import sys
from common import *
from PIL import Image, ImageDraw, ImageFont

crops = load_json("cache/crops.json")
roster = load_json("cache/roster.json")
pl = {p["espn_athlete_id"]: p for p in roster["players"]}
FONT = ImageFont.truetype("arialbd.ttf", 14)
ids = sys.argv[2:] or [k for k, v in crops.items() if v.get("crops") and not all(c["head_ok"] for c in v["crops"].values())]
prefix = sys.argv[1] if len(sys.argv) > 1 else "tight"
PW, PH, SQ = 200, 250, 150
CW = PW + SQ + 16
for pg in range(0, len(ids), 16):
    chunk = ids[pg:pg + 16]
    rows = (len(chunk) + 3) // 4
    sheet = Image.new("RGB", (4 * CW + 10, rows * (PH + 26) + 10), (255, 255, 255))
    dr = ImageDraw.Draw(sheet)
    for i, pid in enumerate(chunk):
        x0 = 10 + (i % 4) * CW
        y0 = 10 + (i // 4) * (PH + 26)
        por = Image.open(os.path.join(BASE, "out", pid, "portrait.webp")).convert("RGB").resize((PW, PH), Image.LANCZOS)
        sq = Image.open(os.path.join(BASE, "out", pid, "square.webp")).convert("RGB").resize((SQ, SQ), Image.LANCZOS)
        sheet.paste(por, (x0, y0))
        sheet.paste(sq, (x0 + PW + 4, y0))
        dr.rectangle([x0 - 1, y0 - 1, x0 + PW, y0 + PH], outline=(255, 0, 0))
        dr.rectangle([x0 + PW + 3, y0 - 1, x0 + PW + 4 + SQ, y0 + SQ], outline=(255, 0, 0))
        dr.text((x0, y0 + PH + 4), f"{pid} {pl[pid]['display_name']}"[:40], font=FONT, fill=(0, 0, 0))
    sheet.save(os.path.join(BASE, "review", f"{prefix}-{pg // 16 + 1:02d}.png"))
print(len(ids))
