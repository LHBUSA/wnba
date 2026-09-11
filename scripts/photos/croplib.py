"""Face-anchored crop rules shared by stage 6 (P18 crops) and stage 9 (Commons-category discovery).
Moved verbatim out of s6_crop.py so both stages frame players identically."""
from PIL import Image, ImageOps

SPECS = {
    # aspect w/h, target out, face fraction target/min/max, eye fraction from top
    "portrait": dict(aspect=0.8, out=(600, 750), f_t=0.33, f_min=0.28, f_max=0.38, eye=0.40),
    "square": dict(aspect=1.0, out=(256, 256), f_t=0.46, f_min=0.45, f_max=0.55, eye=0.42),
}
HAIR_UP = 0.45     # face box expanded 45% upward = top of head
HEAD_MARGIN = 0.10  # extra headroom above the hair line (fraction of face height)
SIDE = 0.12        # hair/ears either side
YN_MIN = 0.8


def yface(f, tag="yunet"):
    ey = (f["eyes"][0][1] + f["eyes"][1][1]) / 2
    src = tag + ("+haar" if f.get("haar_agree") else "")
    return {"box": f["box"], "eye_y": ey, "src": src, "score": round(f["score"], 3)}


def pick_face(det, forced=None):
    """Haar (frontal_default -> profile) per brief, cross-validated with YuNet. Largest face confirmed by
    YuNet (score>=0.8) wins; a second YuNet face >=70% of its width => multi_face_review."""
    hs = det.get("faces", [])
    yn = [f for f in det.get("yunet", []) if f["score"] >= YN_MIN]
    if forced is not None:
        kind, idx = forced
        if kind == "yunet":
            return yface(det["yunet"][idx], "yunet_manual"), None
        if kind == "box":
            b = idx
            return {"box": b, "eye_y": b[1] + 0.40 * b[3], "src": "manual_box"}, None
        f = hs[idx]
        return {"box": f["box"], "eye_y": f["box"][1] + 0.40 * f["box"][3], "src": "haar_manual"}, None
    if yn:
        main = max(yn, key=lambda f: f["box"][2] * f["box"][3])
        others = [f for f in yn if f is not main and f["box"][2] >= 0.7 * main["box"][2]]
        return yface(main), ("multi_face_review" if others else None)
    conf = [f for f in hs if f["alt2_confirmed"]]
    if conf:
        f = max(conf, key=lambda f: f["box"][2] * f["box"][3])
        return {"box": f["box"], "eye_y": f["box"][1] + 0.40 * f["box"][3], "src": "haar_only"}, "haar_only_unverified"
    return None, "no_face_detected"


def compute_crop(W, H, face, spec):
    fx, fy, fw, fh = face["box"]
    a = spec["aspect"]
    ch = fh / spec["f_t"]
    cw = ch * a
    head_top = fy - HAIR_UP * fh
    head_l, head_r = fx - SIDE * fw, fx + fw + SIDE * fw
    chin = fy + fh * 1.05
    # the crop must at least hold the head box with margins
    need_h = (chin - head_top) + HEAD_MARGIN * fh
    need_w = head_r - head_l
    if ch < need_h:
        ch = need_h
        cw = ch * a
    if cw < need_w:
        cw = need_w
        ch = cw / a
    notes = []
    s = min(1.0, H / ch, W / cw)
    if s < 1.0:
        ch *= s
        cw *= s
        notes.append("crop limited by source bounds")
    eye_y = face["eye_y"]
    top = eye_y - spec["eye"] * ch
    top = min(top, head_top - HEAD_MARGIN * fh)
    left = fx + fw / 2 - cw / 2
    top = max(0.0, min(top, H - ch))
    left = max(0.0, min(left, W - cw))
    ok = True
    if head_top < top - 0.5:
        ok = False
        notes.append("head top outside crop (hair cut in source)" if top <= 0.5 else "head top outside crop")
    if head_l < left - 0.5 or head_r > left + cw + 0.5:
        notes.append("head sides tight")
    if chin > top + ch + 0.5:
        ok = False
        notes.append("chin outside crop")
    ff = fh / ch
    ey = (eye_y - top) / ch
    deficit = max(0.0, top - (head_top - HEAD_MARGIN * fh)) / fh
    return {"x": left, "y": top, "w": cw, "h": ch, "face_frac": round(ff, 3), "eye_frac": round(ey, 3),
            "head_ok": ok, "top_deficit": round(deficit, 3), "notes": notes}


def render(src_img, crop, spec, scale):
    """crop is in thumb px; scale maps thumb px -> src_img px."""
    x, y, w, h = crop["x"] * scale, crop["y"] * scale, crop["w"] * scale, crop["h"] * scale
    tw, th = spec["out"]
    x0, y0 = int(round(x)), int(round(y))
    w_i = int(round(w))
    h_i = int(round(w_i / spec["aspect"]))
    x0 = max(0, min(x0, src_img.width - w_i))
    y0 = max(0, min(y0, src_img.height - h_i))
    region = src_img.crop((x0, y0, x0 + w_i, y0 + h_i))
    if h_i >= th:
        ow, oh = tw, th
    else:
        oh = h_i
        ow = int(round(oh * spec["aspect"]))
    out = region.resize((ow, oh), Image.LANCZOS) if (ow, oh) != region.size else region
    return out, (x0, y0, w_i, h_i), (ow, oh)


def open_img(p):
    im = Image.open(p)
    im = ImageOps.exif_transpose(im)
    return im.convert("RGB")
