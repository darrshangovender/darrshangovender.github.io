/* Shared helpers (window.PF) for the replay and walk-through scripts.
   Classic scripts with a tiny namespace instead of ES modules: Chrome blocks module scripts and fetch() on file://,
   and this site is meant to work when opened straight from disk.
   NB: never set a "style" attribute: the page CSP forbids it. Dynamic geometry goes through SVG attributes or the CSSOM. */
(function () {
  'use strict';
  var SVGNS = 'http://www.w3.org/2000/svg';
  var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

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
})();
