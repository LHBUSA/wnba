"""Owned atmospheric raster: an empty, dimly lit professional basketball arena.

Deterministic numpy ray-cast (fixed seed). No photographs, no logos, no text, no people.
Scene: hardwood floor + apron, four raked seating bowls with blank glowing ribbon fascia,
overhead light rig with shaped beams in haze, glossy floor reflections, bloom, grain,
vignette, warm gold/brown grade with a restrained orange accent.

usage: python render2.py <width> <out.png>
"""
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

W = int(sys.argv[1]) if len(sys.argv) > 1 else 1200
H = int(W * 9 / 16)
OUT = sys.argv[2] if len(sys.argv) > 2 else "arena.png"
rng = np.random.default_rng(20260915)
INF = 1e9

# ---------------------------------------------------------------- camera
cam = np.array([-3.0, 10.5, -30.0])
look = np.array([1.0, 4.5, 3.0])
fwd = look - cam; fwd /= np.linalg.norm(fwd)
right = np.cross(fwd, [0, 1, 0]); right /= np.linalg.norm(right)
up = np.cross(right, fwd)
fov = np.radians(76)
xs = (np.arange(W) + 0.5) / W * 2 - 1
ys = 1 - (np.arange(H) + 0.5) / H * 2
px, py = np.meshgrid(xs * np.tan(fov / 2), ys * np.tan(fov / 2) * H / W)
D = fwd[None, None, :] + px[..., None] * right + py[..., None] * up
D /= np.linalg.norm(D, axis=-1, keepdims=True)

# ---------------------------------------------------------------- scene constants
CX, CZ = 7.62, 14.33           # half court
AX, AZ = 10.5, 18.0            # half floor incl. apron
RAKE = np.tan(np.radians(30))
TOP = 12.5                     # top of lower bowl (ribbon fascia)
RIB = 0.9                      # ribbon band height
ORANGE = np.array([1.0, 0.46, 0.14])
GOLD = np.array([1.0, 0.74, 0.36])

lights = []
for side in (-1, 1):
    for lz in np.linspace(-15, 15, 9):
        lights.append((side * 12.5, 21.0 + rng.uniform(-.3, .3), lz, 1.0 + rng.uniform(-.2, .2)))
for end in (1,):  # far baseline only; near-baseline fixtures sit behind the camera
    for lx in np.linspace(-8, 8, 5):
        lights.append((lx, 21.5, end * 20.5, 0.9))
L = np.array(lights)
L_pos = L[:, :3]
aim = np.stack([L[:, 0] * 0.25, np.zeros(len(L)), L[:, 2] * 0.55], -1)
L_axis = aim - L_pos
L_axis /= np.linalg.norm(L_axis, axis=-1, keepdims=True)


def floor_hit(O, Dr):
    with np.errstate(divide="ignore", invalid="ignore"):
        t = np.where(Dr[..., 1] < -1e-6, -O[..., 1] / Dr[..., 1], INF)
    x = O[..., 0] + t * Dr[..., 0]
    z = O[..., 2] + t * Dr[..., 2]
    ok = (t > 1e-4) & (np.abs(x) <= AX) & (np.abs(z) <= AZ)
    return np.where(ok, t, INF), x, z


def stands_hit(O, Dr):
    best = np.full(Dr.shape[:-1], INF)
    along_b = np.zeros(Dr.shape[:-1])
    pos_b = np.zeros(Dr.shape)
    for axis, sign, edge in ((0, 1, AX), (0, -1, AX), (2, 1, AZ), (2, -1, AZ)):
        num = O[..., 1] - RAKE * sign * O[..., axis] + RAKE * edge
        den = Dr[..., 1] - RAKE * sign * Dr[..., axis]
        with np.errstate(divide="ignore", invalid="ignore"):
            t = np.where(np.abs(den) > 1e-9, -num / den, INF)
        p = O + t[..., None] * Dr
        along = sign * p[..., axis] - edge
        other = p[..., 2] if axis == 0 else p[..., 0]
        lim = (AZ if axis == 0 else AX) + along
        ok = (t > 1e-4) & (along >= 0) & (p[..., 1] <= TOP) & (np.abs(other) <= lim)
        better = ok & (t < best)
        best = np.where(better, t, best)
        along_b = np.where(better, along, along_b)
        pos_b = np.where(better[..., None], p, pos_b)
    return best, along_b, pos_b


def ribbon_emission(p, along):
    """Blank LED ribbon fascia: top-of-bowl band and a courtside band. No text, no marks."""
    y = p[..., 1]
    top = np.clip(1 - np.abs(y - (TOP - RIB / 2)) / (RIB / 2), 0, 1) ** 0.35
    court = np.clip(1 - np.abs(along - 0.3) / 0.3, 0, 1) ** 0.8 * 0.22
    u = p[..., 0] + p[..., 2]
    shimmer = 0.85 + 0.15 * np.sin(u * 0.9) * np.sin(u * 0.23 + 1.3)
    e = (top * 1.0 + court) * shimmer
    tint = ORANGE * (0.55 + 0.45 * np.sin(u * 0.05)[..., None] ** 2) + GOLD * 0.35
    return e[..., None] * tint


