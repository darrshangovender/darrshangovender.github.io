"""Generate the decorative vibration trace used in the hero (and the OG image): amplitude grows as a
bearing degrades, with impulsive spikes appearing late. Deterministic (seeded); not measured data.

    python tools/make_trace.py [width=1200] [height=170]   ->  prints an SVG path "d" string
"""

from __future__ import annotations

import math
import random
import sys

W = int(sys.argv[1]) if len(sys.argv) > 1 else 1200
H = int(sys.argv[2]) if len(sys.argv) > 2 else 170
STEP = 1.7
rng = random.Random(42)
mid = H / 2


def amp(x: float) -> float:
    t = x / W
    return 1.6 + (H * 0.40) * t**2.7


pts = []
x = 0.0
spike_at = [W * (0.55 + 0.45 * (k / 22) ** 0.8) for k in range(23)]
while x <= W:
    t = x / W
    a = amp(x)
    y = (
        0.55 * math.sin(x * 0.55)
        + 0.30 * math.sin(x * 1.31 + 1.0)
        + 0.18 * math.sin(x * 2.7 + 0.4)
        + rng.gauss(0, 0.28 + 0.55 * t**1.6)
    )
    for s in spike_at:
        d = (x - s) / 2.4
        if abs(d) < 5:
            y += (1.5 + 1.3 * t) * math.exp(-d * d) * (1 if int(s) % 2 else -1)
    pts.append((x, mid - a * y * 0.78))
    x += STEP

d = "M" + "L".join(f"{px:.1f},{py:.1f}" for px, py in pts)
print(d)
