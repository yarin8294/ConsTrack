#!/usr/bin/env python3
"""
Takes two point cloud scans (T1 = reference/early, T2 = later), denoises
both with Statistical Outlier Removal, then aligns T2 into T1's coordinate
frame via FPFH-RANSAC global registration followed by Point-to-Plane ICP
refinement.  The aligned T2 cloud is written to disk for the next stage
(change_detector.py).

CLI interface (mirrors volume_diff.py — called by python.ts via spawn):
    python preprocessor.py \
        --t1    /path/scan_t1.las \
        --t2    /path/scan_t2.las \
        --out_t2 /path/scan_t2_aligned.ply \
        [--voxel 0.05]      voxel size in metres (default 5 cm)
        [--sor_k 20]        SOR neighbour count
        [--sor_std 2.0]     SOR standard-deviation ratio
        [--icp_dist 0.10]   ICP max correspondence distance in metres

Stdout  → single JSON object with alignment metrics (read by Node.js).
Stderr  → human-readable progress log (ignored by Node.js).
"""

import argparse
import json
import logging
import os
import sys
import time

import numpy as np

#All progress/warnings go to stderr so stdout stays clean JSON
logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

#Reuse multi-format loader from volume_diff.py
sys.path.insert(0, os.path.dirname(__file__))
from volume_diff import _load_point_cloud


#Statistical Outlier Removal (SOR)
def remove_statistical_outliers(pcd, nb_neighbors: int = 20, std_ratio: float = 2.0):
    """
    Denoise a point cloud using Statistical Outlier Removal.

    Algorithm
    ---------
    For every point p_i, compute the mean distance μ_i to its k nearest
    neighbours.  Across the whole cloud, build a global distribution of all
    μ_i values (mean = μ_global, std = σ_global).  Any point where:

        μ_i  >  μ_global + std_ratio × σ_global

    is classified as a statistical outlier and discarded.

    Parameter guidance
    ------------------
    nb_neighbors = 20     Enough for a stable local-density estimate.
                          Raise to 30–50 for sparse outdoor scans.
    std_ratio    = 2.0    Removes ~5 % of a pure-Gaussian noise distribution.
                          Lower → more aggressive (1.5 for very noisy data).
                          Higher → more conservative (2.5 to preserve thin rebar).
    """
    import open3d as o3d  # noqa: F401 — imported for type check, used by pcd

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


#Voxel downsampling  (registration only — full-res cloud is kept)

def voxel_downsample(pcd, voxel_size: float):
    """
    Replace every occupied voxel cell with the centroid of its contained points.

    This lightweight copy is fed into RANSAC and ICP so those algorithms run
    in seconds rather than minutes.  The full-resolution cleaned cloud is kept
    and transformed at the end so volumetric calculations remain accurate.

    5 cm voxels (default) reduce a 50 M-point interior scan by ~90 % while
    retaining structural detail at the scale relevant to construction progress
    (wall faces, slab edges, column outlines, window openings).
    """
    down = pcd.voxel_down_sample(voxel_size)
    log.info(
        "Downsample (%.0f cm voxel): %s → %s pts",
        voxel_size * 100, f"{len(pcd.points):,}", f"{len(down.points):,}",
    )
    return down


#Normal estimation  (prerequisite for FPFH and Point-to-Plane ICP)

def estimate_normals(pcd, voxel_size: float):
    """
    Fit a tangent plane to each point's neighbourhood and store the unit normal.

    Search radius = 2 × voxel_size.

    max_nn = 30 caps neighbourhood size so dense patches (e.g. freshly poured
    concrete close to the scanner) don't cause O(N²) runtime.

    Normal orientation
    ------------------
    Normals have an inherent sign ambiguity (inward vs outward).  We orient
    them consistently by flipping each normal to point toward the coordinate
    origin — a reasonable approximation for a scanner placed near the centre
    of a room or site.  Consistent orientation is required by Point-to-Plane
    ICP; inconsistent normals cause divergence.
    """
    import open3d as o3d

    radius = voxel_size * 2.0
    pcd.estimate_normals(
        o3d.geometry.KDTreeSearchParamHybrid(radius=radius, max_nn=30)
    )
    pcd.orient_normals_towards_camera_location(np.array([0.0, 0.0, 0.0]))


