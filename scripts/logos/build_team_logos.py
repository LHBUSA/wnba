"""Build the WNBA team-logo set served from our own origin.

Source: ESPN's team API `logos[]` entry with rel ["full","dark"] (the variant
ESPN designs for dark backgrounds). Each logo is downloaded once, trimmed to
its visible pixels, centred on a transparent square with a uniform margin (so
every team renders at the same optical size), and exported as lossless-alpha
WebP at 64 / 128 / 320 px (retina for 32 / 64 / 160 CSS px). Never upscaled
past the 500 px source; never stretched (aspect kept, padding transparent).

Team marks belong to their teams; they are used to identify teams only.

Usage: python scripts/logos/build_team_logos.py   (needs Pillow)
"""
import hashlib, io, json, os, sys, urllib.request, datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'media', 'teams')
MANIFEST = os.path.join(ROOT, 'data', 'team-logos.json')
TEAMS_URL = 'https://site.web.api.espn.com/apis/site/v2/sports/basketball/wnba/teams'
SIZES = (64, 128, 320)
MARGIN = 0.08  # 8% transparent margin on every side after trimming
UA = {'User-Agent': 'PropBetEdge-WNBA/1.0 logo-build'}

from PIL import Image  # noqa: E402


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read()


def main():
    teams = json.loads(fetch(TEAMS_URL))['sports'][0]['leagues'][0]['teams']
    os.makedirs(OUT, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    out = []
    for x in teams:
        t = x['team']
        dark = next((l for l in t.get('logos', []) if l.get('rel') == ['full', 'dark']), None)
        default = next((l for l in t.get('logos', []) if l.get('rel') == ['full', 'default']), None)
        pick = dark or default
        if not pick:
            print('no logo for', t['abbreviation'], file=sys.stderr)
            continue
        raw = fetch(pick['href'])
        img = Image.open(io.BytesIO(raw)).convert('RGBA')
        bbox = img.getchannel('A').getbbox()
        if not bbox:
            raise SystemExit(f"empty alpha for {t['abbreviation']}")
        crop = img.crop(bbox)
        w, h = crop.size
        side = int(round(max(w, h) * (1 + 2 * MARGIN)))
        canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        canvas.paste(crop, ((side - w) // 2, (side - h) // 2), crop)
        d = os.path.join(OUT, str(t['id']))
        os.makedirs(d, exist_ok=True)
        files = {}
        for s in SIZES:
            target = min(s, side)
            im = canvas.resize((target, target), Image.LANCZOS) if target != side else canvas
            if target < s:  # never upscale: centre the smaller mark on the requested canvas
                c2 = Image.new('RGBA', (s, s), (0, 0, 0, 0))
                c2.paste(im, ((s - target) // 2, (s - target) // 2), im)
                im = c2
            p = os.path.join(d, f'{s}.webp')
            im.save(p, 'WEBP', lossless=True, quality=100, method=6)
            files[str(s)] = f'/media/teams/{t["id"]}/{s}.webp'
        out.append({
            'team_id': str(t['id']), 'abbr': t['abbreviation'], 'name': t['displayName'],
            'color': f"#{t['color']}" if t.get('color') else None,
            'alt_color': f"#{t['alternateColor']}" if t.get('alternateColor') else None,
            'variant': 'dark' if dark else 'default',
            'source_url': pick['href'], 'source_sha256': hashlib.sha256(raw).hexdigest(),
            'source_size': list(img.size), 'trim_bbox': list(bbox), 'square_side_px': side,
            'files': files, 'fetched_at': now,
        })
        print(t['abbreviation'], pick['href'].split('/i/')[-1], img.size, '->', side)
    out.sort(key=lambda r: r['name'])
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump({'generated_at': now, 'source': 'ESPN team API logos (rel full+dark)', 'usage': 'Team identification only. Marks belong to their teams; PropBetEdge is not affiliated with the WNBA or its teams.', 'sizes_px': list(SIZES), 'teams': out}, f, indent=1)
    print(f'{len(out)} team logos -> {MANIFEST}')


if __name__ == '__main__':
    main()
