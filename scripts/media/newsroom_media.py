"""Newsroom story-media derivatives, built once from the approved player-photo ledger.

For every approved player (data/player-photos.json) this renders deliberate, pre-composed images so the
browser never crops a photo:

  wide  16:9  (1280 / 960 / 640)  lead stories, article heroes, cards
  half   8:9  (640 / 480)         one side of a two-player matchup (two halves = one 16:9 frame)
  og   1200x630 JPEG              social preview, with the photo credit printed on it

Art direction (after the UFC article hero): the whole subject stays sharp in the foreground; the rest of the
frame becomes an atmospheric, dimmed, defocused treatment of the same photo tinted with the team colour.
Portrait sources in wide frames keep their full height; the empty sides are filled by that atmosphere, never
by stretching or top-centre cropping.

Framing uses the reviewed face box already in the ledger (the same box the 4:5 / 1:1 crops were reviewed on)
and the stage-6 head rules: head = face + 45% up + 10% headroom; the head is always fully inside the frame.
Never upscaled beyond 1.3x (a size that would need more is simply not produced).

Output: public/media/news/players/<espnAthleteId>/{wide-1280,wide-960,wide-640,half-640,half-480}.webp, og.jpg
Manifest: data/newsroom-media.json (bundled into wnba-news, which attaches media to articles).
Review sheets: scripts/.cache/newsroom/sheets/*.png
"""
import hashlib
import json

import numpy as np
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LEDGER = os.path.join(ROOT, "data", "player-photos.json")
LOGOS = os.path.join(ROOT, "data", "team-logos.json")
OUT = os.path.join(ROOT, "public", "media", "news", "players")
MANIFEST = os.path.join(ROOT, "data", "newsroom-media.json")
CACHE = os.path.join(ROOT, "scripts", ".cache", "newsroom")
SHEETS = os.path.join(CACHE, "sheets")
UA = "PropBetEdgeWNBA/1.0 (sales@localhomebuyersusa.com) newsroom-media"
API = "https://commons.wikimedia.org/w/api.php"

MAX_UPSCALE = 1.3
HAIR_UP, HEAD_MARGIN = 0.45, 0.10          # stage-6 head rules
EYE_IN_BOX = 0.40                          # eye line inside a face box (stage-6 default)
INK = (15, 13, 10)
SLOTS = {
    # aspect, widths (largest first), face centre x, eye line y, face height (fractions of the frame)
    "wide": dict(aspect=16 / 9, widths=[1280, 960, 640], fx=0.62, ey=0.34, fh=0.22, min_fh=0.11),
    "half": dict(aspect=8 / 9, widths=[640, 480], fx=0.50, ey=0.32, fh=0.20, min_fh=0.11),
    "og": dict(aspect=1200 / 630, widths=[1200], fx=0.70, ey=0.34, fh=0.21, min_fh=0.10),
}

_last = [0.0]
_yn = [None]


def other_faces(img, subject_box):
    """Every face in the photo except the reviewed subject (YuNet, the model the photo pipeline pins). These are
    kept out of the sharp zone so only the pictured player is in focus."""
    import cv2
    if _yn[0] is None:
        _yn[0] = cv2.FaceDetectorYN.create(os.path.join(ROOT, "scripts", "models", "yunet.onnx"), "", (320, 320), 0.75, 0.3, 5000)
    k = min(1.0, 1600 / max(img.width, img.height))
    small = img.resize((max(1, int(img.width * k)), max(1, int(img.height * k)))) if k < 1 else img
    arr = cv2.cvtColor(np.asarray(small), cv2.COLOR_RGB2BGR)
    _yn[0].setInputSize((arr.shape[1], arr.shape[0]))
    _, res = _yn[0].detect(arr)
    out = []
    sx, sy, sw, sh = subject_box
    for row in (res if res is not None else []):
        x, y, w, h = [float(v) / k for v in row[:4]]
        ix = max(0, min(x + w, sx + sw) - max(x, sx)); iy = max(0, min(y + h, sy + sh) - max(y, sy))
        inter = ix * iy
        iou = inter / (w * h + sw * sh - inter) if inter else 0.0
        if iou < 0.2 and float(row[14]) >= 0.75 and w >= 0.5 * sw:   # comparable size = could be mistaken for her
            out.append((x, y, w, h))
    return out


