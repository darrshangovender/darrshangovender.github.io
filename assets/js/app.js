/* Site chrome: theme toggle, phone nav, and a lazy loader for the two replays.
   The page is complete without this file; it only adds the toggle and the interactive panels. */
(function () {
  'use strict';
  var root = document.documentElement;
  var base = (function () {
    var me = document.currentScript;
    return me && me.src ? me.src.replace(/app\.js(\?.*)?$/, '') : 'assets/js/';
  })();

  /* ---------- theme ---------- */
  var themeBtn = document.getElementById('theme-btn');
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function isDark() {
    var t = root.getAttribute('data-theme');
    return t ? t === 'dark' : !!(mq && mq.matches);
  }
  function syncBtn() {
    if (!themeBtn) return;
    themeBtn.setAttribute('aria-label', isDark() ? 'Switch to the light theme' : 'Switch to the dark theme');
  }
  if (themeBtn) {
    syncBtn();
    themeBtn.addEventListener('click', function () {
      var next = isDark() ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) { /* storage may be blocked: the choice then lasts for the visit */ }
      syncBtn();
    });
    if (mq && mq.addEventListener) mq.addEventListener('change', syncBtn);
  }

  /* ---------- nav toggle (phones) ---------- */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (toggle && nav) {
    var setOpen = function (open) {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = open ? 'Close' : 'Menu';
    };
    toggle.addEventListener('click', function () { setOpen(!nav.classList.contains('is-open')); });
    nav.addEventListener('click', function (e) { if (e.target && e.target.tagName === 'A') setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) { setOpen(false); toggle.focus(); }
    });
  }

  /* ---------- replays: load styles, data and scripts when the section is near the viewport ---------- */
  var sec = document.getElementById('replays');
  if (!sec) return;
  var started = false;
  function ready() { root.classList.add('demos-ready'); }
  function start() {
    if (started) return;
    started = true;
    var css = document.getElementById('demos-css');
    if (css) {
      css.addEventListener('load', ready);
      css.addEventListener('error', ready);
      css.media = 'all';
      if (css.sheet) ready();
    } else { ready(); }
    ['data/asset-health.js', 'data/maintenance-agent.js', 'assets/js/pf.js', 'assets/js/replay.js', 'assets/js/agent.js'].forEach(function (p) {
      var sc = document.createElement('script');
      sc.src = base.replace(/assets\/js\/$/, '') + p;
      sc.async = false;
      document.body.appendChild(sc);
    });
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (en) {
      if (en[0].isIntersecting) { io.disconnect(); start(); }
    }, { rootMargin: '900px 0px' });
    io.observe(sec);
  } else { start(); }
})();