O = np.broadcast_to(cam, D.shape)
tf, fx, fz = floor_hit(O, D)
ts, s_along, s_pos = stands_hit(O, D)
on_floor = tf < ts
on_stand = (ts < tf) & (ts < INF)
t_hit = np.minimum(tf, ts)
col = np.zeros(D.shape)

# ---------------------------------------------------------------- floor
dist = np.where(on_floor, tf, 1.0)
detail = np.clip(1.25 - dist / 55, 0.1, 1)
plank_w = 0.28
pi_ = np.floor((fx + 50) / plank_w)
seg = np.floor((fz + 60 + (pi_ % 7) * 0.37) / 2.1)
h = np.sin(pi_ * 12.9898 + seg * 78.233) * 43758.5453; h -= np.floor(h)
grain = np.sin(fz * 19.0 + np.sin(fx * 3.7 + pi_) * 2.2) * 0.5 + 0.5
tone = 0.82 + (h - 0.5) * 0.34 * detail + (grain - 0.5) * 0.12 * detail
seam = np.abs(((fx + 50) / plank_w) % 1 - 0.5) * 2
tone *= 1 - 0.20 * detail * (seam > 0.95)
wood = np.stack([0.62 * tone, 0.41 * tone, 0.22 * tone], -1)
apron = (np.abs(fx) > CX + 1.0) | (np.abs(fz) > CZ + 1.0)
wood = np.where(apron[..., None], wood * np.array([0.30, 0.22, 0.20]), wood)


def band(v, w):
    return np.clip(1 - np.abs(v) / w, 0, 1)


lw = 0.045 + dist * 0.0016
ln = band(np.abs(fx) - CX, lw) * (np.abs(fz) <= CZ + lw)
ln = np.maximum(ln, band(np.abs(fz) - CZ, lw) * (np.abs(fx) <= CX + lw))
ln = np.maximum(ln, band(fz, lw) * (np.abs(fx) <= CX))
ln = np.maximum(ln, band(np.hypot(fx, fz) - 1.83, lw))
for s in (1, -1):
    zz = s * fz
    rim = CZ - 1.6
    ln = np.maximum(ln, band(np.abs(fx) - 2.44, lw) * (zz >= CZ - 5.8) * (zz <= CZ))
    ln = np.maximum(ln, band(zz - (CZ - 5.8), lw) * (np.abs(fx) <= 2.44))
    ln = np.maximum(ln, band(np.hypot(fx, zz - (CZ - 5.8)) - 1.83, lw) * (zz < CZ - 5.8))
    ra = np.hypot(fx, zz - rim)
    ln = np.maximum(ln, band(ra - 6.75, lw) * (zz <= rim) * (np.abs(fx) <= 6.6))
    ln = np.maximum(ln, band(np.abs(fx) - 6.6, lw) * (zz > rim - 1.2) * (zz <= CZ))
    ln = np.maximum(ln, band(ra - 1.25, lw) * (zz <= rim))
wood = wood * (1 - 0.6 * ln[..., None]) + np.array([0.86, 0.82, 0.74]) * 0.6 * ln[..., None]

FP = np.stack([fx, np.zeros_like(fx), fz], -1)
diff = np.zeros(fx.shape)
for (lx, ly, lz, li), ax in zip(L, L_axis):
    v = np.array([lx, ly, lz]) - FP
    d2 = (v ** 2).sum(-1)
    vn = v / np.sqrt(d2)[..., None]
    spot = np.clip(-(vn * ax).sum(-1), 0, 1) ** 18
    diff += li * spot * 70 / d2
pool = np.exp(-(fx ** 2 / (2 * 9.5 ** 2) + fz ** 2 / (2 * 17 ** 2)))
diff = diff * (0.25 + 0.75 * pool)

R = D.copy(); R[..., 1] *= -1
spec = np.zeros(fx.shape)
for (lx, ly, lz, li) in L:
    v = np.array([lx, ly, lz]) - FP
    vn = v / np.linalg.norm(v, axis=-1, keepdims=True)
    c = np.clip((R * vn).sum(-1), 0, 1)
    spec += li * (c ** 3000 * 2.2 + c ** 220 * 0.20 + c ** 30 * 0.02)
spec *= np.clip((dist - 14) / 22, 0.08, 1)  # keep near-camera glints from blooming into blobs
tr, ralong, rpos = stands_hit(FP + np.array([0, 1e-3, 0]), R)
rib_refl = np.where((tr < INF)[..., None], ribbon_emission(rpos, ralong), 0)
cos_i = np.clip(-D[..., 1], 0, 1)
fres = 0.06 + 0.94 * (1 - cos_i) ** 5
floor_col = wood * (0.012 + diff[..., None] * 0.9)
floor_col += spec[..., None] * GOLD * (0.25 + 0.75 * (~apron)[..., None])
floor_col += rib_refl * (0.10 + 0.9 * fres[..., None]) * 0.55
col = np.where(on_floor[..., None], floor_col, col)

