"""Export a small JSON excerpt from asset-health's committed example (seed 42, as of 2025-07-28).

Runs the repo's own code: generate_fleet(SimConfig(seed=42)) -> analyse_source(as_of) -> excerpt.
Writes data/asset-health.json (provenance, readable) and data/asset-health.js (the same payload
as a classic script, so the page also works from file:// where fetch() and ES modules are blocked).

Usage (needs asset-health's dependencies: pandas, numpy, scipy, scikit-learn, pydantic):
    python tools/export_asset_health.py <path-to-asset-health> <scratch-dir> [<out-dir>=data]
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

repo, work = Path(sys.argv[1]), Path(sys.argv[2])
out_dir = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(__file__).resolve().parents[1] / "data"
sys.path.insert(0, str(repo))

import pandas as pd  # noqa: E402

from asset_health.analysis import analyse_source  # noqa: E402
from asset_health.config import SimConfig  # noqa: E402
from asset_health.ingest import open_source  # noqa: E402
from asset_health.models import SYNTHETIC_NOTICE, GroundTruth  # noqa: E402
from asset_health.simulate import generate_fleet, write_dataset  # noqa: E402
import asset_health  # noqa: E402

AS_OF = pd.Timestamp("2025-07-28")
t0 = time.time()
data = work / "demo"
if not (data / "ground_truth.json").exists():
    cfg = SimConfig(seed=42, days=270, failure_fraction=0.65)
    fleet = generate_fleet(cfg, keep_latent=False)
    write_dataset(fleet, data, "csv")
    print("simulated", round(time.time() - t0), "s", flush=True)

truth = GroundTruth.model_validate_json((data / "ground_truth.json").read_text(encoding="utf-8"))
fa = analyse_source(open_source(str(data)), truth=truth, n_jobs=1, as_of=AS_OF)
print("analysed", round(time.time() - t0), "s", flush=True)


def f(x, nd=2):
    return None if x is None or x != x else round(float(x), nd)


def iso(t):
    return pd.Timestamp(t).strftime("%Y-%m-%dT%H:%M")


fleet_rows = []
for a in sorted(fa.assets.values(), key=lambda a: (-a.severity_now.rank, a.asset_id)):
    wo = a.work_orders[0] if a.work_orders else None
    r = wo.rul if wo else None
    fleet_rows.append(
        {
            "id": a.asset_id,
            "name": a.run.spec.name,
            "type": a.run.spec.asset_type.value,
            "severity": a.severity_now.value,
            "hypothesis": wo.failure_mode_hypothesis.value if wo else None,
            "rul": [f(r.p10_days, 1), f(r.p50_days, 1), f(r.p90_days, 1)]
            if r and r.p50_days is not None
            else None,
            "safe_date": f"{wo.latest_safe_date:%Y-%m-%d}" if wo and wo.latest_safe_date else None,
        }
    )

assets = []
for a in fa.assets.values():
    if not a.work_orders or a.asset_id not in {"PMP-02", "PMP-03"}:
        continue
    tr = a.open_trace
    wo = a.work_orders[0]
    fused = a.run.frame["fused"].loc[: fa.as_of]
    start = fa.as_of - pd.Timedelta(days=60)
    six = fused.loc[start:].resample("6h").median()
    fails = [x for x in truth.failures if x.asset_id == a.asset_id]
    ep = tr.episode
    assets.append(
        {
            "id": a.asset_id,
            "name": a.run.spec.name,
            "type": a.run.spec.asset_type.value,
            "threshold": f(a.threshold, 2),
            "series_start": iso(six.index[0]),
            "series_step_h": 6,
            "fused": [f(v, 3) for v in six.to_numpy()],
            "first_exceeded_at": iso(ep.first_exceeded_at) if ep.first_exceeded_at else None,
            "alert_opened_at": iso(ep.opened_at),
            "truth": [
                {
                    "mode": x.mode.value,
                    "onset": iso(x.onset),
                    "failure": iso(x.failure),
                }
                for x in fails
            ],
            "checkpoints": [
                {
                    "t": iso(c.t),
                    "status": c.rul.status.value,
                    "p10": f(c.rul.p10_days, 1),
                    "p50": f(c.rul.p50_days, 1),
                    "p90": f(c.rul.p90_days, 1),
                    "severity": c.severity.value,
                    "act_now": bool(c.act_now),
                }
                for c in tr.checkpoints
            ],
            "work_order": {
                "id": wo.work_order_id,
                "severity": wo.severity.value,
                "hypothesis": wo.failure_mode_hypothesis.value,
                "alternatives": [h.value for h in wo.alternative_hypotheses],
                "rul": [f(wo.rul.p10_days, 1), f(wo.rul.p50_days, 1), f(wo.rul.p90_days, 1)]
                if wo.rul
                else None,
                "latest_safe_date": f"{wo.latest_safe_date:%Y-%m-%d}" if wo.latest_safe_date else None,
                "action": wo.recommended_action,
                "evidence": [
                    {
                        "feature": e.feature,
                        "observed": f(e.observed, 3),
                        "expected": f(e.expected, 3),
                        "unit": e.unit,
                        "z": f(e.z_score, 1),
                        "description": e.description,
                    }
                    for e in wo.evidence
                ],
                "narrative": wo.narrative,
                "narrative_source": wo.narrative_source,
                "data_quality_note": wo.data_quality_note,
            },
        }
    )

doc = {
    "synthetic_notice": SYNTHETIC_NOTICE,
    "source": {
        "repo": "darrshangovender/asset-health",
        "version": asset_health.__version__,
        "command": "asset-health simulate --seed 42; asset-health report --as-of 2025-07-28",
        "seed": 42,
        "as_of": "2025-07-28T00:00",
        "fleet_size": len(fa.assets),
    },
    "fleet": fleet_rows,
    "assets": assets,
}
out_dir.mkdir(parents=True, exist_ok=True)
payload = json.dumps(doc, separators=(",", ":"), ensure_ascii=False)
(out_dir / "asset-health.json").write_text(payload + "\n", encoding="utf-8", newline="\n")
(out_dir / "asset-health.js").write_text(
    "window.PORTFOLIO_DATA=window.PORTFOLIO_DATA||{};window.PORTFOLIO_DATA.assetHealth=" + payload + ";\n",
    encoding="utf-8",
    newline="\n",
)
print("wrote", out_dir, len(payload), "bytes;", [x["id"] for x in assets], flush=True)
