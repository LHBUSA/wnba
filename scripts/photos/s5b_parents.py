"""Stage 5b: for chosen P18 files whose frame clips the head (crop pinned to the source edge), follow the
Commons {{Extracted from|...}} link to the uncropped parent file, verify license, locate the child inside the parent
by template matching (so the SAME person is cropped), and register the parent as an extra candidate."""
from common import *
from commonsmeta import fetch_records, wikitext
from s5_detect import fetch, detect, local_path, iou
import cv2
import numpy as np

commons = load_json("cache/commons.json")
faces = load_json("cache/faces.json")
crops = load_json("cache/crops.json")
parents = load_json("cache/parents.json", {})

RX = re.compile(r"\{\{\s*(?:extracted[ _]from|extracted|cropped[ _]from|derived[ _]from)\s*\|\s*(?:1\s*=\s*)?(?:\s*(?:file|image)\s*:)?\s*([^|}\n]+)", re.I)


def gray(path, maxw=None):
    img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    return img


def locate(child_path, child_orig_w, parent_path, parent_orig_w):
    C = gray(child_path)
    P = gray(parent_path)
    f0 = (child_orig_w / C.shape[1]) * (P.shape[1] / parent_orig_w)  # child-thumb px -> parent-thumb px
    k = min(1.0, 900 / max(P.shape))
    Ps = cv2.resize(P, (int(P.shape[1] * k), int(P.shape[0] * k)), interpolation=cv2.INTER_AREA)
    best = (-1, None, None)
    for m in (1.0, 0.98, 1.02, 0.95, 1.05, 0.9, 1.1):
        f = f0 * m
        w, h = int(C.shape[1] * f * k), int(C.shape[0] * f * k)
        if w < 20 or h < 20 or w > Ps.shape[1] or h > Ps.shape[0]:
            continue
        Cs = cv2.resize(C, (w, h), interpolation=cv2.INTER_AREA)
        res = cv2.matchTemplate(Ps, Cs, cv2.TM_CCOEFF_NORMED)
        _, mx, _, loc = cv2.minMaxLoc(res)
        if mx > best[0]:
            best = (mx, (loc[0] / k, loc[1] / k), f)
        if mx > 0.95:
            break
    return best


todo = []
for pid, r in crops.items():
    if not r.get("crops"):
        continue
    edge = any(c["y"] == 0 and not c["head_ok"] for c in r["crops"].values())
    big = r["crops"]["portrait"]["face_frac"] > 0.38 or r["crops"]["square"]["face_frac"] > 0.55
    if edge or big:
        todo.append((pid, r["file"]))
print("tight/limited chosen files:", len(todo))

new_parent_files = []
for pid, child in todo:
    if child in parents and parents[child].get("done"):
        continue
    wt = wikitext(child) or ""
    m = RX.search(wt)
    if not m:
        parents[child] = {"done": True, "parent": None}
        continue
    par = m.group(1).strip().replace("_", " ")
    parents[child] = {"done": False, "parent": par}
    new_parent_files.append(par)
save_json("cache/parents.json", parents)

need = sorted({p["parent"] for p in parents.values() if p.get("parent") and p["parent"] not in commons})
if need:
    recs = fetch_records(need)
    for f, rec in recs.items():
        if rec:
            commons[f] = rec
    save_json("cache/commons.json", commons)

for child, info in parents.items():
    par = info.get("parent")
    if not par or info.get("done"):
        continue
    if par not in commons:
        info.update(done=True, error="parent missing on Commons")
        continue
    pc = commons[par]
    if not pc["license_ok"]:
        info.update(done=True, error="parent license: " + str(pc["license_reason"]))
        continue
    try:
        pp = fetch(par, pc, "thumb")
    except Exception as e:
        info.update(done=True, error=f"download: {e}")
        continue
    det = detect(pp)
    det["path"] = pp
    faces[par] = det
    score, off, f = locate(local_path(child, "thumb"), commons[child]["width"], pp, pc["width"])
    info.update(done=True, match_score=round(float(score), 4), offset=off, scale=f)
    print(child, "->", par, round(float(score), 3))
save_json("cache/faces.json", faces)
save_json("cache/parents.json", parents)