# ---------------------------------------------------------------- stands
rowp = s_along / 0.74
riser = ((rowp % 1) > 0.72).astype(float)
seat_u = (s_pos[..., 0] + s_pos[..., 2]) / 0.5
sh = np.sin(np.floor(seat_u) * 91.7 + np.floor(rowp) * 47.3) * 9631.7; sh -= np.floor(sh)
seat = np.array([0.075, 0.032, 0.024]) * (0.75 + 0.5 * sh[..., None])
seat = seat * (1 - riser[..., None]) + np.array([0.030, 0.026, 0.022]) * riser[..., None]
aisle = (np.abs(((s_pos[..., 0] + s_pos[..., 2]) / 8.0) % 1 - 0.5) < 0.03)
seat = np.where(aisle[..., None], np.array([0.05, 0.044, 0.038]), seat)
spill = 0.05 + 0.55 * np.exp(-s_along / 5.5)
ribbon_light = 0.35 * np.exp(-np.abs(s_pos[..., 1] - TOP) / 1.6)
stand_col = seat * (spill + ribbon_light)[..., None]
stand_col += ribbon_emission(s_pos, s_along) * 0.9
speck = (rng.random(fx.shape) > 0.99988) & on_stand & (s_along > 2) & (s_pos[..., 1] < TOP - 1.2)
stand_col += speck[..., None] * np.array([1.0, 0.62, 0.30]) * 0.5
col = np.where(on_stand[..., None], stand_col, col)

# ---------------------------------------------------------------- roof (dark)
roof = ~(on_floor | on_stand)
up_amt = np.clip(D[..., 1] + 0.1, 0, 1)
col = np.where(roof[..., None], np.array([0.010, 0.008, 0.007]) * (1 + up_amt[..., None]), col)

# ---------------------------------------------------------------- beams in haze + fixture glare
t_end = np.minimum(t_hit, 80.0)
beam = np.zeros(fx.shape)
glare = np.zeros(fx.shape)
for (lx, ly, lz, li), ax in zip(L, L_axis):
    lp = np.array([lx, ly, lz])
    rel = lp - cam
    tc = (D * rel).sum(-1)
    acc = np.zeros(fx.shape)
    for frac in np.linspace(0.08, 1.0, 7):
        tt = t_end * frac
        P = cam + tt[..., None] * D
        v = P - lp
        dd = np.linalg.norm(v, axis=-1) + 0.4
        cosang = (v * ax).sum(-1) / dd
        shaft = np.clip(cosang, 0, 1) ** 38
        acc += shaft / (1 + (dd / 14) ** 2)
    beam += li * acc * (t_end / 7)
    hh = np.linalg.norm(cam + tc[..., None] * D - lp, axis=-1)
    visible = (tc > 0) & (tc < t_hit)
    glare += li * visible * (np.exp(-hh ** 2 / 0.025) * 9 + 0.6 / (1 + (hh / 0.7) ** 2) * 0.35)
col += beam[..., None] * np.array([1.0, 0.78, 0.50]) * 0.030
col += glare[..., None] * np.array([1.0, 0.92, 0.78]) * 0.55

# ---------------------------------------------------------------- post
bright = np.clip(col - 0.6, 0, None)
bloom = sum(gaussian_filter(bright, sigma=(s, s, 0)) * w for s, w in ((W / 300, 0.8), (W / 80, 0.55), (W / 22, 0.30)))
col = col + bloom
far = np.clip((t_hit - 38) / 30, 0, 1) * (~on_floor)
soft = gaussian_filter(col, sigma=(W / 1100, W / 1100, 0))
col = col * (1 - far[..., None]) + soft * far[..., None]
col = col * 1.6
col = col / (1 + col)
col = np.clip(col, 0, 1) ** (1 / 1.05)
lum = (col * [0.2126, 0.7152, 0.0722]).sum(-1, keepdims=True)
col = col + np.array([0.030, 0.018, 0.008]) * (1 - lum) * 0.6
col = col * np.array([1.03, 0.97, 0.86])
vx, vy = np.meshgrid(np.linspace(-1, 1, W), np.linspace(-1, 1, H))
vig = 1 - 0.6 * np.clip(vx ** 2 * 0.75 + vy ** 2 * 1.05 - 0.2, 0, 1)
col *= vig[..., None]
col += rng.standard_normal((H, W, 1)) * 0.010
img = (np.clip(col, 0, 1) * 255 + 0.5).astype(np.uint8)
Image.fromarray(img).save(OUT)
print(OUT, W, H, "mean", img.mean(axis=(0, 1)).round(1))