#FPFH feature extraction
def compute_fpfh(pcd, voxel_size: float):
    """
    Compute Fast Point Feature Histograms (FPFH) — a 33-dimensional descriptor.

    What FPFH encodes
    -----------------
    For each point p and each of its neighbours q, FPFH encodes the triple:
        (α, φ, θ)  — three angles between the pair of normals and the line pq.
    These are binned into a 33-element histogram.  Because the encoding is
    based on relative geometry (not absolute position), two FPFH descriptors
    computed at the same physical location from different scanner positions
    will be similar — enabling feature matching without any initial pose.

    Search radius = 5 × voxel_size
    --------------------------------
    The descriptor must see enough geometric context to be discriminative:
      • Too small  →  flat-wall descriptors all look identical (degenerate).
      • Too large  →  fine detail blurred; two different corners look the same.

    max_nn = 100 is sufficient for the weighted FPFH approximation — beyond
    100 neighbours the descriptor stabilises and runtime cost grows linearly.
    """
    import open3d as o3d

    radius = voxel_size * 5.0
    return o3d.pipelines.registration.compute_fpfh_feature(
        pcd,
        o3d.geometry.KDTreeSearchParamHybrid(radius=radius, max_nn=100),
    )



#RANSAC global registration 

def global_registration_ransac(src_down, tgt_down, src_fpfh, tgt_fpfh, voxel_size: float):
    """
    Find a coarse rigid transformation T mapping src into tgt using RANSAC.

    No initial pose estimate is required — this handles the case where two
    scans were taken from completely different scanner positions.

    RANSAC loop (per iteration)
    ---------------------------
    1. Sample 3 point pairs (src_i, tgt_j) whose FPFH descriptors are mutual
       nearest neighbours.
    2. Compute the unique rigid transform T that maps the 3 src points onto
       the 3 tgt points (closed-form SVD solution).
    3. Apply T and count "inliers": source points where
           ||T · src_k  −  nearest_tgt_k||  <  distance_threshold
    4. Store T if it has more inliers than the current best.
    5. Repeat until the statistical confidence target is reached.

    Correspondence checkers (cheap early-exit filters applied before step 3)
    -------------------------------------------------------------------------
    EdgeLength(0.9)   Rigid-body constraint: the distance between any two
                      matched source points must equal the distance between
                      their target counterparts within a 10 % tolerance.
                      Eliminates ~80 % of random samples before SVD.

    Distance(thresh)  Reject pairs further apart than the inlier threshold
                      even before counting all inliers.

    mutual_filter=True  Only keep a match (i, j) if j is also the nearest
                        FPFH neighbour of i in the reverse direction.  Reduces
                        false matches on repetitive geometry (parallel walls,
                        uniform floor slabs) at the cost of fewer candidates.

    Convergence
    -----------
    confidence=0.999  Stop once the probability of having found the global
                      optimum exceeds 99.9 % (derived from inlier ratio).
    max_iteration=4_000_000  Hard cap — reached only when overlap is < 5 %.
    """
    import open3d as o3d

    # Inlier distance = 1.5 × voxel_size (loose enough for coarse alignment)
    thresh = voxel_size * 1.5

    t0 = time.time()
    result = o3d.pipelines.registration.registration_ransac_based_on_feature_matching(
        src_down, tgt_down,
        src_fpfh, tgt_fpfh,
        mutual_filter=True,
        max_correspondence_distance=thresh,
        estimation_method=o3d.pipelines.registration.TransformationEstimationPointToPoint(False),
        ransac_n=3,
        checkers=[
            o3d.pipelines.registration.CorrespondenceCheckerBasedOnEdgeLength(0.9),
            o3d.pipelines.registration.CorrespondenceCheckerBasedOnDistance(thresh),
        ],
        criteria=o3d.pipelines.registration.RANSACConvergenceCriteria(
            max_iteration=4_000_000,
            confidence=0.999,
        ),
    )

    log.info(
        "RANSAC: fitness=%.4f  RMSE=%.2f cm  (%.1f s)",
        result.fitness, result.inlier_rmse * 100, time.time() - t0,
    )

    if result.fitness < 0.30:
        log.warning(
            "RANSAC fitness %.3f < 0.30. Poor feature overlap — verify both "
            "scans cover the same area, or reduce --voxel for a denser feature set.",
            result.fitness,
        )

    return result.transformation


