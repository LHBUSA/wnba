"""
Build the PropBetEdge WNBA identity package from the canonical, owned
PropBetEdge artwork.

Canonical source (documented in docs/BRAND.md):
  https://propbetedge.ai/logo/pbe-full-600.png
  sha256 53d5f2a15297578b323db7ef216dcb34d3eb2fe3e9a9b46401634ae3609af7e5
  = propbetedge-news-site/public/logo/pbe-full-600.png
  = nba-propbetedge/scripts/brand/src/pbe-full-600.png (same bytes)
Copied here as scripts/brand/src/pbe-full-600.png; the build refuses any other bytes.

Outputs
  public/brand/pbe-mark-{32,64,96}.webp + pbe-mark-64.png   header/footer PBE mark (letters only)
  public/favicon.svg, favicon.ico (16/32/48), favicon-16x16.png, favicon-32x32.png
  public/apple-touch-icon.png (180, opaque), icon-192.png, icon-512.png, icon-maskable-512.png
  public/site.webmanifest
  public/share/propbetedge-wnba-social-v3.jpg   master 1200x630 share card
  public/share/propbetedge-logo-v3-512.png      JSON-LD Organization / publisher logo
  public/media/teams/<id>/og.png                PNG twins of the self-hosted 320 team marks (the share-card
                                                renderer cannot decode WebP)
  workers/wnba-web/src/brand-mark.js            the PBE mark as base64 PNG for the share-card renderer

The favicon glyph is the orange basketball "B" isolated from the PBE mark (the NBA
precedent): the 2.6:1 "PBE" is unreadable at 16px, the B alone stays recognisable,
and the basketball inside it is the sport treatment. No league or team marks.

    python scripts/brand/build-brand-assets.py
"""
import base64, hashlib, io, json, os
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PUB = os.path.join(ROOT, 'public')
SRC = os.path.join(ROOT, 'scripts', 'brand', 'src', 'pbe-full-600.png')
SRC_SHA256 = '53d5f2a15297578b323db7ef216dcb34d3eb2fe3e9a9b46401634ae3609af7e5'
FONTS = os.path.join(ROOT, 'workers', 'wnba-web', 'fonts')
INK = (15, 13, 10)          # --ink   #0f0d0a
INK2 = (28, 24, 19)         # --ink-2 #1c1813
GOLD = (212, 175, 55)       # --gold  #d4af37
GOLD_B = (236, 201, 92)     # --gold-bright #ecc95c
FLAME = (255, 122, 47)      # --flame #ff7a2f
PAPER = (245, 241, 235)     # --paper #f5f1eb
DIM = (184, 178, 166)       # --dim   #b8b2a6


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def source():
    with open(SRC, 'rb') as f:
        raw = f.read()
    if hashlib.sha256(raw).hexdigest() != SRC_SHA256:
        raise SystemExit('pbe-full-600.png is not the canonical PropBetEdge artwork (sha256 mismatch)')
    return Image.open(io.BytesIO(raw)).convert('RGBA')


def b_glyph(im):
    """The orange 'B' of the PBE mark, isolated with transparent surroundings (NBA builder method)."""
    c = im.crop((388, 0, 662, 420))          # the B column band (lightning arrow excluded)
    w, h = c.size
    px = c.load()
    m = Image.new('L', (w, h), 0)
    mp = m.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 160 and r > 120 and r - g > 45 and r - b > 60:
                mp[x, y] = 255
    m = m.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(3))
    pad = Image.new('L', (w + 2, h + 2), 0)
    pad.paste(m, (1, 1))
    ImageDraw.floodfill(pad, (0, 0), 128)   # outside = 128; enclosed ball areas stay filled
    filled = pad.point(lambda v: 0 if v == 128 else 255).crop((1, 1, w + 1, h + 1)).filter(ImageFilter.MaxFilter(3))
    out = c.copy()
    out.putalpha(ImageChops.multiply(c.getchannel('A'), filled))
    return out.crop(out.getbbox())


