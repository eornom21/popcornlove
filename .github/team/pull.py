#!/usr/bin/env python3
"""Pull pages Uncle Dave published with the team tools and add them to the site.

The Worker lists published-but-not-yet-live drawings at /api/team/queue. For each one this script
assigns a page id, turns the drawing into site art (same sizing as every other page), adds it to
free-coloring-pages/_build/requests.json (with its theme) and records it in free-coloring-pages/team.json,
which tells the Worker it is live. Prints the new page ids (one per line) for the workflow.
"""
import json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, ".github", "coloring"))
from process import line_art  # noqa: E402

OUT = os.path.join(ROOT, "free-coloring-pages")
QUEUE = "https://makeacoloringbook.com/api/team/queue"
UA = {"User-Agent": "Mozilla/5.0 (team-pages action)"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
        return r.read()


def load(path, default):
    return json.load(open(path)) if os.path.exists(path) else default


def main():
    items = json.loads(get(QUEUE)).get("items", [])
    team_p = os.path.join(OUT, "team.json")
    req_p = os.path.join(OUT, "_build", "requests.json")
    done_p = os.path.join(OUT, "done.json")
    team, reqs, done = load(team_p, {}), load(req_p, []), load(done_p, {})
    cat = load(os.path.join(OUT, "catalog.json"), {"pages": []})
    ids = {p["id"] for p in cat["pages"]} | {r["id"] for r in reqs}
    titles = {(p["t"], p["n"].lower()) for p in cat["pages"]} | {(r.get("theme", "requests"), r["title"].lower()) for r in reqs}
    new = []
    for it in sorted(items, key=lambda x: x.get("at", "")):
        tid = it["tid"]
        if tid in team:
            continue
        theme = it.get("theme") or "requests"
        nums = [int(i.split("-")[1]) for i in ids if i.startswith(theme + "-") and i.split("-")[1].isdigit()]
        n = max(nums + [0 if theme == "requests" else 24]) + 1
        pid = f"{theme}-{n:03d}" if theme == "requests" else f"{theme}-{n:02d}"
        title = re.sub(r"\s+", " ", it["title"]).strip()
        base, k = title, 2
        while (theme, title.lower()) in titles:
            title = f"{base} {k}"; k += 1
        try:
            line_art(get(it["img"]), OUT, pid)
        except Exception as e:  # noqa
            print("skip", tid, repr(e), file=sys.stderr)
            continue
        reqs.append({"id": pid, "theme": theme, "style": it.get("style") or "whimsical", "title": title,
                     "subject": it.get("subject") or title, "by": "team", "tid": tid})
        team[tid] = pid
        done["L:" + pid] = "team:" + tid + "|v2"
        ids.add(pid); titles.add((theme, title.lower()))
        new.append(pid)
    if not new:
        return
    json.dump(reqs, open(req_p, "w"), ensure_ascii=False, indent=1)
    json.dump(team, open(team_p, "w"), separators=(",", ":"), sort_keys=True)
    json.dump(done, open(done_p, "w"), separators=(",", ":"), sort_keys=True)
    ready = load(os.path.join(OUT, "ready.json"), {"art": [], "guide": [], "missing": []})
    ready["art"] = sorted(set(ready.get("art", [])) | set(new))
    json.dump(ready, open(os.path.join(OUT, "ready.json"), "w"), separators=(",", ":"))
    print("\n".join(new))


if __name__ == "__main__":
    main()