def get(url, binary=False, timeout=120):
    for i in range(5):
        dt = time.time() - _last[0]
        if dt < 0.3:
            time.sleep(0.3 - dt)
        _last[0] = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=timeout) as r:
                data = r.read()
                return data if binary else data.decode("utf-8")
        except Exception as e:  # noqa: BLE001 - retry network/429
            if i == 4:
                raise
            time.sleep(4 * (i + 1))


def source_urls(files):
    """commons_file -> (download url, width, height) using a <=2560px rendition."""
    out = {}
    for i in range(0, len(files), 20):
        batch = files[i:i + 20]
        q = urllib.parse.urlencode({"action": "query", "titles": "|".join(batch), "prop": "imageinfo",
                                    "iiprop": "url|size", "iiurlwidth": 2560, "format": "json", "formatversion": 2})
        d = json.loads(get(f"{API}?{q}"))
        norm = {n["to"]: n["from"] for n in d["query"].get("normalized", [])}
        for pg in d["query"]["pages"]:
            src = norm.get(pg["title"], pg["title"])
            ii = (pg.get("imageinfo") or [None])[0]
            if ii:
                url = ii.get("thumburl") if ii.get("thumbwidth") and ii["thumbwidth"] < ii["width"] else ii["url"]
                out[src] = (url, ii["width"], ii["height"])
    return out


def load_source(pid, cfile, url):
    os.makedirs(os.path.join(CACHE, "src"), exist_ok=True)
    p = os.path.join(CACHE, "src", f"{pid}-{hashlib.md5(cfile.encode()).hexdigest()[:10]}.img")
    if not (os.path.exists(p) and os.path.getsize(p)):
        with open(p, "wb") as f:
            f.write(get(url, binary=True, timeout=180))
    im = ImageOps.exif_transpose(Image.open(p)).convert("RGB")
    return im


def hex_rgb(h):
    h = (h or "#d4af37").lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def plan(slot, W, img_w, img_h, face):
    """Scale + offset placing the source so the face sits on the slot's marks. None if it would upscale.

    normal: face on the slot's eye line; the photo grows down to the frame bottom when it can.
    bust:   the photo cannot reach the frame bottom without pushing the head out (press close-ups), so it is
            anchored to the bottom edge with the head top just under the frame top — never a floating crop."""
    H = round(W / slot["aspect"])
    fx, fy, fw, fh = face
    eye_src = fy + EYE_IN_BOX * fh
    cx_src = fx + fw / 2
    head_top_src = fy - (HAIR_UP + HEAD_MARGIN) * fh
    head_cap = (slot["ey"] - 0.03) * H / (EYE_IN_BOX + HAIR_UP + HEAD_MARGIN)
    s_cover = (1 - slot["ey"]) * H / max(1.0, img_h - eye_src)
    mode = "normal"
    if s_cover * fh <= head_cap:
        s = max(slot["fh"] * H, s_cover * fh) / fh
        s = min(s, head_cap / fh)
        oy = slot["ey"] * H - eye_src * s
    else:
        mode = "bust"
        s = (1 - 0.06) * H / max(1.0, img_h - max(0.0, head_top_src))
        oy = H - img_h * s
    if s > MAX_UPSCALE:
        if mode == "bust":
            return None
        s = MAX_UPSCALE
        if s * fh < slot["min_fh"] * H:
            return None
        oy = slot["ey"] * H - eye_src * s
    ox = slot["fx"] * W - cx_src * s
    head_top_out = oy + head_top_src * s
    return dict(W=W, H=H, s=s, ox=ox, oy=oy, mode=mode, face_out=(fx * s + ox, fy * s + oy, fw * s, fh * s),
                head_top_out=head_top_out)


