/* Shared helpers (window.PF) plus site chrome: nav toggle and scroll reveal.
   Classic scripts with a tiny namespace instead of ES modules: Chrome blocks module scripts and fetch()
   on file://, and this site is meant to work when opened straight from disk. */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  /* NB: never set a "style" attribute anywhere: the page CSP (style-src 'self') forbids it.
     Dynamic geometry goes through SVG attributes or the CSSOM (el.style.x = ...), both allowed. */
  function apply(el, attrs) {
    for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  function kids(el, list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) kids(el, c);
      else el.appendChild(c && c.nodeType ? c : document.createTextNode(String(c)));
    }
  }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    apply(el, attrs || {});
    kids(el, Array.prototype.slice.call(arguments, 2));
    return el;
  }
  function s(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    apply(el, attrs || {});
    kids(el, Array.prototype.slice.call(arguments, 2));
    return el;
  }
  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }
  function reduced() {
    return !!(motionQuery && motionQuery.matches);
  }
  /* run cb once when el first becomes sufficiently visible */
  function whenVisible(el, cb, threshold, margin) {
    if (!('IntersectionObserver' in window)) {
      cb();
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            io.disconnect();
            cb();
            return;
          }
        }
      },
      { threshold: threshold || 0, rootMargin: margin || '0px' }
    );
    io.observe(el);
  }
  function announcer(host) {
    var live = h('div', { class: 'sr-only', 'aria-live': 'polite', role: 'status' });
    host.appendChild(live);
    return function (msg) {
      live.textContent = '';
      window.setTimeout(function () {
        live.textContent = msg;
      }, 40);
    };
  }

  window.PF = { h: h, s: s, clear: clear, reduced: reduced, whenVisible: whenVisible, announcer: announcer };

  /* ---------- nav toggle (phones) ---------- */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (toggle && nav) {
    var setOpen = function (open) {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = open ? 'Close' : 'Menu';
    };
    toggle.addEventListener('click', function () {
      setOpen(!nav.classList.contains('is-open'));
    });
    nav.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'A') setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        setOpen(false);
        toggle.focus();
      }
    });
  }

  /* ---------- scroll reveal ---------- */
  var items = document.querySelectorAll('.reveal');
  if (!items.length) return;
  if (!('IntersectionObserver' in window) || reduced()) {
    for (var i = 0; i < items.length; i++) items[i].classList.add('is-in');
    return;
  }
  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('is-in');
          io.unobserve(en.target);
        }
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
  );
  items.forEach(function (el) {
    io.observe(el);
  });
})();