#Point-to-Plane ICP refinement

def refine_icp(src, tgt, init_transform, voxel_size: float, max_distance: float, max_iter: int):
    """
    Tighten the RANSAC coarse alignment with Point-to-Plane ICP.

    Point-to-Point ICP (naïve) minimises:
        Σ_i  ||T · p_i  −  q_i||²

    Point-to-Plane ICP minimises:
        Σ_i  ( (T · p_i  −  q_i) · n̂_i )²

    where n̂_i is the surface normal at the nearest target point q_i.

    Why Point-to-Plane is better here
    ----------------------------------
    By projecting the residual onto the tangent plane, source points are free
    to slide *along* a surface during each iteration.  This breaks the common
    local-minima trap where Point-to-Point stalls because aligned wall points
    are locked perpendicular to the wall instead of sliding to their true
    correspondences.  On flat construction surfaces (concrete slabs, formwork,
    plastered walls) convergence is typically 3–5× faster and achieves lower
    final RMSE.

    Two-stage strategy rationale
    ----------------------------
    RANSAC → coarse pose  (no local-minima risk, tolerant to large misalignment)
    ICP    → fine pose    (fast, high accuracy once within ~10 cm of solution)

    Starting ICP from the RANSAC result — rather than from identity — is what
    makes < 2 cm RMSE achievable.  ICP from a cold start on construction data
    almost always diverges.

    Convergence criteria
    --------------------
    relative_fitness / relative_rmse = 1e-6  Stop when improvement per
    iteration is negligible (the pose has converged to a stable solution).
    max_iteration = 2000  Safety cap against degenerate inputs.
    """
    import open3d as o3d

    # Build a copy of the target with normals — required for Point-to-Plane
    tgt_with_normals = o3d.geometry.PointCloud(tgt)
    tgt_with_normals.estimate_normals(
        o3d.geometry.KDTreeSearchParamHybrid(radius=voxel_size * 2.0, max_nn=30)
    )
    tgt_with_normals.orient_normals_towards_camera_location(np.array([0.0, 0.0, 0.0]))

    t0 = time.time()
    result = o3d.pipelines.registration.registration_icp(
        src, tgt_with_normals,
        max_correspondence_distance=max_distance,
        init=init_transform,
        estimation_method=o3d.pipelines.registration.TransformationEstimationPointToPlane(),
        criteria=o3d.pipelines.registration.ICPConvergenceCriteria(
            relative_fitness=1e-6,
            relative_rmse=1e-6,
            max_iteration=max_iter,
        ),
    )

    log.info(
        "ICP: fitness=%.4f  RMSE=%.2f cm  (%.1f s)",
        result.fitness, result.inlier_rmse * 100, time.time() - t0,
    )

    if result.inlier_rmse > 0.02:
        # ISO 4463-1 defines as-built survey accuracy at 2 cm.
        log.warning(
            "ICP RMSE %.2f cm exceeds the 2 cm accuracy target. "
            "Possible causes: insufficient scan overlap (< 30%%), moving objects "
            "between scans, or no common reference targets.",
            result.inlier_rmse * 100,
        )

    return result


