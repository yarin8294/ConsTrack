#!/usr/bin/env python3
"""
Plain-script tests for match_displacements() in change_detector.py.
No pytest required.  Exit 0 = all pass, exit 1 = any failure.

    python test_displacement.py

Strategy: match_displacements() is pure numpy/Python and never touches
open3d at runtime, so we stub the library before importing change_detector.
This lets the test run on any Python with numpy installed, including
environments where open3d is not (or cannot be) installed.
"""
import os
import sys
from types import ModuleType, SimpleNamespace

# ---------------------------------------------------------------------------
# Stub open3d before change_detector is imported.
# setdefault: if the real library is already installed, leave it alone.
# ---------------------------------------------------------------------------
_o3d = ModuleType("open3d")
_o3d.utility = SimpleNamespace(
    set_verbosity_level=lambda *_a, **_k: None,
    VerbosityLevel=SimpleNamespace(Error=0),
)
sys.modules.setdefault("open3d", _o3d)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from change_detector import match_displacements  # noqa: E402

# ---------------------------------------------------------------------------
# Minimal test harness
# ---------------------------------------------------------------------------
_passed = 0
_failed = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global _passed, _failed
    if condition:
        _passed += 1
        print(f"  [PASS] {name}")
    else:
        _failed += 1
        suffix = f"  ({detail})" if detail else ""
        print(f"  [FAIL] {name}{suffix}")


def approx(a: float, b: float, tol: float = 1e-4) -> bool:
    return abs(a - b) <= tol


def cluster(cid: int, centroid: list, obb_vol: float) -> dict:
    """Minimal cluster dict that matches the change_detector schema."""
    return {
        "clusterId":      cid,
        "pointCount":     100,
        "centroidXYZ":    centroid,
        "obbVolumeM3":    obb_vol,
        "voxelVolumeM3":  obb_vol * 0.1,
        "obbExtentM":     [1.0, 1.0, 1.0],
        "hullVolumeM3":   obb_vol,   # set equal to OBB so ratio/mean assertions are unchanged
        "hullDegenerate": False,
    }


# ---------------------------------------------------------------------------
# Test 1 — Identity: empty inputs
# ---------------------------------------------------------------------------
print("Test 1: Identity — match_displacements([], [])")
r = match_displacements([], [])
check("events == []", r["events"] == [])
check("newConstructionM3 == 0", r["newConstructionM3"] == 0)
check("demolitionM3 == 0", r["demolitionM3"] == 0)
check("displacementM3 == 0", r["displacementM3"] == 0)
check("stats.matched == 0", r["stats"]["matched"] == 0)

print("Test 1b: Identity — match_displacements(some_clusters, [])")
some = [cluster(7, [1.0, 2.0, 3.0], 2.5)]
r = match_displacements(some, [])
check("events == []", r["events"] == [])
check("newConstructionM3 == 2.5 (all added are unmatched)",
      approx(r["newConstructionM3"], 2.5), f"got {r['newConstructionM3']}")
check("demolitionM3 == 0", r["demolitionM3"] == 0)
check("stats.unmatchedAdded == 1", r["stats"]["unmatchedAdded"] == 1)

# ---------------------------------------------------------------------------
# Test 2 — Forced displacement: 1.5 m apart, identical OBB volumes
# ---------------------------------------------------------------------------
print("Test 2: Forced displacement — removed [0,0,0], added [1.5,0,0], obbVol=1.0 each")
removed = [cluster(0, [0.0, 0.0, 0.0], 1.0)]
added   = [cluster(0, [1.5, 0.0, 0.0], 1.0)]
r = match_displacements(added, removed)
check("exactly 1 event", len(r["events"]) == 1, f"got {len(r['events'])}")
if r["events"]:
    ev = r["events"][0]
    check("displacementM ~= 1.5", approx(ev["displacementM"], 1.5, tol=1e-3),
          f"got {ev['displacementM']}")
    check("volumeM3 ~= 1.0 (mean of both OBBs)", approx(ev["volumeM3"], 1.0),
          f"got {ev['volumeM3']}")
