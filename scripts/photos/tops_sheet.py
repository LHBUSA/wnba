"""Review helper: top 45% of portrait + top 60% of square at native resolution, to check hair/forehead cropping."""
import sys
from common import *
from PIL import Image, ImageDraw, ImageFont

roster = load_json("cache/roster.json")
pl = {p["espn_athlete_id"]: p for p in roster["players"]}
FONT = ImageFont.truetype("arialbd.ttf", 16)
out = sys.argv[1]
ids = sys.argv[2:]
CW, CH = 600 + 256 + 20, 340
cols = 2
rows = (len(ids) + 1) // 2
sheet = Image.new("RGB", (cols * CW + 10, rows * (CH + 24) + 10), (255, 255, 255))
dr = ImageDraw.Draw(sheet)
for i, pid in enumerate(ids):
    x0 = 10 + (i % cols) * CW
    y0 = 10 + (i // cols) * (CH + 24)
    por = Image.open(os.path.join(BASE, "out", pid, "portrait.webp")).convert("RGB")
    sq = Image.open(os.path.join(BASE, "out", pid, "square.webp")).convert("RGB")
    s = 600 / por.width
    por = por.resize((600, int(por.height * s)))
    sheet.paste(por.crop((0, 0, 600, CH)), (x0, y0))
    sq = sq.resize((256, 256))
    sheet.paste(sq, (x0 + 610, y0))
    dr.rectangle([x0 - 1, y0 - 1, x0 + 600, y0 + CH], outline=(255, 0, 0))
    dr.rectangle([x0 + 609, y0 - 1, x0 + 610 + 256, y0 + 256], outline=(255, 0, 0))
    dr.text((x0, y0 + CH + 3), f"{pid} {pl[pid]['display_name']}", font=FONT, fill=(0, 0, 0))
sheet.save(os.path.join(BASE, "review", out))