def feathered_rect_mask(W, H, x0, y0, x1, y1, feather):
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    inset = [x0 + (feather if x0 > 0 else -feather * 2), y0 + (feather if y0 > 0 else -feather * 2),
             x1 - (feather if x1 < W else -feather * 2), y1 - (feather if y1 < H else -feather * 2)]
    d.rectangle(inset, fill=255)
    return m.filter(ImageFilter.GaussianBlur(feather * 0.6)) if feather > 0 else m


def compose(img, p, tint, kind, credit=None):
    W, H, s, ox, oy = p["W"], p["H"], p["s"], p["ox"], p["oy"]
    # 1. atmosphere: cover-fill of the same photo, defocused, dimmed, desaturated, team-tinted
    cs = max(W / img.width, H / img.height) * 1.08
    bw, bh = int(img.width * cs), int(img.height * cs)
    fcx = (p["face_out"][0] + p["face_out"][2] / 2 - ox) / s  # face centre in source px
    bx = int(max(0, min(bw - W, fcx * cs - W * 0.5)))
    by = int(max(0, min(bh - H, (p["face_out"][1] - oy) / s * cs - H * 0.3)))
    cover = img.resize((bw, bh), Image.BILINEAR).crop((bx, by, bx + W, by + H))
    # 2. the photo itself at its planned scale (only the part that lands in the frame is resampled)
    sx0, sy0 = max(0.0, -ox / s), max(0.0, -oy / s)
    sx1, sy1 = min(img.width, (W - ox) / s), min(img.height, (H - oy) / s)
    region = img.crop((int(sx0), int(sy0), int(math.ceil(sx1)), int(math.ceil(sy1))))
    tx0, ty0 = int(round(int(sx0) * s + ox)), int(round(int(sy0) * s + oy))
    tw, th = max(1, int(round(region.width * s))), max(1, int(round(region.height * s)))
    # extend the photo past its own edges by mirroring the pixels next to each edge; the extension is only
    # ever seen defocused (ambient) so background colour and structure continue through the edge
    rs = region.resize((tw, th), Image.LANCZOS)
    x0c, y0c = max(0, -tx0), max(0, -ty0)
    vis = np.asarray(rs)[y0c:y0c + min(th - y0c, H - max(0, ty0)), x0c:x0c + min(tw - x0c, W - max(0, tx0))]
    pt, pl = max(0, ty0), max(0, tx0)
    pb, pr = H - pt - vis.shape[0], W - pl - vis.shape[1]
    ext = vis
    while pt or pb or pl or pr:   # repeated symmetric reflection handles pads wider than the photo
        a, b = min(pt, ext.shape[0]), min(pb, ext.shape[0])
        c, d = min(pl, ext.shape[1]), min(pr, ext.shape[1])
        ext = np.pad(ext, ((a, b), (c, d), (0, 0)), mode="symmetric")
        pt, pb, pl, pr = pt - a, pb - b, pl - c, pr - d
    placed = Image.fromarray(ext)
    del cover
    # ambient: the photo-on-cover, heavily defocused, dimmed and team-tinted. Because it is built from the
    # placed photo itself, its colours continue past the photo's edges instead of meeting a separate panel.
    ambient = placed.filter(ImageFilter.GaussianBlur(max(12, H * 0.07)))
    ambient = ImageEnhance.Brightness(ImageEnhance.Color(ambient).enhance(0.55)).enhance(0.42)
    ambient = Image.blend(ambient, Image.new("RGB", (W, H), tint), 0.16)
    feather = int(min(H * 0.11, tw * 0.16))
    bounds = feathered_rect_mask(W, H, tx0, ty0, tx0 + tw, ty0 + th, feather)
    # 3. keep the subject sharp; defocus + dim everything else in the photo (other players, crowd)
    fxo, fyo, fwo, fho = p["face_out"]
    soft = ImageEnhance.Brightness(placed.filter(ImageFilter.GaussianBlur(max(3, H * 0.02)))).enhance(0.5)
    subj = Image.new("L", (W, H), 0)
    cx, cy = fxo + fwo / 2, fyo + fho * 2.1
    rx, ry = fwo * 2.5, fho * 3.6
    ImageDraw.Draw(subj).ellipse([cx - rx, min(p["head_top_out"] - fho * 0.3, cy - ry), cx + rx, cy + ry * 1.6], fill=255)
    subj = subj.filter(ImageFilter.GaussianBlur(max(6, H * 0.06)))
    if p.get("others"):
        excl = Image.new("L", (W, H), 0)
        ed = ImageDraw.Draw(excl)
        for (x, y, w, h) in p["others"]:
            X, Y, Wd, Ht = x * s + ox, y * s + oy, w * s, h * s
            ed.ellipse([X - Wd * 0.55, Y - Ht * 0.7, X + Wd * 1.55, Y + Ht * 2.6], fill=255)
        excl = excl.filter(ImageFilter.GaussianBlur(max(4, H * 0.02)))
        # the pictured player's own head and shoulders can never be defocused by a neighbour's exclusion
        guard = Image.new("L", (W, H), 0)
        ImageDraw.Draw(guard).ellipse([fxo - fwo * 0.9, p["head_top_out"] - fho * 0.2, fxo + fwo * 1.9, fyo + fho * 2.4], fill=255)
        guard = guard.filter(ImageFilter.GaussianBlur(max(3, H * 0.012)))
        subj = ImageChops.subtract(subj, ImageChops.subtract(excl, guard))
    photo = Image.composite(placed, soft, subj)
    # the photo's own edge feather must never reach the subject: wherever the subject overlaps the actual
    # photo, the photo stays fully opaque (only its far edges dissolve into the atmosphere)
    hard = Image.new("L", (W, H), 0)
    ImageDraw.Draw(hard).rectangle([tx0, ty0, tx0 + tw - 1, ty0 + th - 1], fill=255)
    hard = hard.filter(ImageFilter.GaussianBlur(max(4, H * 0.014)))  # a photo edge beside the subject: short, soft
    bounds = ImageChops.lighter(bounds, ImageChops.multiply(subj, hard))
    frame = Image.composite(photo, ambient, bounds)
    # 4. light: radial falloff away from the subject, deeper at the bottom edge for type/caption legibility
    vig = Image.new("L", (W, H), 0)
    vd = ImageDraw.Draw(vig)
    R = max(W, H) * 0.95
    for i in range(24):
        r = R * (1 - i / 24)
        vd.ellipse([cx - r, fyo + fho - r * 0.8, cx + r, fyo + fho + r * 0.8], fill=int(255 * (i / 24) ** 0.7))
    vig = vig.filter(ImageFilter.GaussianBlur(H * 0.08))
    dark = Image.new("RGB", (W, H), INK)
    frame = Image.composite(frame, Image.blend(frame, dark, 0.45), vig)
    grad = Image.linear_gradient("L").resize((W, H))  # 0 top -> 255 bottom
    frame = Image.composite(Image.blend(frame, dark, 0.55), frame, grad.point(lambda v: max(0, v - 150) * 2))
    if kind == "og":
        side = Image.linear_gradient("L").rotate(90, expand=True).resize((W, H)).point(lambda v: max(0, 255 - int(v * 1.7)))
        frame = Image.composite(Image.blend(frame, dark, 0.86), frame, side)
        d = ImageDraw.Draw(frame)
        fb = font(34, bold=True)
        d.text((56, 52), "PROPBETEDGE", font=fb, fill=(212, 175, 55))
        d.text((56, 94), "WNBA NEWSROOM", font=font(24, bold=True), fill=(245, 241, 235))
        if credit:
            ft = font(15)
            tw_ = d.textlength(credit, font=ft)
            d.text((W - tw_ - 24, H - 30), credit, font=ft, fill=(210, 204, 192))
    return frame


