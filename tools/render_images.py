"""Render the raster images from their sources (needs Playwright + a Chromium/Chrome).

    python tools/render_images.py

  tools/og-template.html   -> assets/img/og.png               (1200x630, Open Graph / Twitter card)
  assets/img/favicon.svg   -> assets/img/favicon-32.png       (32x32)
                           -> assets/img/apple-touch-icon.png (180x180)

The OG template's __TRACE_D__ placeholder is filled with tools/make_trace.py's path at render time.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
IMG = ROOT / "assets" / "img"
trace = subprocess.run(
    [sys.executable, str(ROOT / "tools" / "make_trace.py"), "1200", "170"], capture_output=True, text=True, check=True
).stdout.strip()
og_html = (ROOT / "tools" / "og-template.html").read_text(encoding="utf-8").replace("__TRACE_D__", trace)
tmp = ROOT / "tools" / ".og-render.html"
tmp.write_text(og_html, encoding="utf-8")

svg = (IMG / "favicon.svg").read_text(encoding="utf-8")
with sync_playwright() as p:
    try:
        browser = p.chromium.launch(channel="chrome")
    except Exception:
        browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=1)
    page.goto(tmp.as_uri())
    page.screenshot(path=str(IMG / "og.png"))
    for size, name in ((32, "favicon-32.png"), (180, "apple-touch-icon.png")):
        pg = browser.new_page(viewport={"width": size, "height": size}, device_scale_factor=1)
        sized = svg.replace('width="32" height="32"', 'width="%d" height="%d"' % (size, size))
        pg.set_content("<html><body style='margin:0;background:#0d1015'>" + sized + "</body></html>")
        pg.screenshot(path=str(IMG / name))
        pg.close()
    browser.close()
tmp.unlink()
print("rendered", [f.name for f in IMG.glob("*.png")])
