#!/usr/bin/env python3
"""Download generated coloring art and turn it into web/print assets.

queue.tsv lines:  KIND <tab> PAGE_ID <tab> STAMP     (KIND = L line art, C colored guide)
"""
import sys, os, io, json, colorsys, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image

BASE = "https://d8j0ntlcm91z4.cloudfront.net/user_3Li4lvndXgW9T9W9DVxjFmcIsMm/hf_%s.png"
W, H, M = 1800, 2400, 66


def fetch(stamp):
    req = urllib.request.Request(BASE % stamp, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except Exception as e:  # noqa
            err = e
    raise err


def flat(data):
    im = Image.open(io.BytesIO(data)).convert("RGBA")
    bg = Image.new("RGBA", im.size, "white")
    return Image.alpha_composite(bg, im).convert("RGB")


def line_art(data, out, pid):
    g = np.asarray(flat(data).convert("L"), dtype=np.float32)
    a = np.clip((g - 70.0) / (205.0 - 70.0), 0, 1)
    dark = a < 0.55
    rows = np.where(dark.sum(1) > 2)[0]
    cols = np.where(dark.sum(0) > 2)[0]
    if len(rows) and len(cols):
        a = a[rows[0]:rows[-1] + 1, cols[0]:cols[-1] + 1]
    im = Image.fromarray((a * 255).astype(np.uint8), "L")
    s = min((W - 2 * M) / im.width, (H - 2 * M) / im.height)
    im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    page = Image.new("L", (W, H), 255)
    page.paste(im, ((W - im.width) // 2, (H - im.height) // 2))
    q = np.asarray(page, dtype=np.float32) / 255.0
    q = (np.round(q * 5) / 5 * 255).astype(np.uint8)
    page = Image.fromarray(q, "L")
    page.save(os.path.join(out, "art", pid + ".webp"), lossless=True, method=6)
    page.resize((420, 560), Image.LANCZOS).save(os.path.join(out, "thumb", pid + ".webp"), quality=80, method=6)


def palette(rgb):
    px = np.asarray(rgb.resize((150, 200), Image.BILINEAR), dtype=np.float32).reshape(-1, 3)
    mx, mn = px.max(1), px.min(1)
    sat = (mx - mn) / np.maximum(mx, 1)
    keep = (mx > 70) & ~((mn > 215) & (sat < 0.12)) & (sat > 0.16)
    px = px[keep]
    if len(px) < 200:
        return []
    rng = np.random.default_rng(7)
    k = 9
    cen = px[rng.choice(len(px), k, replace=False)]
    for _ in range(16):
        d = ((px[:, None, :] - cen[None]) ** 2).sum(2)
        lab = d.argmin(1)
        for j in range(k):
            m = px[lab == j]
            if len(m):
                cen[j] = m.mean(0)
    counts = np.bincount(lab, minlength=k)
    order = np.argsort(-counts)
    picked = []
    for j in order:
        if counts[j] < 0.02 * len(px):
            continue
        c = cen[j]
        if all(np.abs(c - p).sum() > 70 for p in picked):
            picked.append(c)
        if len(picked) == 6:
            break
    picked.sort(key=lambda c: colorsys.rgb_to_hsv(*(c / 255))[0])
    return ["#%02x%02x%02x" % tuple(int(round(v)) for v in c) for c in picked]


def guide(data, out, pid):
    rgb = flat(data)
    rgb.resize((600, 800), Image.LANCZOS).save(os.path.join(out, "guide", pid + ".webp"), quality=80, method=6)
    return palette(rgb)


def main(queue, out):
    for d in ("art", "thumb", "guide"):
        os.makedirs(os.path.join(out, d), exist_ok=True)
    ppath = os.path.join(out, "palettes.json")
    pal = json.load(open(ppath)) if os.path.exists(ppath) else {}
    jobs = {}
    for line in open(queue):
        parts = line.split()
        if len(parts) != 3 or parts[0] not in ("L", "C"):
            continue
        kind, pid, stamp = parts
        jobs[(kind, pid)] = stamp  # later lines replace earlier ones
    donepath = os.path.join(out, "done.json")
    done = json.load(open(donepath)) if os.path.exists(donepath) else {}
    todo = [(k, pid, st) for (k, pid), st in jobs.items() if done.get(k + ":" + pid) != st]
    print("to process:", len(todo))

    def work(job):
        kind, pid, stamp = job
        try:
            data = fetch(stamp)
            if kind == "L":
                line_art(data, out, pid)
                return job, None, None
            return job, guide(data, out, pid), None
        except Exception as e:  # noqa
            return job, None, repr(e)

    failed = 0
    with ThreadPoolExecutor(4) as ex:
        for (kind, pid, stamp), p, err in ex.map(work, todo):
            if err:
                failed += 1
                print("FAILED", kind, pid, err)
                continue
            done[kind + ":" + pid] = stamp
            if kind == "C":
                pal[pid] = p
            print("ok", kind, pid)
    json.dump(pal, open(ppath, "w"), separators=(",", ":"), sort_keys=True)
    json.dump(done, open(donepath, "w"), separators=(",", ":"), sort_keys=True)
    have = sorted(k[2:] for k in done if k.startswith("L:"))
    json.dump({"art": have, "guide": sorted(k[2:] for k in done if k.startswith("C:"))},
              open(os.path.join(out, "ready.json"), "w"), separators=(",", ":"))
    print("failed:", failed)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
