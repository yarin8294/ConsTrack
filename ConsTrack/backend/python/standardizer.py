#!/usr/bin/env python3
"""
standardizer.py  –  Ingestion layer for the ConsTrack pipeline.

Runs immediately on upload. Converts any supported format (LAS/LAZ/PLY/E57)
into a clean, full-resolution binary PLY by applying Statistical Outlier
Removal. The output is the canonical input for all downstream stages
(preprocessor.py, change_detector.py).

No downsampling is applied — full resolution is preserved so volumetric
calculations in later stages are not affected by voxel quantisation error.

CLI:
    python standardizer.py \
        --input  /path/raw_scan.las \
        --output /path/scan_clean.ply \
        [--sor_k   20]    SOR neighbour count   (default 20)
        [--sor_std  2.0]  SOR std-deviation ratio (default 2.0)

Stdout  → JSON: { cleanedPlyPath, originalPointCount, cleanedPointCount, elapsedS }
Stderr  → human-readable progress log
"""

import argparse
import json
import logging
import os
import sys
import time

import numpy as np

logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# Reuse the battle-tested multi-format loader (handles LAS/LAZ/PLY/E57 + missing extension)
sys.path.insert(0, os.path.dirname(__file__))
from volume_diff import _load_point_cloud  # noqa: E402


def remove_statistical_outliers(pcd, nb_neighbors: int, std_ratio: float):
    """
    Remove noise points using Statistical Outlier Removal.

    For every point p_i, compute the mean distance μ_i to its k nearest
    neighbours.  Points where μ_i > (μ_global + std_ratio × σ_global) are
    discarded.

    nb_neighbors  Controls local density estimation stability.
                  20 is reliable for most indoor/outdoor construction scans;
                  raise to 30–50 for very sparse or wide-area outdoor scans.

    std_ratio     Controls aggressiveness.
                  2.0 removes ~5% of a Gaussian noise distribution.
                  Lower (1.5) for heavily contaminated scans;
                  higher (2.5) to preserve thin elements like rebar or conduit.
    """
    n_before = len(pcd.points)
    cleaned, _ = pcd.remove_statistical_outlier(
        nb_neighbors=nb_neighbors,
        std_ratio=std_ratio,
    )
    n_after = len(cleaned.points)
    removed = n_before - n_after
    log.info(
        "SOR: %s → %s pts  (%s removed, %.1f%%)",
        f"{n_before:,}", f"{n_after:,}", f"{removed:,}",
        100.0 * removed / max(n_before, 1),
    )
    return cleaned


def standardize(input_path: str, output_path: str, sor_k: int, sor_std: float) -> dict:
    import open3d as o3d

    t_start = time.time()

    # Load — handles LAS/LAZ/PLY/E57 and files with missing extensions
    log.info("Loading: %s", input_path)
    pcd = _load_point_cloud(input_path)
    original_count = len(pcd.points)
    log.info("Loaded %s pts", f"{original_count:,}")

    # Denoise — full resolution preserved, no downsampling
    pcd = remove_statistical_outliers(pcd, sor_k, sor_std)
    cleaned_count = len(pcd.points)

    # Save as compressed binary PLY
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    o3d.io.write_point_cloud(output_path, pcd, write_ascii=False, compressed=True)
    log.info("Saved cleaned PLY → %s", output_path)

    return {
        "cleanedPlyPath":     os.path.abspath(output_path),
        "originalPointCount": original_count,
        "cleanedPointCount":  cleaned_count,
        "elapsedS":           round(time.time() - t_start, 2),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Standardize a raw point cloud scan to a clean PLY.")
    ap.add_argument("--input",   required=True,              help="Path to raw input scan (LAS/LAZ/PLY/E57)")
    ap.add_argument("--output",  required=True,              help="Path to write the cleaned .ply")
    ap.add_argument("--sor_k",   type=int,   default=20,     help="SOR neighbour count (default 20)")
    ap.add_argument("--sor_std", type=float, default=2.0,    help="SOR std-deviation ratio (default 2.0)")
    args = ap.parse_args()

    try:
        result = standardize(args.input, args.output, args.sor_k, args.sor_std)
        print(json.dumps(result))
        return 0
    except Exception as exc:
        log.exception("Standardization failed: %s", exc)
        print(json.dumps({"error": str(exc)}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
