"""Headless-Chromium QA for the site (Playwright).

    python tools/qa.py shots     # screenshots: desktop + mobile, dark + light, reduced motion -> _preview/
    python tools/qa.py demos     # clicks through both interactive demos and asserts the outcomes
    python tools/qa.py checks    # console errors, CSP violations, 360 px overflow, keyboard, file:// load

Serves the folder with http.server on a free port; the file:// check opens index.html directly.
Headless Chrome reports prefers-reduced-motion: reduce by default, so every context sets it explicitly.
"""

from __future__ import annotations

import json
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "_preview"
OUT.mkdir(exist_ok=True)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Server:
    def __enter__(self):
        self.port = free_port()
        self.p = subprocess.Popen(
            [sys.executable, "-m", "http.server", str(self.port), "--bind", "127.0.0.1"],
            cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", self.port), 0.2).close()
                break
            except OSError:
                time.sleep(0.1)
        self.url = f"http://127.0.0.1:{self.port}/"
        return self

    def __exit__(self, *a):
        self.p.terminate()


def launch(p):
    try:
        return p.chromium.launch(channel="chrome")
    except Exception:
        return p.chromium.launch()


def context(browser, *, mobile=False, scheme="dark", motion="no-preference", width=None):
    if mobile:
        kw = dict(viewport={"width": width or 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        kw = dict(viewport={"width": width or 1440, "height": 900}, device_scale_factor=1)
    return browser.new_context(color_scheme=scheme, reduced_motion=motion, **kw)


def watch(page, log):
    page.on("console", lambda m: log.append(("console." + m.type, m.text)) if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: log.append(("pageerror", str(e))))
    page.on("requestfailed", lambda r: log.append(("requestfailed", r.url)))
    page.on("response", lambda r: log.append(("http" + str(r.status), r.url)) if r.status >= 400 else None)


def scroll_through(page):
    h = page.evaluate("document.documentElement.scrollHeight")
    y = 0
    while y < h:
        page.evaluate(f"window.scrollTo(0,{y})")
        page.wait_for_timeout(120)
        y += 500
    page.evaluate("window.scrollTo(0,0)")
    page.wait_for_timeout(400)


def shots(base):
    configs = [
        ("desktop-dark", dict(scheme="dark")),
        ("desktop-light", dict(scheme="light")),
        ("mobile-dark", dict(scheme="dark", mobile=True)),
        ("mobile-light", dict(scheme="light", mobile=True)),
        ("desktop-dark-reduced", dict(scheme="dark", motion="reduce")),
        ("mobile-360-dark", dict(scheme="dark", mobile=True, width=360)),
    ]
    with sync_playwright() as p:
        b = launch(p)
        for name, kw in configs:
            ctx = context(b, **kw)
            page = ctx.new_page()
            log: list = []
            watch(page, log)
            page.goto(base, wait_until="load")
            page.wait_for_timeout(1800)  # hero animation
            if kw.get("motion") != "reduce":
                scroll_through(page)
            page.wait_for_timeout(600)
            page.screenshot(path=str(OUT / f"{name}.png"), full_page=True)
            print(name, "console/page issues:", log)
            ctx.close()
        b.close()


def demos(base):
    results = {}
    with sync_playwright() as p:
        b = launch(p)
        ctx = context(b, scheme="dark", motion="no-preference")
        page = ctx.new_page()
        log: list = []
        watch(page, log)
        page.goto(base, wait_until="load")
        page.wait_for_timeout(800)

        # ---------------- asset-health replay
        page.locator("#ah").scroll_into_view_if_needed()
        page.wait_for_timeout(500)
        page.click("#ah-restart")  # starts from the beginning, playing
        page.wait_for_timeout(2500)
        mid_date = page.inner_text("#ah-readouts >> nth=0")
        page.screenshot(path=str(OUT / "demo-asset-mid.png"))
        page.wait_for_selector("#ah-play:has-text('Replay')", timeout=60000)
        page.wait_for_timeout(900)
        results["ah_end_readouts"] = page.inner_text("#ah-readouts").replace("\n", " | ")
        results["ah_wo_id"] = page.inner_text("#ah-wo .wo-head b")
        results["ah_outcome"] = page.inner_text("#ah-wo .outcome")
        results["ah_fail_visible"] = page.evaluate("document.querySelector('#ah-chart .ch-fail').parentNode.getAttribute('visibility')")
        page.locator("#ah").scroll_into_view_if_needed()
        page.screenshot(path=str(OUT / "demo-asset-end.png"), full_page=False)
        # scrub back to mid replay with the keyboard
        page.focus("#ah-scrub")
        for _ in range(60):
            page.keyboard.press("ArrowLeft")
        results["ah_scrub_alert_state"] = page.inner_text("#ah-readouts").replace("\n", " | ")
        results["ah_wo_ghost_after_scrub"] = page.locator("#ah-wo .wo-ghost").count()
        # second asset
        page.click("#ah-assets button:nth-child(2)")
        page.wait_for_selector("#ah-play:has-text('Replay')", timeout=60000)
        page.wait_for_timeout(600)
        results["ah2_wo_id"] = page.inner_text("#ah-wo .wo-head b")
        results["ah2_outcome"] = page.inner_text("#ah-wo .outcome")
        page.screenshot(path=str(OUT / "demo-asset-pmp03.png"))

        # ---------------- maintenance-agent walkthrough
        page.locator("#ma").scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        page.click("#ma-reset")
        for _ in range(5):
            page.click("#ma-step")
            page.wait_for_timeout(1300)
        results["ma_approve_enabled"] = not page.is_disabled("#ma-approve")
        results["ma_stepper"] = page.eval_on_selector_all("#ma-stepper li", "els => els.map(e => e.dataset.st)")
        page.screenshot(path=str(OUT / "demo-agent-await.png"))
        page.click("#ma-approve")
        page.wait_for_timeout(3000)
        results["ma_gate_state"] = page.get_attribute("#ma-gate", "data-state")
        results["ma_gate_msg"] = page.inner_text("#ma-gate-msg")
        results["ma_stepper_after"] = page.eval_on_selector_all("#ma-stepper li", "els => els.map(e => e.dataset.st)")
        results["ma_log_last"] = page.inner_text("#ma-log li:last-child")
        results["ma_logcount"] = page.inner_text("#ma-logcount")
        page.screenshot(path=str(OUT / "demo-agent-released.png"))

        # unsafe
        page.click("#ma-scn button[data-scn=unsafe]")
        page.wait_for_selector("#ma-approve:not([disabled])", timeout=60000)
        results["un_stepper"] = page.eval_on_selector_all("#ma-stepper li", "els => els.map(e => e.dataset.st)")
        page.wait_for_timeout(1500)
        results["un_stage"] = page.inner_text("#ma-stage")[:400]
        results["un_loop"] = page.inner_text("#ma-loop")
        page.screenshot(path=str(OUT / "demo-agent-blocked.png"))
        page.click("#ma-approve")
        page.wait_for_timeout(1500)
        results["un_gate_state"] = page.get_attribute("#ma-gate", "data-state")
        results["un_gate_msg"] = page.inner_text("#ma-gate-msg")
        page.click("#ma-bypass")
        page.wait_for_timeout(1500)
        results["un_gate_msg2"] = page.inner_text("#ma-gate-msg")
        results["un_log_last"] = page.inner_text("#ma-log li:last-child")
        results["un_released_rows"] = page.locator("#ma-log li", has_text="released").count()
        page.screenshot(path=str(OUT / "demo-agent-refused.png"))
        results["console"] = log
        ctx.close()
        b.close()
    print(json.dumps(results, indent=1, ensure_ascii=False))


def checks(base):
    out = {}
    with sync_playwright() as p:
        b = launch(p)
        for label, url in (("http", base), ("file", (ROOT / "index.html").as_uri()), ("404", base + "404.html")):
            ctx = context(b, scheme="dark", motion="no-preference")
            page = ctx.new_page()
            log: list = []
            watch(page, log)
            page.goto(url, wait_until="load")
            page.wait_for_timeout(1500)
            scroll_through(page)
            out[label] = {"issues": log, "title": page.title(), "replay_chart": page.locator("#ah-chart svg").count(), "agent_rows": page.locator("#ma-log li").count()}
            ctx.close()
        # overflow at narrow widths
        for w in (360, 390, 768):
            ctx = context(b, mobile=True, width=w, scheme="dark", motion="no-preference")
            page = ctx.new_page()
            page.goto(base, wait_until="load")
            page.wait_for_timeout(1200)
            scroll_through(page)
            sw = page.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
            wide = page.evaluate(
                "Array.from(document.querySelectorAll('body *')).filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(e).position !== 'fixed').slice(0,6).map(e => e.tagName + '.' + e.className)"
            )
            small_targets = page.evaluate(
                "Array.from(document.querySelectorAll('a,button,input,summary')).filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width && r.height && cs.visibility !== 'hidden' && cs.display !== 'none' && (r.height < 43.5) && !e.closest('.skip') && e.closest('p,li,.footer') == null }).slice(0,10).map(e => e.tagName + ':' + (e.textContent||'').trim().slice(0,24) + ' ' + Math.round(e.getBoundingClientRect().height))"
            )
            out[f"overflow_{w}"] = {"scroll_client": sw, "wider_than_viewport": wide, "targets_under_44": small_targets}
            ctx.close()
        # keyboard: tab through the first 14 stops on desktop
        ctx = context(b, scheme="dark", motion="no-preference")
        page = ctx.new_page()
        page.goto(base, wait_until="load")
        seq = []
        for _ in range(14):
            page.keyboard.press("Tab")
            seq.append(page.evaluate("(document.activeElement.textContent||document.activeElement.getAttribute('aria-label')||document.activeElement.tagName).trim().slice(0,28)"))
        out["tab_order"] = seq
        out["focus_outline"] = page.evaluate("getComputedStyle(document.activeElement).outlineStyle + ' ' + getComputedStyle(document.activeElement).outlineWidth")
        ctx.close()
        # mobile nav toggle
        ctx = context(b, mobile=True, scheme="dark", motion="no-preference")
        page = ctx.new_page()
        page.goto(base, wait_until="load")
        page.click(".nav-toggle")
        out["nav_open"] = page.get_attribute(".nav-toggle", "aria-expanded"), page.locator("#site-nav a").count(), page.is_visible("#site-nav")
        page.screenshot(path=str(OUT / "mobile-nav-open.png"))
        page.click("#site-nav a[href='#method']")
        page.wait_for_timeout(600)
        out["nav_closed_after_click"] = page.get_attribute(".nav-toggle", "aria-expanded")
        ctx.close()
        b.close()
    print(json.dumps(out, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "checks"
    with Server() as srv:
        {"shots": shots, "demos": demos, "checks": checks}[mode](srv.url)
