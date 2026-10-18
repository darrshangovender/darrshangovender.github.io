/* Interactive replay of asset-health's fleet report (SYNTHETIC data).
   Data: data/asset-health.js, exported from the repo's own pipeline by tools/export_asset_health.py.
   The line is the real fused detection score (6 h median), the intervals are the real RUL checkpoints,
   the work order is the real drafted work order. Nothing is invented in this file. */
(function () {
  'use strict';
  var PF = window.PF;
  var D = window.PORTFOLIO_DATA && window.PORTFOLIO_DATA.assetHealth;
  var root = document.getElementById('ah');
  if (!PF || !D || !root) return;
  var h = PF.h, s = PF.s;

  var DAY = 864e5;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parse(iso) { return Date.parse(iso + ':00Z'); }
  function fmtD(t) { var d = new Date(t); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; }
  function fmtDT(t) { var d = new Date(t); return fmtD(t) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  function fmtDY(t) { return fmtD(t) + ' ' + new Date(t).getUTCFullYear(); }
  function num(x, nd) { return x === null || x === undefined ? 'n/a' : x.toFixed(nd === undefined ? 1 : nd); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------- prepare data ---------- */
  var asOf = parse(D.source.as_of);
  var assets = D.assets.map(function (a) {
    var truth = a.truth[0];
    var t0 = parse(a.series_start);
    var step = a.series_step_h * 36e5;
    var d0 = asOf - 48 * DAY;
    var iStart = Math.max(0, Math.ceil((d0 - t0) / step));
    var iEnd = a.fused.length - 1;
    return {
      id: a.id, name: a.name, raw: a, thr: a.threshold, fused: a.fused, t0: t0, step: step,
      iStart: iStart, iEnd: iEnd, d0: t0 + iStart * step,
      d1: Math.max(asOf + 12 * DAY, parse(truth.failure) + 2 * DAY),
      first: parse(a.first_exceeded_at), open: parse(a.alert_opened_at),
      cps: a.checkpoints.map(function (c) { var o = {}; for (var k in c) o[k] = c[k]; o.ts = parse(c.t); return o; }),
      failAt: parse(truth.failure), onsetAt: parse(truth.onset), mode: truth.mode, wo: a.work_order
    };
  });

  var state = { a: 0, i: 0, playing: false, raf: 0, last: 0, announced: {} };
  var chartHost = document.getElementById('ah-chart');
  var readHost = document.getElementById('ah-readouts');
  var woHost = document.getElementById('ah-wo');
  var playBtn = document.getElementById('ah-play');
  var restartBtn = document.getElementById('ah-restart');
  var scrub = document.getElementById('ah-scrub');
  var assetHost = document.getElementById('ah-assets');
  var srcChip = document.getElementById('ah-src');
  var announce = PF.announcer(root);
  var chart = null; // current chart geometry and nodes

  srcChip.textContent = 'asset-health v' + D.source.version + ' · seed ' + D.source.seed;

  /* ---------- asset selector ---------- */
  assets.forEach(function (a, idx) {
    assetHost.appendChild(h('button', {
      type: 'button', 'aria-pressed': idx === 0 ? 'true' : 'false', 'data-idx': idx, text: a.id,
      title: a.name,
      onclick: function () { selectAsset(idx, true); }
    }));
  });

  /* ---------- readouts ---------- */
  var rd = {
    date: h('dd'), score: h('dd'), alert: h('dd'), rul: h('dd')
  };
  [['Replay time (UTC)', rd.date], ['Fused score', rd.score], ['Alert', rd.alert], ['Remaining useful life', rd.rul]].forEach(function (p) {
    readHost.appendChild(h('div', null, h('dt', { text: p[0] }), p[1]));
  });

  /* ---------- helpers on time/index ---------- */
  function A() { return assets[state.a]; }
  function timeAt(i) { var a = A(); return a.t0 + i * a.step; }
  function valueAt(i) {
    var a = A(), k = Math.floor(i), f = i - k;
    var v0 = a.fused[k], v1 = a.fused[Math.min(k + 1, a.iEnd)];
    if (v0 === null || v0 === undefined) return null;
    if (f === 0 || v1 === null || v1 === undefined) return v0;
    return v0 + (v1 - v0) * f;
  }
  function checkpointsUpTo(t) {
    return A().cps.filter(function (c) { return c.ts <= t; });
  }

  /* ---------- chart ---------- */
  function build() {
    var a = A();
    var W = Math.max(300, Math.floor(chartHost.clientWidth || 640));
    var narrow = W < 520;
    var left = narrow ? 34 : 42, right = 14, top = 14;
    var plotH = Math.round(clamp(W * 0.3, 170, 250));
    var plotB = top + plotH;
    var rows = a.cps.length;
    var rowH = 8;
    var laneTop = plotB + 50;
    var laneH = rows * rowH + 10;
    var H = laneTop + laneH + 8;
    var pw = W - left - right;
    var d0 = a.d0, d1 = a.d1;
    var maxY = 2;

    function X(t) { return left + ((t - d0) / (d1 - d0)) * pw; }
    function Y(v) { return plotB - (clamp(v, 0, maxY) / maxY) * plotH; }

    PF.clear(chartHost);
    var svg = s('svg', {
      viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img',
      'aria-label': 'Fused detection score for ' + a.name + ' (' + a.id + ') rising through its alert threshold, with remaining-useful-life intervals below. Synthetic data.'
    });
    var defs = s('defs', null,
      s('linearGradient', { id: 'ah-grad', x1: '0', y1: '0', x2: '0', y2: '1' },
        s('stop', { offset: '0', class: 'ch-area-stop-a' }), s('stop', { offset: '1', class: 'ch-area-stop-b' })),
      s('clipPath', { id: 'ah-clip' }, s('rect', { x: left, y: top - 4, width: pw, height: plotH + 8 })));
    svg.appendChild(defs);

    /* future region (after the snapshot) */
    svg.appendChild(s('rect', { class: 'ch-future', x: X(asOf), y: top, width: left + pw - X(asOf), height: laneTop + laneH - top }));
    if (!narrow) svg.appendChild(s('text', { class: 'ch-future-label', x: X(asOf) + 8, y: top + 14, text: 'after the snapshot' }));

    /* grid + y labels */
    [0, 0.5, 1, 1.5, 2].forEach(function (v) {
      svg.appendChild(s('line', { class: 'ch-grid', x1: left, x2: left + pw, y1: Y(v), y2: Y(v) }));
      svg.appendChild(s('text', { class: 'ch-axis', x: left - 8, y: Y(v) + 4, 'text-anchor': 'end', text: v === 0 ? '0' : v.toFixed(1) }));
    });
    /* x ticks */
    var tickEvery = (narrow || (d1 - d0) / DAY > 70) ? 14 : 7;
    var first = Math.ceil(d0 / DAY) * DAY;
    for (var t = first; t <= d1; t += tickEvery * DAY) {
      svg.appendChild(s('line', { class: 'ch-grid', x1: X(t), x2: X(t), y1: plotB, y2: plotB + 4 }));
      svg.appendChild(s('text', { class: 'ch-axis', x: X(t), y: plotB + 17, 'text-anchor': 'middle', text: fmtD(t) }));
    }
    svg.appendChild(s('text', { class: 'ch-axis-title', x: left, y: plotB + 36, text: narrow ? 'Failure window (80%) per daily checkpoint' : 'Remaining useful life, 80% interval, as projected at each daily checkpoint' }));

    /* threshold */
    svg.appendChild(s('line', { class: 'ch-thr', x1: left, x2: left + pw, y1: Y(a.thr), y2: Y(a.thr) }));
    svg.appendChild(s('text', { class: 'ch-thr-label', x: left + 6, y: Y(a.thr) - 6, text: 'alert threshold ' + a.thr.toFixed(2) }));

    /* lane background */
    svg.appendChild(s('rect', { class: 'ch-lane-bg', x: left, y: laneTop, width: pw, height: laneH, rx: 3 }));

    /* dynamic nodes */
    var gPlot = s('g', { 'clip-path': 'url(#ah-clip)' });
    var area = s('path', { fill: 'url(#ah-grad)', d: '' });
    var line = s('path', { class: 'ch-line', d: '' });
    gPlot.appendChild(area); gPlot.appendChild(line);
    svg.appendChild(gPlot);

    var alertG = s('g', { visibility: 'hidden' },
      s('line', { class: 'ch-alert-line', x1: X(a.open), x2: X(a.open), y1: top, y2: laneTop + laneH }),
      s('text', { class: 'ch-alert-label', x: X(a.open) - 6, y: top + 12, 'text-anchor': 'end', text: 'Alert opens ' + fmtD(a.open) }));
    svg.appendChild(alertG);

    var lane = s('g', { 'clip-path': 'url(#ah-lane-clip)' });
    defs.appendChild(s('clipPath', { id: 'ah-lane-clip' }, s('rect', { x: left, y: laneTop, width: pw, height: laneH })));
    svg.appendChild(lane);

    var failG = s('g', { visibility: 'hidden' });
    var fx = X(a.failAt), ox = X(a.onsetAt);
    failG.appendChild(s('line', { class: 'ch-onset', x1: ox, x2: ox, y1: top, y2: plotB }));
    if (!narrow) failG.appendChild(s('text', { class: 'ch-axis', x: ox + 4, y: plotB - 6, text: 'degradation starts' }));
    failG.appendChild(s('line', { class: 'ch-fail', x1: fx, x2: fx, y1: top, y2: laneTop + laneH }));
    var failLabelRight = fx + 6 + 150 < W;
    failG.appendChild(s('text', {
      class: 'ch-fail-label', x: failLabelRight ? fx + 6 : fx - 6, y: top + 28,
      'text-anchor': failLabelRight ? 'start' : 'end', text: (narrow ? 'Failure ' : 'Injected failure ') + fmtD(a.failAt)
    }));
    if (!narrow) failG.appendChild(s('text', {
      class: 'ch-axis', x: failLabelRight ? fx + 6 : fx - 6, y: top + 42,
      'text-anchor': failLabelRight ? 'start' : 'end', text: '(answer key)'
    }));
    svg.appendChild(failG);

    var pulse = s('circle', { class: 'ch-head ch-head-pulse', r: 4, cx: -10, cy: -10, opacity: 0.4 });
    var head = s('circle', { class: 'ch-head', r: 4.5, cx: -10, cy: -10 });
    svg.appendChild(pulse); svg.appendChild(head);

    chartHost.appendChild(svg);
    chart = { W: W, H: H, X: X, Y: Y, svg: svg, area: area, line: line, alertG: alertG, lane: lane, failG: failG, head: head, pulse: pulse, laneTop: laneTop, rowH: rowH, plotB: plotB, left: left, pw: pw, fx: fx };
  }

  function drawLane(t) {
    var a = A(), c = chart;
    PF.clear(c.lane);
    var cps = checkpointsUpTo(t);
    cps.forEach(function (cp, k) {
      var y = c.laneTop + 5 + k * c.rowH;
      var isCur = k === cps.length - 1;
      if (cp.status === 'estimated') {
        var x1 = c.X(cp.ts + cp.p10 * DAY), x2 = c.X(cp.ts + cp.p90 * DAY);
        c.lane.appendChild(s('rect', { class: isCur ? 'ch-rul-cur' : 'ch-rul-old', x: x1, y: y, width: Math.max(1, x2 - x1), height: c.rowH - 2, rx: 2 }));
        var xm = c.X(cp.ts + cp.p50 * DAY);
        c.lane.appendChild(s('line', { class: 'ch-rul-med', x1: xm, x2: xm, y1: y - 1, y2: y + c.rowH - 1, opacity: isCur ? 1 : 0.45 }));
      } else {
        var xs = c.X(cp.ts);
        c.lane.appendChild(s('rect', { class: 'ch-rul-none', x: xs - 3, y: y, width: 6, height: c.rowH - 2, rx: 2 }));
      }
    });
    if (!cps.length) {
      c.lane.appendChild(s('text', { class: 'ch-lane-label', x: c.left + 8, y: c.laneTop + 15, text: 'no interval is issued until an alert is open' }));
    }
  }

  function render() {
    var a = A(), c = chart;
    if (!c) return;
    var i = clamp(state.i, a.iStart, a.iEnd);
    var t = timeAt(i);
    /* path through the samples up to i, with gaps where the data was masked */
    var d = '', ad = '', gap = true, segStartX = 0, lastX = 0, base = c.Y(0);
    for (var k = a.iStart; k <= Math.floor(i); k++) {
      var v = a.fused[k];
      if (v === null || v === undefined) {
        if (!gap) { ad += 'L' + lastX + ',' + base + 'Z'; }
        gap = true; continue;
      }
      var x = c.X(a.t0 + k * a.step), y = c.Y(v);
      if (gap) { d += 'M' + x.toFixed(1) + ',' + y.toFixed(1); ad += 'M' + x.toFixed(1) + ',' + base + 'L' + x.toFixed(1) + ',' + y.toFixed(1); segStartX = x; }
      else { d += 'L' + x.toFixed(1) + ',' + y.toFixed(1); ad += 'L' + x.toFixed(1) + ',' + y.toFixed(1); }
      lastX = x.toFixed(1); gap = false;
    }
    var hv = valueAt(i);
    var hx = c.X(t);
    if (hv !== null && !gap) {
      var hy = c.Y(hv);
      d += 'L' + hx.toFixed(1) + ',' + hy.toFixed(1); ad += 'L' + hx.toFixed(1) + ',' + hy.toFixed(1); lastX = hx.toFixed(1);
      c.head.setAttribute('cx', hx); c.head.setAttribute('cy', hy);
      c.pulse.setAttribute('cx', hx); c.pulse.setAttribute('cy', hy);
    } else if (hv !== null) {
      c.head.setAttribute('cx', hx); c.head.setAttribute('cy', c.Y(hv));
      c.pulse.setAttribute('cx', hx); c.pulse.setAttribute('cy', c.Y(hv));
    } else {
      c.head.setAttribute('cx', -10); c.pulse.setAttribute('cx', -10);
    }
    if (!gap) ad += 'L' + lastX + ',' + base + 'Z';
    c.line.setAttribute('d', d);
    c.area.setAttribute('d', ad);
    var atEnd = i >= a.iEnd - 0.001;
    c.alertG.setAttribute('visibility', t >= a.open ? 'visible' : 'hidden');
    c.failG.setAttribute('visibility', atEnd ? 'visible' : 'hidden');
    c.pulse.setAttribute('visibility', state.playing ? 'visible' : 'hidden');
    drawLane(t);

    /* readouts */
    rd.date.textContent = fmtDT(t);
    var vNow = valueAt(i);
    rd.score.textContent = '';
    rd.score.appendChild(document.createTextNode(vNow === null ? 'no data' : vNow.toFixed(2)));
    rd.score.appendChild(h('small', { text: vNow === null ? 'readings masked by the data-quality gate' : 'threshold ' + a.thr.toFixed(2) }));
    var st, stCls, stNote;
    if (t < a.first) { st = 'Below threshold'; stCls = 'state-below'; stNote = 'no alert'; }
    else if (t < a.open) { st = 'Above, confirming'; stCls = 'state-above'; stNote = 'needs 4 h above threshold and 2 of 3 detectors'; }
    else { st = 'ALERT OPEN'; stCls = 'state-open'; stNote = 'since ' + fmtDT(a.open); }
    rd.alert.textContent = ''; rd.alert.className = stCls;
    rd.alert.appendChild(document.createTextNode(st)); rd.alert.appendChild(h('small', { text: stNote }));
    var cps = checkpointsUpTo(t), cur = cps[cps.length - 1];
    rd.rul.textContent = '';
    if (!cur) {
      rd.rul.appendChild(document.createTextNode('none yet'));
      rd.rul.appendChild(h('small', { text: 'only estimated while an alert is open' }));
    } else if (cur.status === 'estimated') {
      rd.rul.appendChild(document.createTextNode(num(cur.p50) + ' d'));
      rd.rul.appendChild(h('small', { text: '80% interval ' + num(cur.p10) + ' to ' + num(cur.p90) + ' d · checkpoint ' + fmtDT(cur.ts) }));
    } else {
      rd.rul.appendChild(document.createTextNode('no interval'));
      rd.rul.appendChild(h('small', { text: 'status ' + cur.status + ' at ' + fmtDT(cur.ts) + ': none is issued' }));
    }

    /* slider */
    scrub.value = String(Math.round(i - a.iStart));
    scrub.setAttribute('aria-valuetext', fmtDT(t) + (t >= a.open ? ', alert open' : ''));

    /* work order and announcements */
    renderWO(atEnd);
    if (t >= a.open && !state.announced.open) { state.announced.open = 1; announce('Alert opened on ' + fmtDT(a.open) + '.'); }
    if (atEnd && !state.announced.end) { state.announced.end = 1; announce('Snapshot reached. Work order drafted. The simulator’s answer key is now shown.'); }
    if (!atEnd) { state.announced.end = 0; }
    if (t < a.open) { state.announced.open = 0; }
  }

  /* ---------- work order ---------- */
  var woShown = false;
  function renderWO(show) {
    if (show === woShown && woHost.firstChild) return;
    woShown = show;
    PF.clear(woHost);
    var a = A();
    if (!show) {
      woHost.appendChild(h('div', { class: 'wo-ghost' }, 'The work order is drafted from the alert at the snapshot (' + fmtDY(asOf) + '). Press play, or drag the slider to the end, to see it and the answer key.'));
      return;
    }
    var wo = a.wo, cp = a.cps[a.cps.length - 1];
    var daysAfter = (a.failAt - cp.ts) / DAY;
    var inside = cp.status === 'estimated' && daysAfter >= cp.p10 && daysAfter <= cp.p90;
    var outsideBy = cp.status === 'estimated' ? (daysAfter < cp.p10 ? cp.p10 - daysAfter : daysAfter - cp.p90) : 0;
    var rows = wo.evidence.map(function (e) {
      return h('tr', null, h('td', { text: e.feature }), h('td', { class: 'n', text: e.observed + (e.unit ? ' ' + e.unit : '') }),
        h('td', { class: 'n', text: e.expected + (e.unit ? ' ' + e.unit : '') }), h('td', { class: 'n', text: (e.z > 0 ? '+' : '') + e.z }),
        h('td', { text: e.description }));
    });
    var box = h('div', { class: 'wo is-fresh' },
      h('div', { class: 'wo-head' }, h('b', { text: 'Work order ' + wo.id }), h('span', { class: 'chip chip-bad', text: wo.severity }), h('span', { class: 'chip chip-synth', text: 'Synthetic' })),
      h('dl', { class: 'wo-grid' },
        h('div', null, h('dt', { text: 'Hypothesis' }), h('dd', { class: 'mono', text: wo.hypothesis + (wo.alternatives.length ? ' (alt: ' + wo.alternatives.join(', ') + ')' : '') })),
        h('div', null, h('dt', { text: 'Remaining useful life' }), h('dd', { class: 'mono', text: num(wo.rul[1]) + ' d (80%: ' + num(wo.rul[0]) + ' to ' + num(wo.rul[2]) + ')' })),
        h('div', null, h('dt', { text: 'Latest safe date' }), h('dd', { class: 'mono', text: wo.latest_safe_date }))),
      h('p', null, h('b', { text: 'Action: ' }), wo.action),
      h('div', { class: 'table-scroll' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { text: 'Evidence' }), h('th', { class: 'n', text: 'Observed' }), h('th', { class: 'n', text: 'Expected' }), h('th', { class: 'n', text: 'z' }), h('th', { text: '' }))),
        h('tbody', null, rows))),
      h('p', { class: 'note', text: wo.narrative + ' [narrative source: ' + wo.narrative_source + ', no LLM]' }),
      h('p', { class: 'outcome ' + (inside ? 'hit' : 'miss') },
        h('b', { text: 'Answer key: ' }),
        'the simulator injected an ' + a.mode + ' failure for ' + fmtDT(a.failAt) + ', ' + num(daysAfter) + ' days after the last checkpoint (' + fmtDT(cp.ts) + '). The 80% interval was ' + num(cp.p10) + ' to ' + num(cp.p90) + ' days, so the failure fell ' +
        (inside ? 'inside it.' : 'outside it, by ' + num(outsideBy) + ' days. The README reports this miss too.')));
    woHost.appendChild(box);
  }

  /* ---------- animation ---------- */
  var DURATION_S = 11;
  function setPlaying(p) {
    state.playing = p;
    playBtn.textContent = p ? 'Pause' : (state.i >= A().iEnd ? 'Replay' : 'Play');
    if (p) { state.last = 0; state.raf = requestAnimationFrame(tick); } else { cancelAnimationFrame(state.raf); }
  }
  function tick(ts) {
    if (!state.playing) return;
    var a = A();
    if (!state.last) state.last = ts;
    var dt = Math.min(0.1, (ts - state.last) / 1000);
    state.last = ts;
    var speed = (a.iEnd - a.iStart) / DURATION_S;
    /* ease the pace around the alert so the crossing is readable */
    var tNow = timeAt(state.i);
    if (tNow > a.first - 1.5 * DAY && tNow < a.open + 1.2 * DAY) speed *= 0.35;
    state.i = Math.min(a.iEnd, state.i + speed * dt);
    render();
    if (state.i >= a.iEnd) { setPlaying(false); render(); return; }
    state.raf = requestAnimationFrame(tick);
  }
  function selectAsset(idx, autoplay) {
    state.a = idx; state.announced = {}; woShown = false;
    Array.prototype.forEach.call(assetHost.children, function (b, k) { b.setAttribute('aria-pressed', k === idx ? 'true' : 'false'); });
    var a = A();
    scrub.min = '0'; scrub.max = String(a.iEnd - a.iStart);
    state.i = a.iStart;
    setPlaying(false);
    build(); PF.clear(woHost); render();
    if (autoplay && !PF.reduced()) { setPlaying(true); }
    else if (PF.reduced()) { state.i = a.iEnd; render(); setPlaying(false); }
  }

  playBtn.addEventListener('click', function () {
    var a = A();
    if (state.playing) { setPlaying(false); return; }
    if (state.i >= a.iEnd - 0.001) { state.i = a.iStart; state.announced = {}; }
    if (PF.reduced()) { state.i = a.iEnd; render(); setPlaying(false); return; }
    setPlaying(true);
  });
  restartBtn.addEventListener('click', function () {
    var a = A(); state.announced = {};
    state.i = a.iStart; render();
    if (PF.reduced()) { state.i = a.iEnd; render(); setPlaying(false); } else { setPlaying(true); }
  });
  scrub.addEventListener('input', function () {
    var a = A();
    setPlaying(false);
    state.i = a.iStart + Number(scrub.value);
    render();
    playBtn.textContent = state.i >= a.iEnd ? 'Replay' : 'Play';
  });

  var rz = null, lastW = 0;
  function onResize() {
    var w = Math.floor(chartHost.clientWidth || 0);
    if (!w || Math.abs(w - lastW) < 2) return;
    lastW = w;
    build(); render();
  }
  /* ---------- start (built lazily, when the panel is near the viewport) ---------- */
  function start() {
    selectAsset(0, false);
    lastW = Math.floor(chartHost.clientWidth || 0);
    if ('ResizeObserver' in window) {
      new ResizeObserver(function () { clearTimeout(rz); rz = setTimeout(onResize, 80); }).observe(chartHost);
    } else { window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(onResize, 80); }); }
    if (PF.reduced()) {
      state.i = A().iEnd; render(); playBtn.textContent = 'Replay';
    } else {
      PF.whenVisible(root, function () { if (!state.playing && state.i <= A().iStart) setPlaying(true); }, 0.4);
    }
  }
  PF.whenVisible(root, start, 0, '300px');
})();