# PIPELINE ORCHESTRATOR

def preprocess(
    path_t1: str,
    path_t2: str,
    out_t2: str,
    voxel_size: float = 0.05,
    sor_k: int = 20,
    sor_std: float = 2.0,
    icp_dist: float = 0.10,
    icp_max_iter: int = 2000,
    out_t1: str | None = None,
) -> dict:
    """
    Run the full pre-processing pipeline and return alignment metrics as a dict.

    Output files
    ------------
    out_t2 (.ply)  Full-resolution, SOR-cleaned, ICP-aligned T2 cloud.
                   Written in binary PLY format for fast reload by
                   change_detector.py in the next pipeline stage.

    Returned dict (serialised to JSON by main())
    --------------------------------------------
    fitness           Fraction of source points with a close target match
                      after ICP.  1.0 = perfect overlap.
    rmseM / rmseCm    Root-mean-square alignment error in metres / centimetres.
    alignmentConfidence  HIGH / MEDIUM / LOW label for the report UI.
    transformMatrix   4×4 rigid transform as a nested list (T2 → T1 frame).
    alignedT2Path     Absolute path to the written aligned T2 cloud.
    elapsedS          Wall-clock seconds for the full pipeline.
    """
    import open3d as o3d

    t_start = time.time()
    log.info("=== Pre-processing pipeline START ===")

    #Load 
    log.info("Loading T1: %s", path_t1)
    pcd_t1 = _load_point_cloud(path_t1)

    log.info("Loading T2: %s", path_t2)
    pcd_t2 = _load_point_cloud(path_t2)

    #Denoise both clouds
    pcd_t1 = remove_statistical_outliers(pcd_t1, sor_k, sor_std)
    pcd_t2 = remove_statistical_outliers(pcd_t2, sor_k, sor_std)

    #Lightweight copies for registration
    # Full-resolution cleaned clouds are retained for accurate volume diff later.
    t1_down = voxel_downsample(pcd_t1, voxel_size)
    t2_down = voxel_downsample(pcd_t2, voxel_size)

    #Normals and FPFH descriptors
    log.info("Estimating normals and FPFH features...")
    estimate_normals(t1_down, voxel_size)
    estimate_normals(t2_down, voxel_size)

    fpfh_t1 = compute_fpfh(t1_down, voxel_size)
    fpfh_t2 = compute_fpfh(t2_down, voxel_size)

    #RANSAC global registration (T2 → T1 frame)
    # T1 is the FIXED reference; T2 (source) will be transformed onto it.
    log.info("RANSAC global registration (T2 → T1 frame)...")
    coarse_T = global_registration_ransac(t2_down, t1_down, fpfh_t2, fpfh_t1, voxel_size)

    #ICP fine refinement
    log.info("ICP refinement...")
    icp_result = refine_icp(
        t2_down, t1_down,
        init_transform=coarse_T,
        voxel_size=voxel_size,
        max_distance=icp_dist,
        max_iter=icp_max_iter,
    )
    fine_T = icp_result.transformation   # 4×4 numpy array

    # Apply final transform to full-resolution T2 cloud
    # Transforming the full-res cloud (not the downsampled one) ensures that
    # the volume difference computed by change_detector.py is not affected by
    # voxel quantisation error.
    pcd_t2_aligned = o3d.geometry.PointCloud(pcd_t2)
    pcd_t2_aligned.transform(fine_T)

    #Write aligned T2 to disk
    os.makedirs(os.path.dirname(os.path.abspath(out_t2)), exist_ok=True)
    o3d.io.write_point_cloud(out_t2, pcd_t2_aligned, write_ascii=False, compressed=True)
    log.info("Aligned T2 written → %s", out_t2)

    # Write cleaned T1 to disk (needed as PLY input for change_detector.py)
    cleaned_t1_path: str | None = None
    if out_t1:
        os.makedirs(os.path.dirname(os.path.abspath(out_t1)), exist_ok=True)
        o3d.io.write_point_cloud(out_t1, pcd_t1, write_ascii=False, compressed=True)
        cleaned_t1_path = os.path.abspath(out_t1)
        log.info("Cleaned T1 written → %s", cleaned_t1_path)

    elapsed = time.time() - t_start
    log.info("=== Pre-processing pipeline DONE (%.1f s) ===", elapsed)

    result = {
        "fitness": float(icp_result.fitness),
        "rmseM": float(icp_result.inlier_rmse),
        "rmseCm": round(float(icp_result.inlier_rmse) * 100, 3),
        "alignmentConfidence": _confidence_label(icp_result.fitness, icp_result.inlier_rmse),
        "transformMatrix": fine_T.tolist(),
        "alignedT2Path": os.path.abspath(out_t2),
        "elapsedS": round(elapsed, 2),
    }
    if cleaned_t1_path:
        result["cleanedT1Path"] = cleaned_t1_path
    return result


