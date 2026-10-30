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
BVK (podcast), CabinParlays, HUSL (board portal), IrrigationParlays, drills (soccer drill book). `followthemoney/` only forwards to lab.nathanwmonroe.com/followthemoney.

Work and professional pages (talks, dashboards, research) go on lab.nathanwmonroe.com (repo eornom21/lab), not here (Nate, 10/29).
