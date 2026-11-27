#!/usr/bin/env python3
"""Build free Christmas coloring packets for schools.

packets.json:
  art      : {key: "YYYYMMDD_HHMMSS_<job uuid>"}  Higgsfield drawings with an empty banner at the top
  library  : [page ids from free-coloring-pages/art/<id>.webp]
  schools  : [{slug, name, mascot}]   mascot = a key in art, or "" for none

For each school it writes free-coloring-pages/schools/<slug>.pdf (US Letter):
  1. the mascot drawing with the school's name in the banner (skipped when no mascot)
  2. the schoolhouse drawing with the school's name in the banner
  3+. the library pages
Previews of page 1 go to .github/packets/previews/<slug>.png (not published).
"""
import io, os, sys, json, urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SITE = os.path.join(ROOT, "free-coloring-pages")
HERE = os.path.dirname(os.path.abspath(__file__))
CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3Li4lvndXgW9T9W9DVxjFmcIsMm/hf_%s.png"
DPI = 300
PW, PH = int(8.5 * DPI), int(11 * DPI)
MARGIN = int(0.45 * DPI)
FOOT = int(0.32 * DPI)
FOOTER = "Free coloring pages from makeacoloringbook.com"


def font(size, weight=700):
    for p in (os.path.join(HERE, "fonts", "fredoka-%d.ttf" % weight),
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default(size)


def fetch(stamp, cache):
    path = os.path.join(cache, stamp + ".png")
    if not os.path.exists(path):
        req = urllib.request.Request(CDN % stamp, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=90) as r:
            open(path, "wb").write(r.read())
    im = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", im.size, "white")
    return Image.alpha_composite(bg, im).convert("L")


def banner_box(g):
    """Find the empty banner near the top: walking down the centre column, the first enclosed white region
    (not touching the page edge) that is wide and short enough to be a banner."""
    a = np.asarray(g) < 140
    h, w = a.shape
    cx = w // 2
    white = ~ndimage.binary_dilation(a, iterations=1)
    lab, _ = ndimage.label(white)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
    seen = set()
    for y in range(0, int(h * 0.3)):
        k = lab[y, cx]
        if k == 0 or k in seen or k in edge:
            continue
        seen.add(k)
        comp = lab == k
        ys, xs = np.where(comp)
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        if (y1 - y0) > 0.25 * h or (x1 - x0) < 0.35 * w:
            continue
        bw = x1 - x0
        lo, hi = x0 + int(0.15 * bw), x1 - int(0.15 * bw)
        tops, bots, good = [], [], True
        for x in range(lo, hi, 2):
            c = np.where(comp[:, x])[0]
            if len(c) == 0:
                good = False; break
            tops.append(c.min()); bots.append(c.max())
        if not good:
            continue
        top, bot = max(tops), min(bots)
        if bot - top < 0.03 * h:
            continue
        pad = int((bot - top) * 0.12)
        return (lo, top + pad, hi, bot - pad)
    return None


def fit_lines(draw, text, box, weight=700):
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    words = text.split()
    options = [[text]]
    if len(words) > 1:
        for i in range(1, len(words)):
            options.append([" ".join(words[:i]), " ".join(words[i:])])
    best = None
    for lines in options:
        lo, hi = 8, int(bh)
        while lo < hi:
            mid = (lo + hi + 1) // 2
            f = font(mid, weight)
            sw = max(2, mid // 14)
            ws = [draw.textbbox((0, 0), l, font=f, stroke_width=sw) for l in lines]
            tw = max(b[2] - b[0] for b in ws)
            th = sum(b[3] - b[1] for b in ws) + int(mid * 0.15) * (len(lines) - 1)
            if tw <= bw and th <= bh:
                lo = mid
            else:
                hi = mid - 1
        if best is None or lo > best[0] * 1.15:
            best = (lo, lines)
    return best


def stamp_name(g, name):
    """Scale the drawing up to print size, then letter the school's name, hollow, inside the banner."""
    box = banner_box(g)
    s = 2400 / g.height
    big = g.resize((round(g.width * s), round(g.height * s)), Image.LANCZOS)
    big = big.point(lambda v: 0 if v < 110 else (255 if v > 200 else v))
    if box is None:
        return big, False
    box = tuple(int(v * s) for v in box)
    d = ImageDraw.Draw(big)
    size, lines = fit_lines(d, name.upper(), box)
    f = font(size)
    sw = max(3, size // 12)
    x0, y0, x1, y1 = box
    heights = [d.textbbox((0, 0), l, font=f, stroke_width=sw) for l in lines]
    gap = int(size * 0.15)
    total = sum(b[3] - b[1] for b in heights) + gap * (len(lines) - 1)
    y = y0 + (y1 - y0 - total) // 2
    for l, b in zip(lines, heights):
        tw = b[2] - b[0]
        d.text(((x0 + x1 - tw) // 2 - b[0], y - b[1]), l, font=f, fill=255, stroke_width=sw, stroke_fill=0)
        y += (b[3] - b[1]) + gap
    return big, True


def page(img):
    """Place a drawing on a US Letter page with margins and a small footer."""
    p = Image.new("L", (PW, PH), 255)
    aw, ah = PW - 2 * MARGIN, PH - 2 * MARGIN - FOOT
    s = min(aw / img.width, ah / img.height)
    im = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    p.paste(im, ((PW - im.width) // 2, MARGIN + (ah - im.height) // 2))
    d = ImageDraw.Draw(p)
    f = font(int(0.13 * DPI), 500)
    tw = d.textlength(FOOTER, font=f)
    d.text(((PW - tw) / 2, PH - MARGIN - int(0.16 * DPI)), FOOTER, font=f, fill=110)
    return p


def main():
    cfg = json.load(open(os.path.join(HERE, "packets.json")))
    cache = os.path.join(HERE, ".cache"); os.makedirs(cache, exist_ok=True)
    out = os.path.join(SITE, "schools"); os.makedirs(out, exist_ok=True)
    prev = os.path.join(HERE, "previews"); os.makedirs(prev, exist_ok=True)
    art = {k: fetch(v, cache) for k, v in cfg["art"].items()}
    lib = [Image.open(os.path.join(SITE, "art", pid + ".webp")).convert("L") for pid in cfg["library"]]
    lib_pages = [page(im) for im in lib]
    report = []
    for sc in cfg["schools"]:
        pages, ok = [], []
        keys = ([sc["mascot"]] if sc.get("mascot") else []) + ["schoolhouse"]
        for k in keys:
            im, fitted = stamp_name(art[k], sc["name"])
            ok.append(fitted)
            pages.append(page(im))
        pages += lib_pages
        rgb = [p.convert("RGB") for p in pages]
        rgb[0].save(os.path.join(out, sc["slug"] + ".pdf"), save_all=True, append_images=rgb[1:], resolution=DPI,
                    title="Christmas coloring pages for " + sc["name"], author="Make a Coloring Book")
        pages[0].resize((PW // 3, PH // 3), Image.LANCZOS).save(os.path.join(prev, sc["slug"] + ".png"))
        report.append({"slug": sc["slug"], "pages": len(pages), "banner_found": ok})
    json.dump(report, open(os.path.join(prev, "report.json"), "w"), indent=1)
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
