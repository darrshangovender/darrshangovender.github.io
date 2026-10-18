/* Walk-through of maintenance-agent's state machine, replayed from a REAL hash-chained audit log
   (SYNTHETIC alert and procedures). Data: data/maintenance-agent.js, exported by
   tools/export_maintenance_agent.py from the repo's own orchestrator, verifier, gate and mock CMMS.
   The Approve button reveals the recorded, signed approval; the browser signs nothing. */
(function () {
  'use strict';
  var PF = window.PF;
  var M = window.PORTFOLIO_DATA && window.PORTFOLIO_DATA.maintenanceAgent;
  var root = document.getElementById('ma');
  if (!PF || !M || !root) return;
  var h = PF.h;

  var NODES = ['plan', 'gather', 'draft', 'verify', 'await_approval', 'release'];
  var NODE_LABEL = { plan: 'plan', gather: 'gather', draft: 'draft', verify: 'verify', await_approval: 'await approval', release: 'release' };
  var stage = document.getElementById('ma-stage');
  var logHost = document.getElementById('ma-log');
  var logCount = document.getElementById('ma-logcount');
  var stepper = document.getElementById('ma-stepper');
  var loopNote = document.getElementById('ma-loop');
  var gate = document.getElementById('ma-gate');
  var gateL = document.getElementById('ma-gate-l');
  var gateR = document.getElementById('ma-gate-r');
  var gateMsg = document.getElementById('ma-gate-msg');
  var btnStep = document.getElementById('ma-step');
  var btnAuto = document.getElementById('ma-auto');
  var btnReset = document.getElementById('ma-reset');
  var btnApprove = document.getElementById('ma-approve');
  var btnBypass = document.getElementById('ma-bypass');
  var scn = document.getElementById('ma-scn');
  var announce = PF.announcer(root);

  var S = { name: 'clean', chunks: [], shown: 0, timers: [], auto: 0, approved: false, bypassed: false, steps: [] };

  /* ---------- split an audit log into steps ---------- */
  function chunksFor(name) {
    var ev = M[name].events, out = [], cur = null, closed = true;
    ev.forEach(function (e) {
      if (e.type === 'node_entered') {
        if (cur && cur.pre) { cur.pre = false; cur.events.push(e); cur.node = e.node; closed = false; return; }
        cur = { node: e.node, events: [e], kind: e.node === 'finalise' ? 'release' : e.node };
        out.push(cur); closed = false;
      } else if (!cur || closed) {
        if (!cur && !out.length) { /* run_started precedes the first node */
          cur = { node: 'plan', events: [e], kind: 'plan', pre: true }; out.push(cur); closed = false; return;
        }
        var last = out[out.length - 1];
        if (last && last.inter && !last.sealed) last.events.push(e);
        else out.push({ node: null, events: [e], kind: e.type === 'decision' && e.kind === 'edit' ? 'edit' : e.type === 'decision_refused' ? 'refused' : 'pre-release', inter: true });
      } else {
        cur.events.push(e);
        if (e.type === 'node_completed') closed = true;
      }
    });
    /* an interstitial chunk is sealed when the next node starts: mark all but keep order */
    out.forEach(function (c, i) { c.i = i; });
    /* phase: everything up to the last 'await_approval' node is automatic; the rest needs the human */
    var lastAwait = -1;
    out.forEach(function (c, i) { if (c.kind === 'await_approval') lastAwait = i; });
    out.forEach(function (c, i) { c.phase = i <= lastAwait ? 'auto' : 'action'; });
    return out;
  }

  /* ---------- rows of the audit log ---------- */
  function argSummary(e) {
    if (e.quote) return e.quote.ref;
    var a = e.args || {};
    if (a.query) return '"' + a.query + '"';
    if (a.proc_id) return a.proc_id;
    if (a.permit_type) return 'permit ' + a.permit_type;
    if (a.part_no) return a.part_no;
    if (a.alert_id) return a.alert_id;
    if (a.topics) return a.topics.length + ' topics';
    return '';
  }
  function row(e) {
    var cls = '', body;
    var bold = function (t) { return h('b', { text: t }); };
    var it = function (t) { return h('i', { text: ' ' + t }); };
    switch (e.type) {
      case 'run_started': body = [bold('run_started'), it('alert ' + e.alert_id + ' · planner ' + e.planner)]; break;
      case 'node_entered': body = ['node_entered', it(e.node)]; break;
      case 'node_completed': body = ['node_completed', it(e.node + (e.status ? ' · ' + e.status : ''))]; break;
      case 'plan': body = ['plan', it(e.outline.length + ' steps')]; break;
      case 'tool_call': body = ['tool_call', it(e.tool + ' ' + argSummary(e) + ' · ' + e.status)]; break;
      case 'draft_created': body = ['draft_created', it('hash ' + e.draft_hash)]; break;
      case 'verification':
      case 'reverification':
        cls = e.passed ? 'k-ok' : 'k-bad';
        body = [e.type + ' ', bold(e.passed ? 'PASSED' : 'BLOCKED'),
          it(e.passed ? '16 rules · digest ' + e.digest : e.violations.map(function (v) { return v.rule; }).join(', ') + ' · digest ' + e.digest)];
        break;
      case 'approval_requested':
        cls = e.verification_passed ? '' : 'k-bad';
        body = ['approval_requested', it('role ' + e.required_role + ' · ' + e.status)]; break;
      case 'decision':
        if (e.kind === 'approve') { cls = 'k-key'; body = ['decision ', bold('approve'), it('by ' + e.by + ' · Ed25519 ' + e.signature)]; }
        else { cls = 'k-bad'; body = ['decision ', bold(e.kind), it('by ' + e.by + ' · ' + e.fields.join(', ') + ' · “' + e.reason + '”')]; }
        break;
      case 'decision_refused': cls = 'k-bad'; body = ['decision_refused ', bold(e.kind), it(e.reason)]; break;
      case 'released': cls = 'k-ok'; body = ['released ', bold(e.wo_number), it('by ' + e.approver_id)]; break;
      default: body = [e.type];
    }
    var li = h('li', { class: cls, title: 'prev ' + e.prev + ' → hash ' + e.hash },
      h('span', { class: 'sq', text: e.seq }), h('span', { class: 'ty' }, body), h('span', { class: 'hs', text: e.hash }));
    return li;
  }

  /* ---------- stage views ---------- */
  function kv(pairs) {
    var dl = h('dl', { class: 'kv' });
    pairs.forEach(function (p) { dl.appendChild(h('dt', { text: p[0] })); dl.appendChild(h('dd', { text: p[1] })); });
    return dl;
  }
  function quote(ref, text, removed) {
    return h('p', { class: 'quote' + (removed ? ' removed' : '') }, h('b', { text: ref }), text);
  }
  function rulesGrid(report) {
    var failed = {};
    (report ? report.violations : []).forEach(function (v) { failed[v.rule] = v; });
    var ul = h('ul', { class: 'rules', 'aria-label': 'The 16 verifier rules' });
    M.clean.rules.forEach(function (r, idx) {
      var li = h('li', { 'data-r': 'idle', 'data-id': r.id }, h('span', { class: 'mk', 'aria-hidden': 'true', text: '·' }), h('b', { text: r.id }), r.name);
      ul.appendChild(li);
      var res = failed[r.id] ? 'fail' : 'pass';
      var apply = function () {
        li.setAttribute('data-r', res);
        li.firstChild.textContent = res === 'pass' ? '✓' : '✕';
        li.setAttribute('aria-label', r.id + ' ' + r.name + ': ' + (res === 'pass' ? 'passed' : 'violated'));
      };
      if (PF.reduced()) apply(); else S.timers.push(setTimeout(apply, 70 + idx * 55));
    });
    return ul;
  }
  function explain(v) { return v.rule + ' ' + (M.clean.rules.filter(function (r) { return r.id === v.rule; })[0] || {}).name + ': ' + v.message + (v.path ? ' [' + v.path + ']' : ''); }

  function viewFor(c) {
    var wrap = h('div');
    var D = M.clean.draft;
    var A = M.clean.alert;
    switch (c.kind) {
      case 'plan':
        wrap.appendChild(h('h4', { text: '01 · Plan' }));
        wrap.appendChild(kv([
          ['Alert', A.alert_id + ' · ' + A.summary + ' (' + A.severity + ')'],
          ['Asset', A.asset.asset_id + ' ' + A.asset.name + ' · ' + A.asset.asset_class.toLowerCase().replace('_', ' ')],
          ['RUL at alert', A.rul.lower_days + ' to ' + A.rul.upper_days + ' d, median ' + A.rul.median_days],
          ['Planner', 'rules, no language model'],
          ['Budgets', c.events[0].budget.max_node_steps + ' node steps · ' + c.events[0].budget.max_tool_calls + ' tool-call attempts · ' + c.events[0].budget.max_redrafts + ' redrafts']
        ]));
        var ol = h('ol', { class: 'tight' });
        c.events.filter(function (e) { return e.type === 'plan'; })[0].outline.forEach(function (t) { ol.appendChild(h('li', { text: t })); });
        wrap.appendChild(ol);
        break;
      case 'gather':
        var calls = c.events.filter(function (e) { return e.type === 'tool_call'; });
        wrap.appendChild(h('h4', { text: '02 · Gather: ' + calls.length + ' typed tool calls, none can release' }));
        wrap.appendChild(h('p', { text: 'Each call is schema-validated, scope-locked to this alert and asset, size-capped, timed out and logged. Controlled clauses are quoted verbatim with their revision.' }));
        var box = h('div', { class: 'scroll-box' });
        calls.forEach(function (e) {
          if (e.quote) box.appendChild(quote(e.quote.ref, e.quote.text));
        });
        wrap.appendChild(box);
        break;
      case 'draft':
        wrap.appendChild(h('h4', { text: '03 · Draft: a typed work order with no approval field' }));
        wrap.appendChild(kv([
          ['Hypothesis', D.hypotheses[0].mode + ' (' + D.hypotheses[0].confidence.toFixed(2) + ')'],
          ['Procedure', D.work_procedures.join(', ')],
          ['Priority', D.priority + ' · latest safe date ' + D.latest_safe_date],
          ['Permits', D.permits.join(', ')],
          ['Parts and crew', D.parts.map(function (p) { return p.qty + ' × ' + p.part_no; }).join(', ') + ' · ' + D.crew.map(function (p) { return p.count + ' ' + p.skill; }).join(', ')]
        ]));
        var b2 = h('div', { class: 'scroll-box' });
        D.isolation_steps.forEach(function (st) { b2.appendChild(quote(st.seq + '. ' + st.ref, st.quote)); });
        wrap.appendChild(b2);
        break;
      case 'verify':
        var v = c.events.filter(function (e) { return e.type === 'verification'; })[0];
        wrap.appendChild(h('h4', { text: (S.name === 'unsafe' && v && !v.passed ? '04 · Verify again, from scratch' : '04 · Verify: 16 rules, no model') }));
        wrap.appendChild(rulesGrid(v));
        wrap.appendChild(v.passed
          ? h('p', { class: 'verdict pass' }, h('b', { text: 'PASSED' }), ' · digest ' + v.digest + ' · the verdict is a pure function of the draft and the controlled store, so anyone can re-run it.')
          : h('p', { class: 'verdict fail' }, h('b', { text: 'BLOCKED' }), ' · ', h('code', { text: explain(v.violations[0]) })));
        break;
      case 'edit':
        var ds = M.unsafe.dropped_step, ev = c.events[0];
        wrap.appendChild(h('h4', { text: 'Seeded defect: a signed human edit' }));
        wrap.appendChild(h('p', null, ev.by + ' edits the draft ("' + ev.reason + '"), removing the last isolation step. A model or a hurried editor could do the same.'));
        wrap.appendChild(quote(ds.seq + '. ' + ds.ref + ' (removed)', ds.quote, true));
        wrap.appendChild(h('p', { class: 'note', text: 'Any edit sends the draft back through verification. Nothing is trusted because a person made it.' }));
        break;
      case 'await_approval':
        var rq = c.events.filter(function (e) { return e.type === 'approval_requested'; })[0];
        wrap.appendChild(h('h4', { text: '05 · Await approval: the agent stops' }));
        wrap.appendChild(kv([
          ['Status', rq.status],
          ['Draft hash', rq.draft_hash],
          ['Signing role', rq.required_role + ' (from the verifier’s own requirements matrix)'],
          ['CMMS', 'no work order exists']
        ]));
        wrap.appendChild(rq.verification_passed
          ? h('p', { text: 'A person with a signing key can approve, reject or edit. The agent has no tool that could release.' })
          : h('p', { class: 'verdict fail', text: 'BLOCKED: a person can only reject or edit this draft. Approval is not possible.' }));
        break;
      case 'pre-release':
        wrap.appendChild(h('h4', { text: '06 · Approval' }));
        wrap.appendChild(h('p', { text: 'The draft is re-verified against the live store and a fresh read of the alert, then the approver signs the draft hash together with the verification digest.' }));
        break;
      case 'release':
        var rel = c.events.filter(function (e) { return e.type === 'released'; })[0];
        var dec = M.clean.events.filter(function (e) { return e.type === 'decision' && e.kind === 'approve'; })[0];
        wrap.appendChild(h('h4', { text: '06 · Release: only from a signed approval' }));
        wrap.appendChild(kv([
          ['Released as', rel.wo_number],
          ['Approved by', rel.approver_id + ' · approval ' + rel.approval_id],
          ['Signed over', 'draft ' + rel.draft_hash + ' + digest ' + dec.verification_digest],
          ['Checked again', 'the mock CMMS verified registration, signature, draft hash, expiry, role and single use itself']
        ]));
        break;
      case 'refused':
        wrap.appendChild(h('h4', { text: 'Bypass attempt refused' }));
        wrap.appendChild(h('p', { text: 'The earlier approval was for the original, passing draft. Submitting it against the blocked run is refused by the orchestrator and the refusal is itself written to the audit log.' }));
        break;
    }
    return wrap;
  }

  /* ---------- stepper ---------- */
  function computeStepper() {
    var st = NODES.map(function () { return 'idle'; });
    var note = '';
    for (var k = 0; k < S.shown; k++) {
      var c = S.chunks[k];
      if (c.kind === 'edit') {
        st = st.map(function (x, i) { return i < 3 ? 'done' : i === 3 ? 'current' : 'idle'; });
        note = '↺ human edit: the draft goes back to verify';
        continue;
      }
      if (c.kind === 'refused') continue;
      if (c.kind === 'pre-release') { st[4] = 'current'; continue; }
      var n = c.kind === 'release' ? 5 : NODES.indexOf(c.node);
      var ev = c.events;
      for (var i = 0; i < NODES.length; i++) {
        if (i < n) st[i] = 'done';
        else if (i > n) st[i] = 'idle';
      }
      st[n] = 'current';
      if (c.kind === 'verify') {
        var vr = ev.filter(function (e) { return e.type === 'verification'; })[0];
        if (vr && !vr.passed) st[3] = 'blocked';
      }
      if (c.kind === 'await_approval') {
        var rq = ev.filter(function (e) { return e.type === 'approval_requested'; })[0];
        if (rq && !rq.verification_passed) { st[4] = 'blocked'; st[3] = 'blocked'; }
      }
      if (c.kind === 'release') { st[5] = 'released'; st[4] = 'done'; }
    }
    return { st: st, note: note };
  }
  function paintStepper() {
    var cs = computeStepper();
    Array.prototype.forEach.call(stepper.children, function (li, i) {
      li.setAttribute('data-st', cs.st[i]);
      var small = li.querySelector('small');
      if (small) li.removeChild(small);
      var label = cs.st[i] === 'current' ? 'now' : cs.st[i] === 'done' ? 'done' : cs.st[i] === 'blocked' ? 'blocked' : cs.st[i] === 'released' ? 'released' : '';
      if (label) li.appendChild(h('small', { text: label }));
      li.setAttribute('aria-label', NODE_LABEL[NODES[i]] + (label ? ', ' + label : ''));
    });
    loopNote.textContent = cs.note;
  }

  /* ---------- gate ---------- */
  function paintGate(state, left, right, msg) {
    gate.setAttribute('data-state', state);
    gateL.className = 'gate-node ' + left.cls; gateL.textContent = left.t; gateL.appendChild(h('small', { text: left.s }));
    gateR.className = 'gate-node ' + right.cls; gateR.textContent = right.t; gateR.appendChild(h('small', { text: right.s }));
    gateMsg.textContent = '';
    if (msg) {
      msg.forEach(function (m) { gateMsg.appendChild(typeof m === 'string' ? document.createTextNode(m) : m); });
    }
  }
  function gateIdle() {
    paintGate('closed', { cls: '', t: 'DRAFT', s: 'not yet at the gate' }, { cls: '', t: 'CMMS', s: 'no work order' },
      ['The gate opens only for a signature over this exact draft and verdict. Step through the run to reach it.']);
  }
  function gateWaiting(blocked) {
    paintGate('closed',
      { cls: blocked ? 'is-bad' : 'is-wait', t: blocked ? 'BLOCKED' : 'AWAITING APPROVAL', s: blocked ? 'verification failed' : 'needs a signature' },
      { cls: '', t: 'CMMS', s: 'no work order' },
      blocked ? ['The verifier blocked this draft. Try to approve it anyway.'] : ['Review complete. The gate is shut until a person signs.']);
  }

  /* ---------- reveal engine ---------- */
  function clearTimers() { S.timers.forEach(clearTimeout); S.timers = []; }
  function flushRows() {
    /* finish any row animation immediately */
    S.pendingRows.forEach(function (r) { if (!r.done) { r.done = true; logHost.appendChild(r.li); } });
    S.pendingRows = [];
    clearTimers();
    logCount.textContent = logHost.children.length + ' of ' + M[S.name].events.length;
    scrollLog();
  }
  function scrollLog() { logHost.scrollTop = logHost.scrollHeight; }
  function emptyLog() { logHost.appendChild(h('li', { class: 'empty' }, h('span'), h('span', { text: 'Nothing recorded yet. Press Next step.' }), h('span'))); }

  function revealChunk(i) {
    flushRows();
    var c = S.chunks[i];
    var empty = logHost.querySelector('.empty'); if (empty) logHost.removeChild(empty);
    S.shown = i + 1;
    PF.clear(stage); stage.appendChild(viewFor(c));
    paintStepper();
    var anim = !PF.reduced();
    c.events.forEach(function (e, k) {
      var li = row(e); li.classList.add('is-new');
      var rec = { li: li, done: false };
      S.pendingRows.push(rec);
      var put = function () { if (rec.done) return; rec.done = true; logHost.appendChild(li); logCount.textContent = logHost.children.length + ' of ' + M[S.name].events.length; scrollLog(); };
      if (anim) S.timers.push(setTimeout(put, 40 + k * 55)); else put();
    });
    if (!anim) { S.pendingRows = []; }
    announce(c.kind === 'refused' ? 'Refused.' : 'Step ' + (i + 1) + ' of ' + S.chunks.length + ' shown.');
    afterReveal(c);
  }

  function autoDone() { return S.shown >= S.chunks.filter(function (c) { return c.phase === 'auto'; }).length; }

  function afterReveal(c) {
    var lastAuto = S.chunks.filter(function (x) { return x.phase === 'auto'; }).length;
    if (S.shown < lastAuto) { btnStep.disabled = false; btnApprove.disabled = true; return; }
    /* all automatic steps are shown: now the human decides */
    var blocked = S.name === 'unsafe';
    btnStep.disabled = true;
    stopAuto();
    if (!S.approved && !S.bypassed && c.phase === 'auto') {
      gateWaiting(blocked);
      btnApprove.disabled = false;
    }
  }

  function stopAuto() {
    if (S.auto) { clearInterval(S.auto); S.auto = 0; }
    btnAuto.textContent = 'Auto-play';
  }
  function startAuto() {
    if (S.auto || autoDone()) return;
    btnAuto.textContent = 'Pause';
    if (S.shown === 0) revealChunk(0);
    S.auto = setInterval(function () {
      if (autoDone()) { stopAuto(); return; }
      revealChunk(S.shown);
    }, 1750);
  }

  /* ---------- the human acts ---------- */
  function approve() {
    if (!autoDone()) return;
    btnApprove.disabled = true;
    var first = S.chunks.filter(function (c) { return c.phase === 'action'; });
    if (S.name === 'clean') {
      S.approved = true;
      var idx = S.shown;
      first.forEach(function (c, k) { setTimeout(function () { revealChunk(idx + k); if (k === first.length - 1) finishRelease(); }, k * (PF.reduced() ? 0 : 900)); });
      /* setTimeout above is intentionally not in S.timers: Reset must not cancel a release in progress */
    } else {
      var r = M.unsafe.refusals[0];
      paintGate('refused', { cls: 'is-bad', t: 'BLOCKED', s: 'verification failed' }, { cls: '', t: 'CMMS', s: 'no work order' },
        [h('b', { text: 'Signing gate refused: ' }), h('code', { text: r.text }), ' This happens before anything is signed, so there is no log line for it.']);
      btnBypass.hidden = false; btnBypass.disabled = false;
      announce('Refused. The signing gate will not sign a draft that failed verification.');
    }
  }
  function finishRelease() {
    var rel = M.clean.release;
    paintGate('open', { cls: 'is-ok', t: 'APPROVED', s: rel.approver_id + ' · signed' }, { cls: 'is-ok', t: 'RELEASED', s: rel.wo_number },
      [h('b', { text: 'Gate open. ' }), 'The signature covered this exact draft and its verification digest; the mock CMMS checked it again before creating ' + rel.wo_number + '.']);
    announce('Gate open. Work order ' + rel.wo_number + ' released.');
  }
  function bypass() {
    btnBypass.disabled = true; S.bypassed = true;
    var idx = S.shown;
    revealChunk(idx);
    var r = M.unsafe.refusals[1];
    paintGate('refused', { cls: 'is-bad', t: 'BLOCKED', s: 'verification failed' }, { cls: '', t: 'CMMS', s: 'no work order' },
      [h('b', { text: 'Orchestrator refused: ' }), h('code', { text: r.text }), ' The refusal is in the log (last row). Work orders created: ' + M.unsafe.work_orders_created + '.']);
  }

  /* ---------- reset / scenario ---------- */
  function reset(name, autoplay) {
    stopAuto(); clearTimers();
    S.name = name; S.chunks = chunksFor(name); S.shown = 0; S.approved = false; S.bypassed = false; S.pendingRows = [];
    PF.clear(logHost); emptyLog(); logCount.textContent = '0 of ' + M[name].events.length;
    PF.clear(stage); stage.appendChild(h('p', { class: 'stage-empty', text: 'Press Next step, or let it play. Each step shows what the agent did and the records it wrote.' }));
    btnStep.disabled = false; btnApprove.disabled = true; btnBypass.hidden = true;
    Array.prototype.forEach.call(scn.children, function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-scn') === name ? 'true' : 'false'); });
    paintStepper(); gateIdle();
    if (PF.reduced()) {
      var n = S.chunks.filter(function (c) { return c.phase === 'auto'; }).length;
      for (var i = 0; i < n; i++) revealChunk(i);
    } else if (autoplay) startAuto();
  }

  btnStep.addEventListener('click', function () { stopAuto(); if (!autoDone()) revealChunk(S.shown); });
  btnAuto.addEventListener('click', function () { if (S.auto) stopAuto(); else { if (!autoDone()) startAuto(); } });
  btnReset.addEventListener('click', function () { reset(S.name, false); });
  btnApprove.addEventListener('click', approve);
  btnBypass.addEventListener('click', bypass);
  Array.prototype.forEach.call(scn.children, function (b) {
    b.addEventListener('click', function () { reset(b.getAttribute('data-scn'), !PF.reduced()); });
  });

  var started = false;
  function start() {
    started = true;
    reset('clean', false);
    if (!PF.reduced()) PF.whenVisible(root, function () { if (S.shown === 0) startAuto(); }, 0.35);
  }
  PF.whenVisible(root, start, 0, '300px');
})();
