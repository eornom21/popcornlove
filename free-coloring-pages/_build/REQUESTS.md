# Daily run: turn visitor requests into coloring pages

Visitors ask for pages with the "Request a page" button on makeacoloringbook.com. Each request lands as a row in Nate's Google Sheet **Coloring Page Requests (Responses)** (Drive file ID `1GZ5Y3aWMspHcyScyLZPSGg3WRlHBEXcvRAFZnzGnf1s`): a timestamp and one cell like `[Whimsical] a corgi riding a skateboard`.

This run makes **at most 10 new pages a day** and publishes them under the **By Request** tab. Nate approved this on Nov 26, 2026: up to 10 pages a day, about 3 Higgsfield credits each. Never send email. Never contact a requester.

## Steps

1. **Repo.** Attach `eornom21/popcornlove` with push access, clone it, and work from the repo root.
2. **Read the sheet** with the Google Drive connector (`read_file_content` on the file ID above).
3. **Find new rows.** `free-coloring-pages/_build/requests_done.txt` lists every row already handled, one per line as `timestamp | text | result`. A row not in that file is new. If nothing is new, stop here and say so in one line.
4. **Screen each new row, oldest first.** Skip a row (and still record it in `requests_done.txt` with the reason) when it:
   - contains the word TEST;
   - asks for a character, logo or brand from a movie, show, game, comic, toy line, sports team or company, or for a real person;
   - is not family-friendly (sexual content, gore, cruelty, hate, drugs, weapons aimed at people);
   - is spam, a link, gibberish, or the same idea as a page already on the site.
   Drop any names, addresses, phone numbers or other personal details from an otherwise fine request. Accept at most 10 rows; leave the rest for tomorrow (do not record them as handled).
5. **Write each accepted page** into `free-coloring-pages/_build/requests.json` (create it as a JSON list if missing). One object per page:
   `{"id": "requests-NNN", "style": "easy|whimsical|realistic|intricate", "title": "2 to 5 Words in Title Case", "subject": "One or two sentences describing the scene."}`
   Number NNN upward from the last id. Style comes from the bracket: Easy (or old "Little Kids") = easy, Medium (or "Whimsical") = whimsical, Detailed (or "Realistic") = realistic, Expert (or "Intricate") = intricate. Write the subject the way the others in `catalog_src.py` are written: concrete, generic, no brand names, no text in the picture. Avoid children in swimwear; the colored version gets blocked.
6. **Rebuild the lists:** `sh free-coloring-pages/_build/rebuild.sh`. Each new page's full drawing prompt is now in `.github/coloring/prompts.json` (fields `id`, `prompt`).
7. **Draw with Higgsfield.** Check the balance first; if it is under 100 credits, stop and tell Nate. Use `generate_image_batch`, one request per page: model `gpt_image_2_6`, aspect_ratio `3:4`, quality `high`, resolution `2k`, and the prompt from step 6. Wait with `jobs_wait` until every job is finished. Each result URL looks like `.../hf_YYYYMMDD_HHMMSS_<job id>.png`; note the date, the time and the job id. If a job fails or is flagged, remove that page from `requests.json` and record the row as "could not draw".
8. **Colored version.** Second `generate_image_batch`, one per page: model `gpt_image_2_6`, aspect_ratio `3:4`, quality `low`, resolution `1k`, `medias: [{"role": "image_references", "value": "<the line-art job id>"}]`, prompt: "Color in this exact coloring page as a finished example. Keep every black outline exactly as drawn, same composition and framing, and fill each area with flat, bright, cheerful, natural colors like neat marker and colored pencil coloring. White paper background stays white in the margins. No added objects, no text." If one is flagged, leave it out; the page works without a color guide.
9. **Queue the downloads.** Append to `.github/coloring/queue.tsv`: a line `D YYYYMMDD` (the date from the result URLs), then for each page `L <page id> <line-art job id> <HHMMSS>` and, if it has one, `C <page id> <color job id> <HHMMSS>`. Fields are separated by spaces.
10. **Commit and push** everything, then wait until the `Coloring assets` workflow run for that commit finishes with success (`gh api "repos/eornom21/popcornlove/actions/runs?per_page=3"`). `git pull`.
11. **Check the art.** Every new id must be in `free-coloring-pages/ready.json` under `art`. Open each new `free-coloring-pages/thumb/<id>.webp` and look at it. If a drawing shows a recognizable character, a logo, readable text, or anything not family-friendly, remove that page from `requests.json`, delete its files in `art/`, `thumb/`, `guide/` and `pin/`, and record the row as "removed after review".
12. **Share images:** `python3 free-coloring-pages/_build/pins.py <id> <id> ...` (needs Playwright and `/usr/bin/google-chrome`; if they are missing, skip this step and say so).
13. **Rebuild and publish:** `sh free-coloring-pages/_build/rebuild.sh`, add every handled row to `requests_done.txt`, commit, push, and confirm the `pages build and deployment` run succeeds.
14. **Report** in a few lines: the pages added, with links of the form `https://makeacoloringbook.com/requests/<slug>/` (the slug is the folder name under `free-coloring-pages/requests/`), the rows skipped and why, and the credits spent.
