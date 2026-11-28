#!/usr/bin/env python3
"""Copy the Worker's search tags (makeacoloringbook.com/api/tags) into free-coloring-pages/_build/tags.json.

Prints "changed" when the file changed, so the workflow knows to rebuild catalog.json.
"""
import json, os, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PATH = os.path.join(ROOT, "free-coloring-pages", "_build", "tags.json")
req = urllib.request.Request("https://makeacoloringbook.com/api/tags", headers={"User-Agent": "Mozilla/5.0 (team-pages action)"})
new = json.loads(urllib.request.urlopen(req, timeout=60).read() or b"{}")
old = json.load(open(PATH)) if os.path.exists(PATH) else {}
merged = {**old, **{k: v for k, v in new.items() if v}}
if merged != old:
    json.dump(merged, open(PATH, "w"), ensure_ascii=False, indent=0, sort_keys=True)
    print("changed")
