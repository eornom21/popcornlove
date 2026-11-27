# popcornlove.net

Nate's public page host. GitHub Pages, custom domain popcornlove.net, branch `main`. Every top-level folder is a page: `popcornlove.net/<Folder>/`.

## Publishing a new page
1. Pick a short slug. Don't reuse an existing folder unless Nate asked to replace that page.
2. Copy `_template/index.html` to `<slug>/index.html` and build the page there. One self-contained file; images and data go in `<slug>/`.
3. Commit and push straight to `main` (`git fetch origin main && git rebase origin/main` first).
4. Wait until `https://popcornlove.net/<slug>/` serves the new page (usually 1–2 minutes), then give Nate the link.

## Rules
- Pages are public to anyone with the link. No student info, finances, addresses, or anything Nate calls private.
- Keep `<meta name="robots" content="noindex, nofollow">` unless Nate asks for the page to show up in Google.
- Folders starting with `_` are not published (Jekyll skips them). `_template/` is the starter.
- Leave the root `index.html` ("nothing to see here") and `CNAME` alone.
- Updating a page: edit it in place, push, same URL. Deleting a page: only after Nate says yes.

## Existing pages
BVK (podcast), CabinParlays, HUSL (board portal), IrrigationParlays, drills (soccer drill book). free-coloring-pages (288 printable coloring pages; `coloring/` forwards to it). Its art comes from Higgsfield: add a line to `.github/coloring/queue.tsv` and the `Coloring assets` workflow downloads and sizes the image into `free-coloring-pages/`; page titles live in `free-coloring-pages/catalog.json`. This page is open to Google (no noindex) at Nate's request, 11/26; `robots.txt` at the root points to its sitemap. After changing titles or adding pages, run `python3 free-coloring-pages/_build/build_pages.py` to rebuild the per-page web pages and sitemap. Visitor counts go to Google Analytics (ID in `free-coloring-pages/ga.js`). Its public address is **makeacoloringbook.com** (registered at Cloudflare 11/26): a Cloudflare Worker named `makeacoloringbook` serves this folder at that domain, and the old popcornlove.net address forwards there. makeacoloringpages.com and makeacolouringbook.com (bought 11/26) are attached to the same Worker, which forwards any other host to the main address. Visitor requests for new pages land in the Google Sheet "Coloring Page Requests (Responses)". Instant pages ("Draw my idea"): the Worker's `/api/make` sends a visitor's typed idea to OpenAI's image API (model gpt-image-2.6-flare, medium quality, about 3.5 cents and 10 seconds a page) and the page is kept only in that visitor's browser under My Pages. Worker source is `free-coloring-pages/_build/worker.js`; to change it, paste the file into the Worker's dashboard editor and deploy. It uses the secret OPENAI_API_KEY and the KV namespace `coloring-instant` (binding KV) for limits: 3 a day per visitor, 150 a day site-wide (vars LIMIT_IP, LIMIT_DAY, QUALITY override). Each drawing comes with one free Redraw: the Worker hands back a one-time code (response header `x-redo`, stored in KV as `redo:<code>` for a day) that lets one more request skip the visitor's daily count. A Cloudflare Turnstile human check runs before the limits (secret TURNSTILE_SECRET; site key in worker.js). The OpenAI balance is prepaid with auto-reload off, so it is the hard spending cap. `followthemoney/` only forwards to lab.nathanwmonroe.com/followthemoney.

`vancouver/` is the family's Vancouver Christmas Market trip app (Dec 3–6, 2026), built 11/27 from Courtenay's poster: a home-screen web app (manifest + `sw.js` for offline; bump `VERSION` in `sw.js` whenever its files change so phones pick up the update). All content is data at the top of the script in `index.html`. Flight confirmation codes are deliberately left off and are painted out of `img/poster.jpg`; keep it that way.

Work and professional pages (talks, dashboards, research) go on lab.nathanwmonroe.com (repo eornom21/lab), not here (Nate, 10/29).