_fonts = {}


def font(size, bold=False):
    key = (size, bold)
    if key not in _fonts:
        for f in (["C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"] if bold else
                  ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]):
            if os.path.exists(f):
                _fonts[key] = ImageFont.truetype(f, size)
                break
        else:
            _fonts[key] = ImageFont.load_default()
    return _fonts[key]


def short_credit(p):
    img = p["image"]
    artist = re.sub(r"\s+", " ", img.get("artist") or "Unknown author").strip()
    artist = artist if len(artist) <= 42 else artist[:40].rstrip() + "…"
    return f"Photo: {artist} / {img['license_short']} (cropped) · Wikimedia Commons"


def build(only=None):
    ledger = json.load(open(LEDGER, encoding="utf-8"))
    colors = {str(t["team_id"]): t.get("color") for t in json.load(open(LOGOS, encoding="utf-8"))["teams"]}
    approved = [p for p in ledger["players"] if p["status"] == "approved" and (not only or p["espn_athlete_id"] in only)]
    urls = source_urls(sorted({p["image"]["commons_file"] for p in approved}))
    prev = json.load(open(MANIFEST, encoding="utf-8")) if os.path.exists(MANIFEST) else {"players": {}}
    players = {} if not only else dict(prev.get("players", {}))
    problems = []
    for n, p in enumerate(approved, 1):
        pid, img_meta = p["espn_athlete_id"], p["image"]
        cf = img_meta["commons_file"]
        if cf not in urls:
            problems.append((p["display_name"], "commons file not resolvable"))
            continue
        url, ow, oh = urls[cf]
        if (ow, oh) != (img_meta["width"], img_meta["height"]):
            problems.append((p["display_name"], f"commons size {ow}x{oh} != ledger {img_meta['width']}x{img_meta['height']}"))
            continue
        img = load_source(pid, cf, url)
        if abs(img.width / img.height - ow / oh) > 0.01:
            problems.append((p["display_name"], "downloaded aspect differs from ledger"))
            continue
        fb = img_meta["face_box"]
        face = (fb["x"] * img.width, fb["y"] * img.height, fb["w"] * img.width, fb["h"] * img.height)
        others = other_faces(img, face)
        tint = hex_rgb(colors.get(str(p["team_id"])))
        d = os.path.join(OUT, pid)
        os.makedirs(d, exist_ok=True)
        entry = {"name": p["display_name"], "team_id": p["team_id"], "team_abbr": p["team_abbr"],
                 "commons_file": cf, "source_page_url": img_meta["source_page_url"], "artist": img_meta.get("artist"),
                 "license": img_meta["license_short"], "license_url": img_meta.get("license_url"),
                 "attribution": img_meta["attribution_text"], "source_px": [img.width, img.height],
                 "other_faces_defocused": len(others), "slots": {}}
        for sname, slot in SLOTS.items():
            files = []
            for W in slot["widths"]:
                pl = plan(slot, W, img.width, img.height, face)
                if not pl:
                    continue
                pl["others"] = others
                # fail only if OUR frame would cut into the photo above the head. When the source itself ends
                # at the hairline (reviewed "minimal headroom" photos), its top edge sits inside the frame.
                if pl["head_top_out"] < 0 and pl["oy"] < 0:
                    problems.append((p["display_name"], f"{sname}-{W}: head top would leave the frame"))
                    continue
                frame = compose(img, pl, tint, sname, credit=short_credit(p) if sname == "og" else None)
                name = "og.jpg" if sname == "og" else f"{sname}-{W}.webp"
                if sname == "og":
                    frame.save(os.path.join(d, name), "JPEG", quality=86, optimize=True, progressive=True)
                else:
                    frame.save(os.path.join(d, name), "WEBP", quality=80, method=6)
                files.append({"src": f"/media/news/players/{pid}/{name}", "w": pl["W"], "h": pl["H"], "scale": round(pl["s"], 3), "mode": pl["mode"]})
            if files:
                entry["slots"][sname] = files
        if "wide" not in entry["slots"]:
            problems.append((p["display_name"], "no wide derivative within the upscale limit"))
        players[pid] = entry
        if n % 20 == 0:
            print(n, "/", len(approved))
    # never leave a derivative folder for a player who is not approved
    appr = {p["espn_athlete_id"] for p in ledger["players"] if p["status"] == "approved"}
    for dn in os.listdir(OUT):
        if dn not in appr:
            import shutil
            shutil.rmtree(os.path.join(OUT, dn))
            players.pop(dn, None)
    manifest = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "ledger_promoted_at": ledger.get("promoted_at"),
        "method": {
            "source": "The ledger's approved Commons file for each player (<=2560 px rendition), identity and rights as reviewed in data/player-photos.json.",
            "framing": "Reviewed face box from the ledger; eye line at 40% of the box; head = face +45% up +10% headroom, always fully inside the frame (stage-6 rules). Never upscaled beyond 1.3x: larger sizes are omitted, not blown up.",
            "treatment": "Subject sharp in the foreground; the rest of the photo defocused and dimmed, and every other detected face (YuNet) held out of the sharp zone so only the pictured player is in focus; frame areas outside the photo filled with a defocused, dimmed, team-tinted cover of the same photo. No top-centre crops, no stretching.",
            "slots": {k: {"aspect": round(v["aspect"], 4), "widths": v["widths"]} for k, v in SLOTS.items()},
            "credit": "Every slot carries the ledger attribution; og.jpg prints it on the image.",
        },
        "players": dict(sorted(players.items())),
    }
    with open(MANIFEST, "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps(manifest, indent=1, ensure_ascii=False))
    print("players", len(players), "problems", len(problems))
    for pr in problems:
        print("  PROBLEM", pr)
    return players


def sheets(players, per=18):
    """Review sheets: per player the 16:9 wide (as used on cards/leads) and the 8:9 half (matchups)."""
    os.makedirs(SHEETS, exist_ok=True)
    for f in os.listdir(SHEETS):
        os.remove(os.path.join(SHEETS, f))
    items = sorted(players.items(), key=lambda kv: kv[1]["name"])
    cw, chh, cols = 640, 250, 3
    for si in range(0, len(items), per):
        chunk = items[si:si + per]
        rows = (len(chunk) + cols - 1) // cols
        canvas = Image.new("RGB", (cw * cols, chh * rows), (28, 26, 24))
        d = ImageDraw.Draw(canvas)
        for k, (pid, e) in enumerate(chunk):
            x, y = (k % cols) * cw, (k // cols) * chh
            wide = Image.open(os.path.join(ROOT, "public", e["slots"]["wide"][-1]["src"].lstrip("/"))).convert("RGB").resize((384, 216))
            half = Image.open(os.path.join(ROOT, "public", e["slots"]["half"][-1]["src"].lstrip("/"))).convert("RGB").resize((192, 216))
            canvas.paste(wide, (x + 8, y + 28))
            canvas.paste(half, (x + 400, y + 28))
            d.text((x + 8, y + 6), f"{e['name']} ({e['team_abbr']}) {pid}", fill=(236, 226, 205), font=font(14))
        canvas.save(os.path.join(SHEETS, f"sheet-{si // per + 1:02d}.png"))
    print("sheets:", len(os.listdir(SHEETS)))


if __name__ == "__main__":
    only = set(a for a in sys.argv[1:] if not a.startswith("--"))
    ps = build(only or None)
    sheets(ps)