def pbe_mark(im):
    """The PBE mark (letters only, no wordmark) from the full lockup."""
    top = im.crop((0, 0, im.width, 425))
    return top.crop(top.getbbox())


def fit(img, box_w, box_h):
    s = min(box_w / img.width, box_h / img.height)
    return img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)


def by_height(img, h):
    return img.resize((max(1, round(img.width * h / img.height)), h), Image.LANCZOS)


def tile(glyph, size, pad_ratio, rounded):
    bg = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(bg)
    if rounded:
        d.rounded_rectangle((0, 0, size - 1, size - 1), radius=round(size * 0.22), fill=INK + (255,))
    else:
        d.rectangle((0, 0, size - 1, size - 1), fill=INK + (255,))
    inner = round(size * (1 - 2 * pad_ratio))
    g = fit(glyph, inner, inner)
    bg.alpha_composite(g, ((size - g.width) // 2, (size - g.height) // 2))
    return bg


def save_png(img, rel):
    path = os.path.join(PUB, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)


def build_marks(mark):
    os.makedirs(os.path.join(PUB, 'brand'), exist_ok=True)
    for h in (32, 64, 96):
        by_height(mark, h).save(os.path.join(PUB, 'brand', f'pbe-mark-{h}.webp'), quality=92, method=6)
    save_png(by_height(mark, 64), 'brand/pbe-mark-64.png')
    return by_height(mark, 64).size


def build_icons(glyph):
    frames = [tile(glyph, s, 0.06, True) for s in (16, 32, 48)]
    frames[-1].save(os.path.join(PUB, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)], append_images=frames[:-1])
    save_png(frames[0], 'favicon-16x16.png')
    save_png(frames[1], 'favicon-32x32.png')
    # favicon.svg: rounded ink tile + the owned raster glyph (tracing to vectors would alter the artwork).
    buf = io.BytesIO()
    fit(glyph, 72, 72).save(buf, 'PNG', optimize=True)
    g = fit(glyph, 112, 112)
    b64 = base64.b64encode(buf.getvalue()).decode()
    x, y = (128 - g.width) / 2, (128 - g.height) / 2
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">'
           f'<rect width="128" height="128" rx="28" fill="#0f0d0a"/>'
           f'<image x="{x:g}" y="{y:g}" width="{g.width}" height="{g.height}" href="data:image/png;base64,{b64}"/></svg>\n')
    with open(os.path.join(PUB, 'favicon.svg'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(svg)
    # Apple touch: opaque square (iOS applies its own mask).
    save_png(tile(glyph, 180, 0.12, False).convert('RGB'), 'apple-touch-icon.png')
    save_png(tile(glyph, 192, 0.10, True), 'icon-192.png')
    save_png(tile(glyph, 512, 0.10, True), 'icon-512.png')
    # Maskable: full-bleed ink, glyph inside the 80% safe zone.
    save_png(tile(glyph, 512, 0.22, False).convert('RGB'), 'icon-maskable-512.png')


def build_manifest():
    manifest = {
        'name': 'PropBetEdge WNBA',
        'short_name': 'PBE WNBA',
        'description': 'Live WNBA intelligence from PropBetEdge: WNBACast, Player DNA, WinBA, matchups and data-backed news.',
        'id': '/',
        'start_url': '/',
        'scope': '/',
        'display': 'standalone',
        'background_color': '#0f0d0a',
        'theme_color': '#0f0d0a',
        'icons': [
            {'src': '/icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
            {'src': '/icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
            {'src': '/icon-maskable-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'},
        ],
    }
    with open(os.path.join(PUB, 'site.webmanifest'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(manifest, indent=2) + '\n')


def build_logo(mark):
    """Square publisher logo for JSON-LD: the PBE mark centred on the site ink."""
    img = Image.new('RGBA', (512, 512), INK + (255,))
    m = fit(mark, 452, 452)
    img.alpha_composite(m, ((512 - m.width) // 2, (512 - m.height) // 2))
    save_png(img.convert('RGB'), 'share/propbetedge-logo-v3-512.png')


def radial(size, center, radius, color, alpha):
    layer = Image.new('L', size, 0)
    cx, cy = center
    ImageDraw.Draw(layer).ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=alpha)
    layer = layer.filter(ImageFilter.GaussianBlur(radius * 0.45))
    return Image.new('RGB', size, color), layer


def tracked(d, xy, text, fnt, fill, track):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=fnt, fill=fill)
        x += d.textlength(ch, font=fnt) + track
    return x - track


def tracked_width(d, text, fnt, track):
    return sum(d.textlength(ch, font=fnt) + track for ch in text) - track


def build_social(mark):
    W, H = 1200, 630
    # Graphite base: warm near-black, lifted slightly toward the right where the mark sits.
    base = Image.new('RGB', (W, H), INK)
    grad = Image.linear_gradient('L').rotate(90).resize((W, H))
    base = Image.composite(Image.new('RGB', (W, H), (24, 21, 17)), base, grad.point(lambda v: int(v * 0.85)))
    # Depth: a gold key light behind the mark and a low ember glow bottom-right.
    for center, radius, color, alpha in (((905, 250), 330, (120, 92, 28), 150), ((1120, 640), 300, (150, 62, 18), 90), ((140, 90), 260, (48, 40, 28), 110)):
        col, mask = radial((W, H), center, radius, color, alpha)
        base = Image.composite(col, base, mask)
    img = base.convert('RGBA')

    # Analytical grid, fading from the right edge.
    grid = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    for x in range(0, W, 42):
        gd.line((x, 0, x, H), fill=PAPER + (10,), width=1)
    for y in range(0, H, 42):
        gd.line((0, y, W, y), fill=PAPER + (10,), width=1)
    fade = Image.linear_gradient('L').rotate(90).resize((W, H)).point(lambda v: int(v * 0.95))
    grid.putalpha(ImageChops.multiply(grid.getchannel('A'), fade))
    img = Image.alpha_composite(img, grid)

    # Original court line art (half-court geometry), faint gold, anchored right.
    art = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ad = ImageDraw.Draw(art)
    line = GOLD + (34,)
    ad.arc((560, -420, 1400, 420), 20, 160, fill=line, width=3)       # three-point arc (baseline at top)
    ad.rectangle((900, -10, 1160, 300), outline=line, width=3)          # the key
    ad.arc((930, 180, 1130, 420), 0, 180, fill=line, width=3)           # free-throw circle
    ad.ellipse((690, 520, 1370, 1200), outline=GOLD + (22,), width=3)  # centre circle rising from the bottom edge
    img = Image.alpha_composite(img, art.filter(ImageFilter.GaussianBlur(0.6)))

    d = ImageDraw.Draw(img)
    # Top rail: a thin gold-to-flame light line.
    rail = Image.new('RGBA', (W, 4), (0, 0, 0, 0))
    for x in range(W):
        t = x / (W - 1)
        c = tuple(round(a + (b - a) * t) for a, b in zip(GOLD_B, FLAME))
        a = round(255 * min(1, 2.2 * min(t, 1 - t) + 0.35))
        for y in range(4):
            rail.putpixel((x, y), c + (a,))
    img.alpha_composite(rail, (0, 0))

    # The canonical PBE mark, large, with a soft shadow and a gold halo (depth, not a flat sticker).
    m = fit(mark, 470, 250)
    mx, my = 1200 - 64 - m.width, 118
    alpha = m.getchannel('A')
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    shadow.paste(Image.new('RGBA', m.size, (0, 0, 0, 190)), (mx, my + 16), alpha)
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(18)))
    halo = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    halo.paste(Image.new('RGBA', m.size, GOLD + (70,)), (mx, my), alpha)
    img = Image.alpha_composite(img, halo.filter(ImageFilter.GaussianBlur(26)))
    img.alpha_composite(m, (mx, my))

    d = ImageDraw.Draw(img)
    X = 72
    f_brand = font('barlow-condensed-700.ttf', 44)
    f_wnba = font('barlow-condensed-700.ttf', 216)
    f_tag = font('barlow-condensed-700.ttf', 38)
    f_strip = font('inter-700.ttf', 25)
    f_handle = font('inter-700.ttf', 26)
    f_dom = font('inter-500.ttf', 22)

    # PROPBETEDGE (gold, tracked) over WNBA (paper, monumental).
    tracked(d, (X, 70), 'PROPBETEDGE', f_brand, GOLD_B, 7)
    asc = f_wnba.getmetrics()[0]
    wnba_top = 110
    d.text((X - 6, wnba_top), 'WNBA', font=f_wnba, fill=PAPER)
    wnba_base = wnba_top + asc
    # Flame underline accent under WNBA: the restrained basketball accent.
    d.rounded_rectangle((X, wnba_base + 22, X + 120, wnba_base + 28), radius=3, fill=FLAME)
    tag_y = wnba_base + 50
    tracked(d, (X, tag_y), 'LIVE SPORTS INTELLIGENCE', f_tag, PAPER, 6)

    # Feature strip.
    items = ['WNBACast', 'Player DNA', 'WinBA', 'Matchups', 'News']
    x, y = X, 486
    for i, it in enumerate(items):
        if i:
            d.ellipse((x + 11, y + 13, x + 18, y + 20), fill=GOLD)
            x += 30
        d.text((x, y), it, font=f_strip, fill=DIM)
        x += d.textlength(it, font=f_strip)

    # Footer identity.
    d.line((X, 548, W - 64, 548), fill=PAPER + (28,), width=1)
    d.text((X, 568), '@PROPBETEDGE', font=f_handle, fill=GOLD_B)
    dom = 'wnba.propbetedge.ai'
    d.text((W - 64 - d.textlength(dom, font=f_dom), 571), dom, font=f_dom, fill=DIM)

    out = img.convert('RGB')
    out.save(os.path.join(PUB, 'share', 'propbetedge-wnba-social-v3.jpg'), quality=90, optimize=True, progressive=True)
    return out


def build_team_pngs():
    """PNG twins of the self-hosted 320px team marks: resvg (share cards) cannot decode WebP."""
    manifest = json.load(open(os.path.join(ROOT, 'data', 'team-logos.json'), encoding='utf-8'))
    n = 0
    for t in manifest['teams']:
        src = os.path.join(PUB, t['files']['320'].lstrip('/'))
        if not os.path.exists(src):
            continue
        Image.open(src).convert('RGBA').save(os.path.join(os.path.dirname(src), 'og.png'), optimize=True)
        n += 1
    return n


def build_worker_mark(mark):
    """The PBE mark bundled into wnba-web so every share card carries it without a network fetch."""
    m = by_height(mark, 132)
    buf = io.BytesIO()
    m.save(buf, 'PNG', optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode()
    js = ('// Generated by scripts/brand/build-brand-assets.py from the canonical PropBetEdge artwork\n'
          f'// (https://propbetedge.ai/logo/pbe-full-600.png, sha256 {SRC_SHA256[:16]}…). Do not edit.\n'
          f'export const PBE_MARK_W = {m.width};\n'
          f'export const PBE_MARK_H = {m.height};\n'
          f"export const PBE_MARK_PNG = 'data:image/png;base64,{b64}';\n")
    with open(os.path.join(ROOT, 'workers', 'wnba-web', 'src', 'brand-mark.js'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(js)
    return m.size


if __name__ == '__main__':
    im = source()
    mark = pbe_mark(im)
    glyph = b_glyph(im)
    print('header mark 64px:', build_marks(mark))
    build_icons(glyph)
    build_manifest()
    build_logo(mark)
    print('social v3:', build_social(mark).size)
    print('team og.png:', build_team_pngs())
    print('worker mark:', build_worker_mark(mark))
