"""Review helper: top strip (native px) of portrait and square for each id -> is there background above the head?"""
import sys
from common import *
from PIL import Image, ImageDraw, ImageFont

roster = load_json("cache/roster.json")
pl = {p["espn_athlete_id"]: p for p in roster["players"]}
FONT = ImageFont.truetype("arialbd.ttf", 15)
out = sys.argv[1]
ids = sys.argv[2:]
PH, SH = 150, 90
CW = 600 + 256 + 24
RH = PH + 24
cols = 2
rows = (len(ids) + cols - 1) // cols
sheet = Image.new("RGB", (cols * CW + 10, rows * RH + 10), (255, 255, 255))
dr = ImageDraw.Draw(sheet)
for i, pid in enumerate(ids):
    x0 = 10 + (i % cols) * CW
    y0 = 10 + (i // cols) * RH
    por = Image.open(os.path.join(BASE, "out", pid, "portrait.webp")).convert("RGB")
    por = por.resize((600, round(por.height * 600 / por.width)))
    sq = Image.open(os.path.join(BASE, "out", pid, "square.webp")).convert("RGB").resize((256, 256))
    sheet.paste(por.crop((0, 0, 600, PH)), (x0, y0))
    sheet.paste(sq.crop((0, 0, 256, SH)), (x0 + 608, y0))
    dr.line([x0, y0 - 1, x0 + 600, y0 - 1], fill=(255, 0, 0), width=1)
    dr.line([x0 + 608, y0 - 1, x0 + 864, y0 - 1], fill=(255, 0, 0), width=1)
    dr.text((x0 + 608, y0 + SH + 4), f"{pid}", font=FONT, fill=(0, 0, 0))
    dr.text((x0 + 608, y0 + SH + 22), pl[pid]["display_name"][:22], font=FONT, fill=(0, 0, 0))
sheet.save(os.path.join(BASE, "review", out))
