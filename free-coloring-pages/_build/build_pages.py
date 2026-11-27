#!/usr/bin/env python3
"""Build the static, search-friendly pages for Free Coloring Pages.

Run from the repo root:  python3 free-coloring-pages/_build/build_pages.py
Writes one folder per theme and one per coloring page, plus sitemap.xml.
"""
import html, json, os, re, sys, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import catalog_src as C  # noqa

BASE = "https://makeacoloringbook.com/"
TODAY = datetime.date.today().isoformat()

STYLE_NAME = {"easy": "Easy", "whimsical": "Medium", "realistic": "Detailed", "intricate": "Expert"}
STYLE_BLURB = {
    "easy": "Bold, simple shapes with thick lines and big spaces. Made for toddlers and preschoolers, about ages 2 to 5.",
    "whimsical": "A storybook scene with medium detail and plenty to find. Great for kids about 6 to 10.",
    "realistic": "True-to-life line art with fine detail. Good for older kids, teens and adults.",
    "intricate": "Dense patterns with lots of small spaces to fill. Made for teens and adults who like a long, relaxing page.",
}
STYLE_HEAD = {
    "easy": "Easy pages for little kids",
    "whimsical": "Medium pages: storybook scenes",
    "realistic": "Detailed pages: true to life",
    "intricate": "Expert pages for teens and adults",
}
THEME_SEO = {
    "thanksgiving": ("Thanksgiving Coloring Pages", "Turkeys, pumpkins, pies and harvest scenes for the kids' table, the classroom, or a quiet hour after the big meal."),
    "christmas": ("Christmas Coloring Pages", "Santa, reindeer, snowmen, gingerbread and cozy winter scenes, from easy pages for little ones to detailed ornaments and wreaths for grown-ups."),
    "halloween": ("Halloween Coloring Pages", "Friendly ghosts, jack-o'-lanterns, black cats and haunted houses. Spooky-cute for kids, with moody, detailed pages for teens and adults."),
    "easter": ("Easter and Spring Coloring Pages", "Bunnies, chicks, eggs, lambs and spring flowers for Easter baskets, Sunday school and rainy spring afternoons."),
    "valentines": ("Valentine's Day Coloring Pages", "Hearts, love bugs, roses and sweet animal friends. Print a few for a class party or color one as a homemade valentine."),
    "summer": ("Summer and 4th of July Coloring Pages", "Fireworks, parades, beach days, cookouts and camping, plus eagles, lighthouses and mountain lakes for older colorists."),
    "holidays": ("Holiday Coloring Pages", "St. Patrick's Day, Hanukkah, Lunar New Year, Diwali, Day of the Dead, Mardi Gras, Mother's Day, New Year's and birthdays, all in one place."),
    "dinosaurs": ("Dinosaur Coloring Pages", "T. rex, triceratops, stegosaurus and friends, from cute baby dinos to realistic prehistoric scenes and fossil mandalas."),
    "ocean": ("Ocean Animal Coloring Pages", "Whales, sharks, sea turtles, octopuses, mermaids and coral reefs, in easy cartoon pages and detailed underwater scenes."),
    "animals": ("Animal Coloring Pages", "Farm animals, pets, jungle and safari animals and forest wildlife, including realistic foxes, tigers, wolves and owls."),
    "space": ("Space and Robot Coloring Pages", "Rockets, astronauts, planets, aliens and robots, with realistic rocket launches and rovers for space fans of any age."),
    "requests": ("Coloring Pages by Request", "Pages our visitors asked for, drawn fresh. Have an idea of your own? Ask for it on the home page, free."),
    "fantasy": ("Dragon and Unicorn Coloring Pages", "Dragons, unicorns, fairies, castles, knights and wizards, from baby dragons for little kids to ornate fantasy art for adults."),
}
CLEAN = [r"\s*No people in the scene\.", r"\s*The locomotive is an ordinary machine[^.]*\.", r"\s*It is a utility machine[^.]*\.",
         r",? with no writing on it", r" with no words", r", no labels", r", no letters"]


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("'", "").replace("’", "")).strip("-")


