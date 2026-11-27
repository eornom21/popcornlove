#!/usr/bin/env python3
"""Download generated coloring art and turn it into web/print assets.

queue.tsv lines:  KIND <tab> PAGE_ID <tab> STAMP     (KIND = L line art, C colored guide,
  A colored guide made by coloring the page's own raw line art: it gets the same crop and centering as the line art,
    so it lines up with art/ and thumb/)
"""
import sys, os, io, json, colorsys, datetime, http.client, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image

BASE = "https://d8j0ntlcm91z4.cloudfront.net/user_3Li4lvndXgW9T9W9DVxjFmcIsMm/hf_%s.png"
W, H, M = 1800, 2400, 66
VER = "v2"


HOST = "d8j0ntlcm91z4.cloudfront.net"
PATH = "/user_3Li4lvndXgW9T9W9DVxjFmcIsMm/hf_%s.png"


def resolve(day, hint, uuid):
    """File names carry the job's creation second. Probe seconds near the hint until the file is found."""
    base = datetime.datetime.strptime(day + hint, "%Y%m%d%H%M%S")
    offs = [0]
    for d in range(1, 121):
        offs.append(d)
        if d <= 25:
            offs.append(-d)
    conn = http.client.HTTPSConnection(HOST, timeout=30)
    try:
        for d in offs:
            stamp = (base + datetime.timedelta(seconds=d)).strftime("%Y%m%d_%H%M%S") + "_" + uuid
            for attempt in range(3):
                try:
                    conn.request("HEAD", PATH % stamp, headers={"User-Agent": "Mozilla/5.0"})
                    r = conn.getresponse(); r.read()
                    break
                except Exception:
                    conn.close(); conn = http.client.HTTPSConnection(HOST, timeout=30)
            else:
                continue
            if r.status == 200:
                return stamp
    finally:
        conn.close()
    return None


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
    page.resize((390, 520), Image.LANCZOS).save(os.path.join(out, "thumb", pid + ".webp"), quality=62, method=6)


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


def raw_box(data):
    """Crop box of a raw line-art file as fractions (top, bottom, left, right), the same box line_art() trims to."""
    g = np.asarray(flat(data).convert("L"), dtype=np.float32)
    a = np.clip((g - 70.0) / (205.0 - 70.0), 0, 1)
    dark = a < 0.55
    rows = np.where(dark.sum(1) > 2)[0]
    cols = np.where(dark.sum(0) > 2)[0]
    h, w = dark.shape
    if not len(rows) or not len(cols):
        return (0, 1, 0, 1)
    return (rows[0] / h, (rows[-1] + 1) / h, cols[0] / w, (cols[-1] + 1) / w)


def aligned(rgb, box):
    """Crop a coloring of the raw line art to the line art's box and center it on the page like line_art()."""
    t, b, l, r = box
    w, h = rgb.size
    im = rgb.crop((round(l * w), round(t * h), round(r * w), round(b * h)))
    s = min((W - 2 * M) / im.width, (H - 2 * M) / im.height)
    im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    page = Image.new("RGB", (W, H), "white")
    page.paste(im, ((W - im.width) // 2, (H - im.height) // 2))
    return page


def guide(data, out, pid, box=None):
    rgb = flat(data)
    if box:
        rgb = aligned(rgb, box)
    rgb.resize((510, 680), Image.LANCZOS).save(os.path.join(out, "guide", pid + ".webp"), quality=74, method=6)
    return palette(rgb)


def main(queue, out):
    here = os.path.dirname(os.path.abspath(__file__))
    ids = {str(p["i"]): p["id"] for p in json.load(open(os.path.join(here, "prompts.json")))}
    for d in ("art", "thumb", "guide"):
        os.makedirs(os.path.join(out, d), exist_ok=True)
    ppath = os.path.join(out, "palettes.json")
    pal = json.load(open(ppath)) if os.path.exists(ppath) else {}
    donepath = os.path.join(out, "done.json")
    done = json.load(open(donepath)) if os.path.exists(donepath) else {}
    jobs = {}
    day = None
    for line in open(queue):
        parts = line.split()
        if len(parts) == 2 and parts[0] == "D":
            day = parts[1]
        elif len(parts) == 4 and parts[0] in ("L", "C", "A"):
            kind, idx, uuid, hint = parts
            jobs[("C" if kind == "A" else kind, ids.get(idx, idx))] = (uuid, day, hint, kind == "A")  # later lines replace earlier ones
    todo = [(k, pid) + v for (k, pid), v in jobs.items() if done.get(k + ":" + pid, "").split("|")[0][-36:] != v[0] or not done[k + ":" + pid].endswith("|" + VER)]
    print("to process:", len(todo))

    def work(job):
        kind, pid, uuid, day, hint, al = job
        try:
            stamp = resolve(day, hint, uuid)
            if not stamp:
                return job, None, None, "not found near " + hint
            data = fetch(stamp)
            if kind == "L":
                line_art(data, out, pid)
                return job, stamp, None, None
            box = None
            if al:
                lst = done.get("L:" + pid, "").split("|")[0]
                if not lst:
                    return job, None, None, "no line art to align to"
                box = raw_box(fetch(lst))
            return job, stamp, guide(data, out, pid, box), None
        except Exception as e:  # noqa
            return job, None, None, repr(e)

    missing = []
    with ThreadPoolExecutor(8) as ex:
        for (kind, pid, uuid, day, hint, al), stamp, p, err in ex.map(work, todo):
            if err:
                missing.append(kind + ":" + pid)
                print("MISSING", kind, pid, uuid, err, flush=True)
                continue
            done[kind + ":" + pid] = stamp + "|" + VER
            print("ok", kind, pid, flush=True)
            if kind == "C":
                pal[pid] = p
    json.dump(pal, open(ppath, "w"), separators=(",", ":"), sort_keys=True)
    json.dump(done, open(donepath, "w"), separators=(",", ":"), sort_keys=True)
    json.dump({"art": sorted(k[2:] for k in done if k.startswith("L:")),
               "guide": sorted(k[2:] for k in done if k.startswith("C:")),
               "missing": sorted(missing)},
              open(os.path.join(out, "ready.json"), "w"), separators=(",", ":"))
    print("done:", len(todo) - len(missing), "missing:", len(missing))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
