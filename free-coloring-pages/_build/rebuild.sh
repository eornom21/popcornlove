#!/bin/sh
# Rebuild catalog, prompts, the per-page web pages, sitemap and feed. Run from the repo root.
set -e
python3 free-coloring-pages/_build/catalog_src.py /tmp/_cat
cp /tmp/_cat/catalog.json free-coloring-pages/catalog.json
cp /tmp/_cat/prompts.json .github/coloring/prompts.json
python3 free-coloring-pages/_build/build_pages.py