def clean(subject):
    for pat in CLEAN:
        subject = re.sub(pat, "", subject)
    return subject.strip()


def esc(s):
    return html.escape(s, quote=True)


NAMES = [("Red", 229, 57, 53), ("Brick red", 183, 65, 50), ("Orange", 251, 140, 0), ("Peach", 255, 203, 164), ("Gold", 255, 197, 61),
         ("Yellow", 255, 235, 100), ("Cream", 245, 232, 200), ("Lime", 170, 205, 60), ("Green", 47, 174, 105), ("Forest green", 27, 110, 65),
         ("Olive", 128, 128, 60), ("Teal", 0, 150, 136), ("Aqua", 70, 200, 215), ("Sky blue", 120, 180, 250), ("Blue", 45, 110, 230),
         ("Navy", 25, 45, 110), ("Purple", 135, 90, 230), ("Lavender", 190, 170, 235), ("Magenta", 200, 60, 150), ("Pink", 255, 125, 180),
         ("Light pink", 250, 190, 210), ("Tan", 210, 170, 120), ("Brown", 140, 85, 40), ("Dark brown", 90, 60, 45), ("Gray", 150, 150, 150),
         ("Slate", 95, 120, 135), ("Black", 30, 30, 30)]


def color_name(hx):
    r, g, b = int(hx[1:3], 16), int(hx[3:5], 16), int(hx[5:7], 16)
    return min(NAMES, key=lambda n: (r - n[1]) ** 2 * .3 + (g - n[2]) ** 2 * .59 + (b - n[3]) ** 2 * .11)[0]


HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Free Coloring Pages">
<meta property="og:title" content="{ogtitle}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{image}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#FFF6E5">
<link rel="icon" href="{root}favicon.svg" type="image/svg+xml">
<link rel="preload" href="{root}fonts/fredoka-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="{root}site.css">
<script type="application/ld+json">{jsonld}</script>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="logo" href="{root}"><span class="c1">Free</span> <span class="c2">Coloring</span> <span class="c3">Pages</span></a>
  <nav class="topnav"><a href="{root}">All pages</a><a href="{root}#book">Build a book</a><a href="https://www.pinterest.com/makeacoloringbook/" target="_blank" rel="noopener">📌 Pinterest</a></nav>
</div></header>
<nav class="bar" aria-label="Themes"><div class="tabs">{tabs}</div></nav>
<main class="wrap">
"""

FOOT = """</main>
<footer>
  <nav class="footnav" aria-label="All themes">{footlinks}</nav>
  <p><b>Free for home, classroom, church and party use.</b> Print as many as you like.</p>
  <p class="footlinks"><a href="https://www.pinterest.com/makeacoloringbook/" target="_blank" rel="noopener">📌 Follow us on Pinterest</a> · <a href="{root}privacy/">Privacy</a> · <a href="#" data-cookie-choices>Cookie choices</a> · <a href="mailto:hello@makeacoloringbook.com">hello@makeacoloringbook.com</a></p>
  <p><a href="{root}">makeacoloringbook.com</a></p>
