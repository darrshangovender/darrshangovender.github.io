"""Export a real audit log from maintenance-agent: a clean run released after a signed approval,
and a run whose draft is edited to drop an isolation step (blocked by the verifier).

Everything comes from the repo's own orchestrator, verifier, gate and mock CMMS (fixed clock).
Writes data/maintenance-agent.json (provenance) and data/maintenance-agent.js (same payload as a
classic script, so the page works from file://).

Usage (needs maintenance-agent's dependencies: pydantic, cryptography):
    python tools/export_maintenance_agent.py <path-to-maintenance-agent> [<out-dir>=data]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

repo = Path(sys.argv[1])
out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parents[1] / "data"
sys.path.insert(0, str(repo))

import maintenance_agent  # noqa: E402
from maintenance_agent.approval import ApproverRegistry  # noqa: E402
from maintenance_agent.evals.harness import fixed_clock  # noqa: E402
from maintenance_agent.gate import ApprovalGate, GateRefused, make_approver  # noqa: E402
from maintenance_agent.models import WorkOrderDraft  # noqa: E402
from maintenance_agent.verifier import RULES  # noqa: E402
from maintenance_agent.wiring import build_system  # noqa: E402

ALERT = "ALR-1004"


def make_rig():
    keys, approvers = {}, []
    for aid, name, roles in (
        ("planner-1", "Demo Planner", ["PLANNER"]),
        ("safety-1", "Demo Safety Officer", ["PLANNER", "SAFETY_OFFICER"]),
    ):
        a, priv = make_approver(aid, name, roles)
        approvers.append(a)
        keys[aid] = priv
    reg = ApproverRegistry(approvers)
    sysm = build_system(registry=reg, clock=fixed_clock, cmms_clock=fixed_clock)
    return sysm, keys


def h8(x):
    return (x or "")[:8]


def draft_view(d: dict) -> dict:
    return {
        "summary": d.get("summary"),
        "asset_id": d.get("asset_id"),
        "asset_class": d.get("asset_class"),
        "as_of": d.get("as_of"),
        "hypotheses": [
            {"mode": h["mode"], "confidence": h["confidence"], "rationale": h["rationale"]}
            for h in d.get("hypotheses", [])
        ],
        "priority": d.get("priority"),
        "latest_safe_date": d.get("latest_safe_date"),
        "permits": [p if isinstance(p, str) else p.get("permit_type", str(p)) for p in d.get("permits", [])],
        "work_procedures": [f"{w['proc_id']} rev {w['rev']}" for w in d.get("work_procedures", [])],
        "isolation_steps": [
            {
                "seq": s["seq"],
                "ref": f"{s['ref']['proc_id']} rev {s['ref']['rev']} cl {s['ref']['clause_no']}",
                "quote": s["quote"],
            }
            for s in d.get("isolation_steps", [])
        ],
        "controls": [
            {
                "ref": f"{c['ref']['proc_id']} rev {c['ref']['rev']} cl {c['ref']['clause_no']}",
                "quote": c["quote"],
            }
            for c in d.get("controls", [])
        ],
        "parts": d.get("parts"),
        "crew": d.get("crew"),
        "_keys": sorted(d.keys()),
    }


def event_view(r: dict) -> dict:
    t = r["type"]
    ev = {"seq": r["seq"], "type": t, "hash": h8(r.get("hash")), "prev": h8(r.get("prev"))}
    if t == "run_started":
        ev.update(alert_id=r["alert_id"], planner=r["planner"], budget=r["budget"], version=r.get("version"))
    elif t in ("node_entered", "node_completed"):
        ev.update(node=r["node"], status=r.get("status"), next=r.get("next"))
    elif t == "plan":
        ev.update(outline=r["outline"])
    elif t == "tool_call":
        o = r.get("output") or {}
        ev.update(tool=r["tool"], args={k: v for k, v in r["args"].items() if k != "draft"}, status=r["status"],
                  attempt=r.get("attempt"), output_hash=h8(r.get("output_hash")))
        if r["tool"].endswith("quote_clause") and isinstance(o, dict):
            ev["quote"] = {
                "ref": f"{o.get('proc_id')} rev {o.get('rev')} cl {o.get('clause_no')}",
                "text": o.get("text"),
            }
    elif t == "draft_created":
        ev.update(draft_hash=h8(r["draft_hash"]), planner=r["planner"], attempt=r["attempt"])
    elif t in ("verification", "reverification"):
        ev.update(
            passed=r["passed"],
            digest=h8(r["digest"]),
            draft_hash=h8(r["draft_hash"]),
            violations=[{"rule": v["rule_id"], "message": v["message"], "path": v.get("path", "")} for v in r["violations"]],
            warnings=[{"rule": v["rule_id"], "message": v["message"]} for v in r["warnings"]],
            live_alert=r.get("live_alert"),
        )
    elif t == "approval_requested":
        ev.update(draft_hash=h8(r["draft_hash"]), required_role=r["required_role"], status=r["status"],
                  verification_passed=r["verification_passed"])
    elif t == "decision":
        ev.update(kind=r["kind"], by=r["by"], draft_hash=h8(r["draft_hash"]))
        if r["kind"] == "approve":
            a = r["approval"]
            ev.update(approval_id=h8(r["approval_id"]), verification_digest=h8(r["verification_digest"]),
                      signature=(a.get("signature") or "")[:24] + "...", expires_at=a.get("expires_at"))
        if r["kind"] == "edit":
            ev.update(fields=r["fields"], reason=r.get("reason"), draft_hash_before=h8(r["draft_hash_before"]))
    elif t == "decision_refused":
        ev.update(kind=r["kind"], reason=r["reason"])
    elif t in ("released", "release_adopted"):
        ev.update(wo_number=r["wo_number"], approver_id=r["approver_id"], approval_id=h8(r["approval_id"]),
                  draft_hash=h8(r["draft_hash"]))
    else:
        ev["raw_keys"] = sorted(k for k in r if k not in ("seq", "type", "hash", "prev", "ts"))
    return ev


def alert_view(sysm):
    a = sysm.alerts.get_alert(ALERT)
    j = json.loads(a.model_dump_json())
    return j


# ---------------------------------------------------------------- clean run
sysm, keys = make_rig()
orch = sysm.orchestrator
st = orch.run(ALERT, run_id="clean")
assert st.status.value == "AWAITING_APPROVAL", st.status
n_before = len(orch.audit("clean").records())
alert = alert_view(sysm)
draft0 = st.draft
rep0 = st.verification
st = orch.refresh_verification("clean")
gate = ApprovalGate("planner-1", keys["planner-1"], clock=fixed_clock)
appr = gate.approve(run_id="clean", draft=WorkOrderDraft.model_validate(st.draft), report=st.verification)
st = orch.submit_approval("clean", appr)
assert st.status.value == "COMPLETED", st.status
recs = orch.audit("clean").records()
chain_ok = all(recs[i]["prev"] == recs[i - 1]["hash"] for i in range(1, len(recs)))
clean = {
    "run_id": "clean",
    "alert": {
        "alert_id": alert.get("alert_id"),
        "asset": {k: alert["asset"].get(k) for k in ("asset_id", "name", "asset_class", "model")},
        "severity": alert.get("severity"),
        "summary": alert.get("summary"),
        "anomaly_score": alert.get("anomaly_score"),
        "rul": alert.get("rul"),
    },
    "draft": draft_view(draft0),
    "events": [event_view(r) for r in recs],
    "n_before_approval": n_before,
    "chain_ok": chain_ok,
    "release": {"wo_number": st.release.wo_number, "approver_id": st.release.approver_id},
    "rules": [{"id": k, "name": v} for k, v in RULES.items()],
}

# ---------------------------------------------------------------- unsafe run (isolation step dropped)
sysm2, keys2 = make_rig()
orch2 = sysm2.orchestrator
st2 = orch2.run(ALERT, run_id="unsafe")
assert st2.status.value == "AWAITING_APPROVAL"
good_report = st2.verification
good_draft = WorkOrderDraft.model_validate(st2.draft)
steps = [dict(s) for s in st2.draft["isolation_steps"]]
dropped = steps[-1]  # the 'test de-energised' step: the one that proves the lock-out worked
patch_steps = steps[:-1]
patch = {"isolation_steps": patch_steps}
g2 = ApprovalGate("planner-1", keys2["planner-1"], clock=fixed_clock)
sd = g2.sign_edit(run_id="unsafe", draft_hash=st2.draft_hash, patch=patch, reason="remove final test step to save time")
st2 = orch2.submit_edit("unsafe", sd, patch, "remove final test step to save time")
print("unsafe status", st2.status, [v.rule_id for v in st2.verification.violations])
refusals = []
try:
    g2.approve(run_id="unsafe", draft=WorkOrderDraft.model_validate(st2.draft), report=st2.verification)
except GateRefused as exc:
    refusals.append({"where": "signing gate (ApprovalGate.approve)", "text": str(exc)})
# bypass attempt: re-use the signature obtained for the earlier, passing draft
old_appr = g2.approve(run_id="unsafe", draft=good_draft, report=good_report)
try:
    orch2.submit_approval("unsafe", old_appr)
except Exception as exc:  # GateError
    refusals.append({"where": "orchestrator (submit_approval with the earlier approval)", "text": str(exc)})
recs2 = orch2.audit("unsafe").records()
unsafe = {
    "run_id": "unsafe",
    "dropped_step": {
        "seq": dropped["seq"],
        "ref": f"{dropped['ref']['proc_id']} rev {dropped['ref']['rev']} cl {dropped['ref']['clause_no']}",
        "quote": dropped["quote"],
    },
    "draft": draft_view(st2.draft),
    "events": [event_view(r) for r in recs2],
    "refusals": refusals,
    "final_status": st2.status.value,
    "work_orders_created": len(sysm2.cmms.released()),
}

doc = {
    "synthetic_notice": "SYNTHETIC: fixtures, procedures, alerts and approver keys are generated by the repo; nothing here is plant data.",
    "source": {
        "repo": "darrshangovender/maintenance-agent",
        "version": maintenance_agent.__version__,
        "alert": ALERT,
        "planner": "rules (no LLM)",
        "clock": "fixed (evals.harness.fixed_clock)",
        "note": "Timestamps are omitted; hashes are shortened to 8 hex characters.",
    },
    "clean": clean,
    "unsafe": unsafe,
}
out_dir.mkdir(parents=True, exist_ok=True)
payload = json.dumps(doc, separators=(",", ":"), ensure_ascii=False)
(out_dir / "maintenance-agent.json").write_text(payload + "\n", encoding="utf-8", newline="\n")
(out_dir / "maintenance-agent.js").write_text(
    "window.PORTFOLIO_DATA=window.PORTFOLIO_DATA||{};window.PORTFOLIO_DATA.maintenanceAgent=" + payload + ";\n",
    encoding="utf-8",
    newline="\n",
)
print("wrote", out_dir, len(payload), "bytes; chain_ok", chain_ok, "events", len(recs))
print("unsafe:", unsafe["final_status"], "work orders created:", unsafe["work_orders_created"])
