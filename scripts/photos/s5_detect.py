"""Stage 5: download ~1600px Commons thumbs for every candidate file and run Haar face detection."""
import hashlib
import sys
from common import *
import cv2
import numpy as np

commons = load_json("cache/commons.json")
IMG = os.path.join(CACHE, "img")
os.makedirs(IMG, exist_ok=True)
H = cv2.data.haarcascades
C_DEF = cv2.CascadeClassifier(H + "haarcascade_frontalface_default.xml")
C_ALT2 = cv2.CascadeClassifier(H + "haarcascade_frontalface_alt2.xml")
C_PROF = cv2.CascadeClassifier(H + "haarcascade_profileface.xml")
YN = cv2.FaceDetectorYN.create(os.path.join(BASE, "models", "yunet.onnx"), "", (320, 320), 0.6, 0.3, 5000)


def local_path(fname, kind="thumb"):
    h = hashlib.md5(fname.encode("utf-8")).hexdigest()[:16]
    return os.path.join(IMG, f"{h}_{kind}.img")


def fetch(fname, c, kind="thumb"):
    p = local_path(fname, kind)
    if os.path.exists(p) and os.path.getsize(p) > 0:
        return p
    url = c["thumb_url"] if kind == "thumb" and c.get("thumb_url") else c["original_url"]
    data = http_get(url, binary=True, timeout=120)
    with open(p, "wb") as f:
        f.write(data)
    return p


def iou(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix = max(0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    return inter / float(aw * ah + bw * bh - inter) if inter else 0.0


def detect(path):
    data = np.fromfile(path, dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        return None
    h, w = img.shape[:2]
    gray = cv2.equalizeHist(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    mn = max(24, int(min(w, h) * 0.03))
    d = [tuple(int(v) for v in r) for r in C_DEF.detectMultiScale(gray, 1.1, 5, minSize=(mn, mn))]
    a2 = [tuple(int(v) for v in r) for r in C_ALT2.detectMultiScale(gray, 1.1, 4, minSize=(mn, mn))]
    faces = []
    for r in d:
        conf = any(iou(r, s) > 0.3 for s in a2)
        faces.append({"box": list(r), "src": "frontal_default", "alt2_confirmed": conf})
    prof = []
    if not faces:
        for flip in (False, True):
            g = cv2.flip(gray, 1) if flip else gray
            for r in C_PROF.detectMultiScale(g, 1.1, 5, minSize=(mn, mn)):
                x, y, fw, fh = [int(v) for v in r]
                if flip:
                    x = w - x - fw
                prof.append({"box": [x, y, fw, fh], "src": "profile" + ("_flipped" if flip else ""), "alt2_confirmed": False})
        # dedupe flipped/non-flipped overlaps
        for f in sorted(prof, key=lambda f: -f["box"][2]):
            if not any(iou(f["box"], g["box"]) > 0.3 for g in faces):
                faces.append(f)
    # ---- YuNet cross-validation (two scales, merged) ----
    yn = []
    for maxdim in (1600, 640):
        s = min(1.0, maxdim / max(w, h))
        im2 = img if s == 1.0 else cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
        YN.setInputSize((im2.shape[1], im2.shape[0]))
        _, res = YN.detect(im2)
        if res is None:
            continue
        for row in res:
            v = [float(t) / s for t in row[:14]]
            yn.append({"box": [int(v[0]), int(v[1]), int(v[2]), int(v[3])],
                       "eyes": [[v[4], v[5]], [v[6], v[7]]], "nose": [v[8], v[9]],
                       "mouth": [[v[10], v[11]], [v[12], v[13]]], "score": float(row[14])})
    merged = []
    for f in sorted(yn, key=lambda f: -f["score"]):
        if not any(iou(f["box"], g["box"]) > 0.3 for g in merged):
            merged.append(f)
    for f in merged:
        f["haar_agree"] = [i for i, g in enumerate(faces) if iou(f["box"], g["box"]) > 0.2 or
                           (g["box"][0] <= (f["eyes"][0][0] + f["eyes"][1][0]) / 2 <= g["box"][0] + g["box"][2] and
                            g["box"][1] <= (f["eyes"][0][1] + f["eyes"][1][1]) / 2 <= g["box"][1] + g["box"][3] and
                            0.5 < g["box"][2] / max(1, f["box"][2]) < 2.0)]
    return {"w": w, "h": h, "faces": sorted(faces, key=lambda f: -f["box"][2] * f["box"][3]),
            "yunet": sorted(merged, key=lambda f: -f["box"][2] * f["box"][3])}


if __name__ == "__main__":
    det = load_json("cache/faces.json", {})
    files = [f for f, c in commons.items() if c.get("license_ok")]
    for i, f in enumerate(files):
        if f in det and "--redo" not in sys.argv:
            continue
        c = commons[f]
        try:
            p = fetch(f, c, "thumb")
        except Exception as e:
            det[f] = {"error": f"download failed: {e}"}
            print("ERR", f, e)
            continue
        r = detect(p)
        if r is None:
            det[f] = {"error": "decode failed"}
            continue
        r["path"] = p
        det[f] = r
        if i % 20 == 0:
            save_json("cache/faces.json", det)
            print(i, len(files))
    save_json("cache/faces.json", det)
    from collections import Counter
    print(Counter(len(v.get("faces", [])) for v in det.values()))