</footer>
<script src="{root}ga.js"></script>
{script}
</body>
</html>
"""


def tabs(root, active):
    out = ['<a class="tab" href="%s">✨ All pages</a>' % root]
    for key, name, emoji in C.THEMES:
        cur = ' aria-current="page"' if key == active else ""
        out.append('<a class="tab"%s href="%s%s/">%s %s</a>' % (cur, root, key, emoji, esc(name)))
    return "".join(out)


def footlinks(root):
    return "".join('<a href="%s%s/">%s</a>' % (root, k, esc(THEME_SEO[k][0])) for k, _, _ in C.THEMES)


def card(p, root):
    return ('<a class="card" href="{root}{t}/{s}/"><span class="thumb"><span class="badge s-{st}">{sn}</span>'
            '<img loading="lazy" decoding="async" width="390" height="520" src="{root}thumb/{id}.webp" alt="{title} coloring page"></span>'
            '<span class="meta">{title}</span></a>').format(root=root, t=p["theme"], s=p["slug"], st=p["style"], sn=STYLE_NAME[p["style"]], id=p["id"], title=esc(p["title"]))


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def main():
    pages = C.build()
    pal = json.load(open(os.path.join(ROOT, "palettes.json")))
    for p in pages:
        p["slug"] = slug(p["title"])
        p["desc"] = clean(p["subject"])
    seen = set()
    for p in pages:
        k = (p["theme"], p["slug"])
        assert k not in seen, k
        seen.add(k)
    by_theme = {}
    for p in pages:
        by_theme.setdefault(p["theme"], []).append(p)
    urls = []

    # theme pages
    for key, name, emoji in C.THEMES:
        seo, intro = THEME_SEO[key]
        root = "../"
        url = BASE + key + "/"
        items = by_theme[key]
        sections = []
        for st in C.STYLE_ORDER:
            grp = [p for p in items if p["style"] == st]
            if not grp:
                continue
            sections.append('<section><h2>%s</h2><p class="blurb">%s</p><div class="grid">%s</div></section>' % (
                esc(STYLE_HEAD[st]), esc(STYLE_BLURB[st]), "".join(card(p, root) for p in grp)))
        ld = {"@context": "https://schema.org", "@graph": [
            {"@type": "CollectionPage", "name": "Free " + seo, "url": url, "description": intro,
             "hasPart": [{"@type": "ImageObject", "name": p["title"] + " coloring page", "url": url + p["slug"] + "/",
                          "contentUrl": BASE + "art/" + p["id"] + ".webp"} for p in items]},
            {"@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Free Coloring Pages", "item": BASE},
                {"@type": "ListItem", "position": 2, "name": seo, "item": url}]}]}
        body = HEAD.format(title=esc("Free %s (Printable PDF)" % seo),
                           ogtitle=esc("Free " + seo), desc=esc("Free printable %s. %s Print, save a PDF or color online." % (seo.lower().replace("valentine's day", "Valentine's Day").replace("4th of july", "4th of July").replace("thanksgiving", "Thanksgiving").replace("christmas", "Christmas").replace("halloween", "Halloween").replace("easter", "Easter"), intro)),
                           url=url, image=BASE + "pin/" + items[min(1, len(items) - 1)]["id"] + ".jpg", root=root, jsonld=json.dumps(ld, ensure_ascii=False), tabs=tabs(root, key))
        body += '<nav class="crumbs"><a href="%s">Free Coloring Pages</a> › <span>%s</span></nav>\n' % (root, esc(name))
        body += '<h1>Free %s</h1>\n<p class="lede">%s Every page is free to print. Tap one to print it, save a PDF, add a small color guide, or color it on your screen.</p>\n' % (esc(seo), esc(intro))
        body += '<p class="cta"><a class="btn pri" href="%s#t=%s">Open in the coloring app</a></p>\n' % (root, key)
        body += "\n".join(sections)
        body += FOOT.format(root=root, footlinks=footlinks(root), script="")
        write(os.path.join(ROOT, key, "index.html"), body)
        urls.append((url, [BASE + "art/" + p["id"] + ".webp" for p in items[:0]], "0.8"))

    # item pages
    for key, name, emoji in C.THEMES:
        items = by_theme[key]
        seo = THEME_SEO[key][0]
        for i, p in enumerate(items):
            root = "../../"
            url = BASE + key + "/" + p["slug"] + "/"
            art = BASE + "art/" + p["id"] + ".webp"
            pin = BASE + "pin/" + p["id"] + ".jpg"
            colors = [color_name(h) for h in pal.get(p["id"], [])]
            colors = list(dict.fromkeys(colors))
            h1 = p["title"] + " Coloring Page"
            desc = "Free printable %s coloring page. %s Print it, save a PDF or color it online." % (p["title"], p["desc"])
            ld = {"@context": "https://schema.org", "@graph": [
                {"@type": "ImageObject", "name": h1, "description": p["desc"], "contentUrl": art, "thumbnailUrl": BASE + "thumb/" + p["id"] + ".webp",
                 "url": url, "isFamilyFriendly": True, "isAccessibleForFree": True, "width": 1800, "height": 2400},
                {"@type": "BreadcrumbList", "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Free Coloring Pages", "item": BASE},
                    {"@type": "ListItem", "position": 2, "name": seo, "item": BASE + key + "/"},
                    {"@type": "ListItem", "position": 3, "name": h1, "item": url}]}]}
            prev, nxt = items[i - 1], items[(i + 1) % len(items)]
            more = list({q["id"]: q for q in (items[(i + k) % len(items)] for k in (2, 5, 9, 13, 17, 21)) if q["id"] != p["id"]}.values())
            same = [q for q in pages if q["style"] == p["style"] and q["theme"] != key]
            same = [same[(i * 7 + k * 11) % len(same)] for k in range(4)]
            pinurl = "https://www.pinterest.com/pin/create/button/?url=%s&media=%s&description=%s" % (
                esc(url).replace(":", "%3A").replace("/", "%2F"), esc(pin).replace(":", "%3A").replace("/", "%2F"),
                esc(h1 + " (free printable)").replace(" ", "%20").replace("&#x27;", "%27").replace("&amp;", "%26"))
            body = HEAD.format(title=esc(h1 + " (Free Printable)"), ogtitle=esc(h1 + ", free to print"), desc=esc(desc), url=url, image=pin, root=root,
                               jsonld=json.dumps(ld, ensure_ascii=False), tabs=tabs(root, key))
            body += '<nav class="crumbs"><a href="%s">Free Coloring Pages</a> › <a href="../">%s</a> › <span>%s</span></nav>\n' % (root, esc(name), esc(p["title"]))
            body += '<article class="item" data-id="%s">\n<div class="sheetwrap"><img class="sheet printme" width="1800" height="2400" src="%sart/%s.webp" alt="%s"></div>\n' % (
                p["id"], root, p["id"], esc(h1 + ": " + p["desc"]))
            body += '<div class="info">\n<h1>%s</h1>\n<p class="sub"><span class="badge s-%s">%s</span> Free printable · Letter and A4</p>\n' % (esc(h1), p["style"], STYLE_NAME[p["style"]])
            body += '<p class="lede">%s</p>\n' % esc(p["desc"])
            body += ('<div class="actions"><button class="btn pri" id="printBtn" type="button">🖨 Print this page</button>'
                     '<a class="btn sky" data-ev="open_app" href="%s#p=%s">⬇ PDF and print options</a>'
                     '<a class="btn leaf" data-ev="color_online" href="%s#p=%s&amp;color=1">🖍 Color it online</a>'
                     '<a class="btn" data-ev="pin" rel="noopener nofollow" target="_blank" href="%s">📌 Save to Pinterest</a></div>\n') % (root, p["id"], root, p["id"], pinurl)
            body += '<div class="example"><img loading="lazy" width="510" height="680" src="%sguide/%s.webp" alt="%s colored in, as an example"><div><h2>Color ideas</h2><p>%s</p><p>Want this small colored picture printed in the corner of the page as a guide? Open the print options and switch on <b>Color guide</b>.</p></div></div>\n' % (
                root, p["id"], esc(p["title"]), esc("Here is one way to color it. Good colors to pull out: " + ", ".join(colors).lower() + "." if colors else "Here is one way to color it."))
            body += '<h2>About this page</h2><p>%s</p>\n<p>It prints on one sheet of regular paper. For markers, use heavier paper or put a spare sheet underneath. In the print options you can also print two per sheet, switch to light gray lines, or add a name line.</p>\n' % esc(STYLE_BLURB[p["style"]])
            body += '</div>\n</article>\n'
            body += '<nav class="pager"><a href="../%s/">‹ %s</a><a href="../%s/">%s ›</a></nav>\n' % (prev["slug"], esc(prev["title"]), nxt["slug"], esc(nxt["title"]))
            body += '<section><h2>More %s</h2><div class="grid small">%s</div><p class="cta"><a class="btn" href="../">See all %s</a></p></section>\n' % (
                esc(seo.lower().replace("valentine's day", "Valentine's Day").replace("4th of july", "4th of July").replace("thanksgiving", "Thanksgiving").replace("christmas", "Christmas").replace("halloween", "Halloween").replace("easter", "Easter")),
                "".join(card(q, root) for q in more), esc(seo))
            body += '<section><h2>More %s pages</h2><div class="grid small">%s</div></section>\n' % (esc(STYLE_NAME[p["style"]].lower()), "".join(card(q, root) for q in same))
            script = ("<script>(function(){var id=document.querySelector('.item').dataset.id;function t(n){if(window.track)track(n,{page_id:id})}"
                      "document.getElementById('printBtn').addEventListener('click',function(){t('print');window.print()});"
                      "[].forEach.call(document.querySelectorAll('[data-ev]'),function(a){a.addEventListener('click',function(){t(a.dataset.ev)})})})();</script>")
            body += FOOT.format(root=root, footlinks=footlinks(root), script=script)
            write(os.path.join(ROOT, key, p["slug"], "index.html"), body)
            urls.append((url, [(art, h1)], "0.6"))

    # advent calendar (the 24 Christmas pages, one per day)
    root = "../"
    url = BASE + "advent/"
    xmas = by_theme["christmas"]
    doors = "".join('<a class="door" data-day="%d" href="%schristmas/%s/"><span class="num">%d</span><img alt="%s coloring page" data-src="%sthumb/%s.webp" width="390" height="520"><span class="cap">%s</span></a>' % (
        n + 1, root, p["slug"], n + 1, esc(p["title"]), root, p["id"], esc(p["title"])) for n, p in enumerate(xmas))
    ld = {"@context": "https://schema.org", "@type": "CollectionPage", "name": "Christmas Coloring Advent Calendar", "url": url,
          "description": "A free Christmas coloring page to print every day from December 1 to 24."}
    body = HEAD.format(title=esc("Christmas Coloring Advent Calendar: A Free Page Every Day"), ogtitle=esc("Christmas Coloring Advent Calendar"),
                       desc=esc("A free printable Christmas coloring page every day from December 1 to 24. Open today's door, print it, and color."),
                       url=url, image=BASE + "pin/" + xmas[1]["id"] + ".jpg", root=root, jsonld=json.dumps(ld, ensure_ascii=False), tabs=tabs(root, "christmas"))
    body += '<style>.doors{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;margin:22px 0}.door{position:relative;display:block;aspect-ratio:3/4;border:2.5px solid var(--ink);border-radius:14px;background:#fff;box-shadow:4px 4px 0 var(--ink);overflow:hidden;text-decoration:none}.door img{width:100%;height:100%;object-fit:contain;display:none}.door .num{position:absolute;left:8px;top:6px;z-index:2;font:700 22px/1 var(--display);background:var(--sun);border:2px solid var(--ink);border-radius:9px;padding:5px 8px;color:var(--ink)}.door .cap{display:none}.door.open img{display:block}.door.locked{background:repeating-linear-gradient(45deg,#D94B3A 0 14px,#C53F30 14px 28px);pointer-events:none}.door.locked .num{position:static;display:grid;place-items:center;width:100%;height:100%;background:none;border:0;color:#fff;font-size:44px}.door.today{outline:5px solid var(--leaf);outline-offset:3px}@media(max-width:820px){.doors{grid-template-columns:repeat(3,1fr);gap:10px}.door.locked .num{font-size:34px}}</style>\n'
    body += '<nav class="crumbs"><a href="%s">Free Coloring Pages</a> › <a href="../christmas/">Christmas</a> › <span>Advent calendar</span></nav>\n' % root
    body += '<h1>Christmas Coloring Advent Calendar</h1>\n<p class="lede">A new Christmas coloring page to print every day from December 1 to 24. Open today\'s door, print it, and color. <span id="adventNote"></span></p>\n'
    body += '<div class="doors">%s</div>\n<p class="cta"><a class="btn pri" href="../christmas/">See all the Christmas coloring pages</a></p>\n' % doors
    script = ("<script>(function(){var d=new Date(),m=d.getMonth(),day=d.getDate(),open=(m===11)?Math.min(day,24):(m===0?24:0);"
              "[].forEach.call(document.querySelectorAll('.door'),function(a){var n=+a.dataset.day;if(n<=open){a.classList.add('open');var i=a.querySelector('img');i.src=i.dataset.src;if(m===11&&n===day)a.classList.add('today')}else{a.classList.add('locked');a.removeAttribute('href');a.setAttribute('aria-label','Day '+n+', not open yet')}});"
              "var note=document.getElementById('adventNote');if(open===0){var y=d.getFullYear(),s=new Date(y,11,1);if(d>s)s=new Date(y+1,11,1);var left=Math.ceil((s-d)/864e5);note.textContent='The first door opens December 1, '+left+(left===1?' day':' days')+' from now.'}"
              "[].forEach.call(document.querySelectorAll('.door'),function(a){a.addEventListener('click',function(){if(window.track)track('advent_door',{day:a.dataset.day})})})})();</script>")
    body += FOOT.format(root=root, footlinks=footlinks(root), script=script)
    write(os.path.join(ROOT, "advent", "index.html"), body)
    urls.append((url, [], "0.8"))

    # sitemap
    sm = ['<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
          "<url><loc>%s</loc><lastmod>%s</lastmod></url>" % (BASE, TODAY)]
    for url, imgs, pr in urls:
        sm.append("<url><loc>%s</loc><lastmod>%s</lastmod>%s</url>" % (
            esc(url), TODAY, "".join("<image:image><image:loc>%s</image:loc></image:image>" % esc(a) for a, _ in imgs)))
    sm.append("</urlset>")
    write(os.path.join(ROOT, "sitemap.xml"), "\n".join(sm) + "\n")
    import csv, email.utils, time
    order = (["requests"] if "requests" in by_theme else []) + ["christmas", "holidays", "valentines", "animals", "dinosaurs", "fantasy", "ocean", "space", "easter", "summer", "halloween", "thanksgiving"]
    feed = ['<?xml version="1.0" encoding="UTF-8"?>', '<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>',
            "<title>Free Coloring Pages</title><link>%s</link><description>Free printable coloring pages for kids and adults.</description>" % BASE]
    rows = []
    now = time.time()
    seq = [p for k in order for p in by_theme[k]]
    for n, p in enumerate(seq):
        url = BASE + p["theme"] + "/" + p["slug"] + "/"
        pin = BASE + "pin/" + p["id"] + ".jpg"
        title = p["title"] + " Coloring Page (Free Printable)"
        d = "Free printable %s coloring page. %s Print it, save a PDF or color it online." % (p["title"], p["desc"])
        feed.append('<item><title>%s</title><link>%s</link><guid>%s</guid><pubDate>%s</pubDate><description>%s</description><enclosure url="%s" type="image/jpeg" length="0"/><media:content url="%s" medium="image"/></item>' % (
            esc(title), esc(url), esc(url), email.utils.formatdate(now - n * 3600), esc(d), esc(pin), esc(pin)))
        rows.append([title[:100], pin, THEME_SEO[p["theme"]][0], "", d[:500], url, "",
                     ", ".join(["coloring pages", "free printable", THEME_SEO[p["theme"]][0].lower(), STYLE_NAME[p["style"]].lower() + " coloring page"])])
    feed.append("</channel></rss>")
    write(os.path.join(ROOT, "feed.xml"), "\n".join(feed) + "\n")
    with open(os.path.join(HERE, "pinterest-pins.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Title", "Media URL", "Pinterest board", "Thumbnail", "Description", "Link", "Publish date", "Keywords"])
        w.writerows(rows)
    json.dump({p["id"]: p["theme"] + "/" + p["slug"] + "/" for p in pages}, open(os.path.join(ROOT, "links.json"), "w"), separators=(",", ":"))
    print(len(urls), "pages written")


if __name__ == "__main__":
    main()