def _confidence_label(fitness: float, rmse_m: float) -> str:
    """
    Map ICP metrics to the three-tier label used in the report UI and RunDoc.

    Thresholds
    ----------
    HIGH    fitness ≥ 0.90  AND  RMSE ≤ 2 cm  (ISO 4463-1 as-built accuracy)
    MEDIUM  fitness ≥ 0.70  AND  RMSE ≤ 5 cm  (acceptable for progress tracking)
    LOW     anything else   (flag for manual review before trusting volumes)
    """
    if fitness >= 0.90 and rmse_m <= 0.02:
        return "HIGH"
    if fitness >= 0.70 and rmse_m <= 0.05:
        return "MEDIUM"
    return "LOW"



# CLI — called by python.ts via child_process.spawn

def main() -> int:
    ap = argparse.ArgumentParser(
        description="Phase 1: denoise and register two point cloud scans."
    )
    ap.add_argument("--t1",       required=True,              help="Path to T1 (reference) scan")
    ap.add_argument("--t2",       required=True,              help="Path to T2 (later) scan")
    ap.add_argument("--out_t2",   required=True,              help="Output path for aligned T2 .ply")
    ap.add_argument("--out_t1",   required=False, default=None, help="Output path for SOR-cleaned T1 .ply (needed by change_detector)")
    ap.add_argument("--voxel",    type=float, default=0.05,   help="Voxel size in metres (default 0.05)")
    ap.add_argument("--sor_k",    type=int,   default=20,     help="SOR neighbour count (default 20)")
    ap.add_argument("--sor_std",  type=float, default=2.0,    help="SOR std-deviation ratio (default 2.0)")
    ap.add_argument("--icp_dist", type=float, default=0.10,   help="ICP max correspondence distance in metres (default 0.10)")
    args = ap.parse_args()

    try:
        result = preprocess(
            path_t1=args.t1,
            path_t2=args.t2,
            out_t2=args.out_t2,
            out_t1=args.out_t1,
            voxel_size=args.voxel,
            sor_k=args.sor_k,
            sor_std=args.sor_std,
            icp_dist=args.icp_dist,
        )
        print(json.dumps(result))
        return 0

    except Exception as exc:
        log.exception("Pipeline failed: %s", exc)
        print(json.dumps({"error": str(exc)}))
        return 2


def _hard_exit(code: int) -> None:
    """
    Flush the JSON channel, then terminate immediately via os._exit().

    Open3D / OpenMP occasionally stall at interpreter shutdown (background
    threads not joined cleanly). os._exit() skips those atexit handlers so the
    process dies the instant the aligned cloud is written and the JSON emitted —
    which makes the Node parent's child 'exit' event fire promptly instead of
    waiting on a slow teardown.
    """
    try:
        sys.stdout.flush()
    except Exception:
        pass
    os._exit(code)


if __name__ == "__main__":
    _hard_exit(main())