check("newConstructionM3 == 0 (added cluster was matched)",
      approx(r["newConstructionM3"], 0.0), f"got {r['newConstructionM3']}")
check("demolitionM3 == 0 (removed cluster was matched)",
      approx(r["demolitionM3"], 0.0), f"got {r['demolitionM3']}")
check("displacementM3 ~= 1.0", approx(r["displacementM3"], 1.0),
      f"got {r['displacementM3']}")

# ---------------------------------------------------------------------------
# Test 3 — Too far apart: 10 m > max_displacement_m default of 5.0
# ---------------------------------------------------------------------------
print("Test 3: Too far apart — removed [0,0,0], added [10,0,0]")
removed = [cluster(0, [0.0, 0.0, 0.0], 1.0)]
added   = [cluster(0, [10.0, 0.0, 0.0], 1.0)]
r = match_displacements(added, removed)
check("0 events", len(r["events"]) == 0, f"got {len(r['events'])}")
check("newConstructionM3 ~= 1.0 (added unmatched)",
      approx(r["newConstructionM3"], 1.0), f"got {r['newConstructionM3']}")
check("demolitionM3 ~= 1.0 (removed unmatched)",
      approx(r["demolitionM3"], 1.0), f"got {r['demolitionM3']}")
check("displacementM3 == 0", approx(r["displacementM3"], 0.0),
      f"got {r['displacementM3']}")

# ---------------------------------------------------------------------------
# Test 4 — Volume mismatch: ratio = 0.1/1.0 = 0.1, below the 0.6 floor
# ---------------------------------------------------------------------------
print("Test 4: Volume mismatch — removed obbVol=1.0, added obbVol=0.1  (ratio 0.1 < 0.6)")
removed = [cluster(0, [0.0, 0.0, 0.0], 1.0)]
added   = [cluster(0, [1.5, 0.0, 0.0], 0.1)]
r = match_displacements(added, removed)
check("0 events (ratio below 0.6 threshold)", len(r["events"]) == 0,
      f"got {len(r['events'])}")
check("newConstructionM3 ~= 0.1 (added is unmatched)",
      approx(r["newConstructionM3"], 0.1), f"got {r['newConstructionM3']}")
check("demolitionM3 ~= 1.0 (removed is unmatched)",
      approx(r["demolitionM3"], 1.0), f"got {r['demolitionM3']}")

# ---------------------------------------------------------------------------
# Test 5 — Greedy matching: 1 removed, 2 added — closer one wins
# ---------------------------------------------------------------------------
print("Test 5: Greedy matching — 1 removed at [0,0,0], 2 added at [2.0,0,0] and [1.0,0,0]")
removed = [cluster(0, [0.0, 0.0, 0.0], 1.0)]
added   = [
    cluster(10, [2.0, 0.0, 0.0], 1.0),  # farther — listed first to test sort, not insertion order
    cluster(11, [1.0, 0.0, 0.0], 1.0),  # closer — greedy nearest-first should pick this
]
r = match_displacements(added, removed)
check("exactly 1 event", len(r["events"]) == 1, f"got {len(r['events'])}")
if r["events"]:
    ev = r["events"][0]
    check("matched to closer cluster (toClusterId == 11)", ev["toClusterId"] == 11,
          f"got toClusterId={ev['toClusterId']}")
    check("displacementM ~= 1.0 (not 2.0)", approx(ev["displacementM"], 1.0, tol=1e-3),
          f"got {ev['displacementM']}")
check("1 unmatched added (the farther cluster, clusterId 10)",
      r["stats"]["unmatchedAdded"] == 1, f"got {r['stats']['unmatchedAdded']}")
check("newConstructionM3 ~= 1.0 (farther cluster is unmatched)",
      approx(r["newConstructionM3"], 1.0), f"got {r['newConstructionM3']}")

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total = _passed + _failed
print()
print(f"Results: {_passed}/{total} passed", end="")
if _failed:
    print(f", {_failed} FAILED")
    sys.exit(1)
else:
    print(" — all green")
    sys.exit(0)
