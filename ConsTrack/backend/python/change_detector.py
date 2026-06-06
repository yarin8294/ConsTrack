#!/usr/bin/env python3
"""
Identifies newly constructed elements by comparing an ICP-aligned T2 scan
against the T1 baseline, clusters the isolated new points with DBSCAN,
computes per-cluster volumes, and exports a coloured PLY file for visual
verification in CloudCompare.

CLI (called by python.ts via child_process.spawn):
    python change_detector.py \
        --t1          /path/scan1.ply               baseline (reference)
        --t2_aligned  /path/scan2_aligned.ply        Phase 1 output
        --out_new     /path/scan2_new_elements.ply   new geometry export
        [--dist_thresh 0.05]   distance threshold in metres (default 5 cm)
        [--voxel       0.05]   voxel size for volume computation (default 5 cm)
        [--eps         0.15]   DBSCAN neighbourhood radius in metres
        [--min_pts     20]     DBSCAN minimum cluster size

Stdout  → single JSON object (read by Node.js).
Stderr  → human-readable progress log (ignored by Node.js).
"""

import argparse
import colorsys
import json
import logging
import os
import sys
import time

import numpy as np
import open3d as o3d
from scipy.spatial import cKDTree
from sklearn.cluster import DBSCAN

#All progress / warnings to stderr; stdout is reserved for JSON
logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

#Load point clouds
def load_ply(path: str) -> o3d.geometry.PointCloud:
    """
    Load a PLY file.

    Both inputs to this script are guaranteed to be PLY because:
      - T1 baseline may have been loaded from LAS/E57 in Phase 1 and re-saved
        as PLY after SOR cleaning.
      - T2 aligned is always written as binary PLY by preprocessor.py.

    We validate the point count so a silently empty PLY (Open3D returns an
    empty cloud rather than raising on corrupt files) fails loudly here.
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"File not found: {path}")
    pcd = o3d.io.read_point_cloud(path)
    if len(pcd.points) == 0:
        raise ValueError(f"Empty point cloud — corrupt or wrong path: {path}")
    log.info("Loaded %s: %s pts", os.path.basename(path), f"{len(pcd.points):,}")
    return pcd


#KD-Tree nearest-neighbour distance query

def compute_nn_distances(pts_t2: np.ndarray, pts_t1: np.ndarray) -> np.ndarray:
    """
    For every point in T2, compute its Euclidean distance to the closest T1 point.

    Geometric meaning
    -----------------
    After Phase 1 alignment, T1 and T2 share the same coordinate frame.
    A T2 point with a small nearest-T1 distance sits on existing geometry —
    the same wall or slab was there at both scan times.
    A T2 point with a LARGE nearest-T1 distance sits on geometry that did not
    exist during T1 — it is newly constructed material.

    This single scalar distance per point is the core discriminator for the
    entire change-detection algorithm.

    Implementation: scipy cKDTree
    ------------------------------
    We use scipy's cKDTree (a C-backed implementation) over Open3D's built-in
    KNN search because:
      • cKDTree.query(workers=-1) parallelises across all CPU cores automatically,
        which matters for the 5–50 M point clouds typical in construction.
      • It returns float64 distances directly without an Open3D wrapper overhead.
      • The KD-Tree build is O(N log N) and each query is O(log N), giving total
        complexity O((N + M) log N) for N = |T1| and M = |T2|.

    Memory note: for a 20 M point T1 cloud the KD-Tree uses ~2.5 GB RAM.
    If memory is constrained, partition T1 spatially and query sub-trees.
    """
    log.info("Building KD-Tree from T1 (%s pts)...", f"{len(pts_t1):,}")
    t0 = time.time()
    tree = cKDTree(pts_t1)
    log.info("KD-Tree built in %.2f s", time.time() - t0)

    log.info("Querying %s T2 points (all CPU cores)...", f"{len(pts_t2):,}")
    t0 = time.time()
    # k=1 → nearest neighbour only; workers=-1 → use all available cores
    distances, _ = tree.query(pts_t2, k=1, workers=-1)
    log.info("Query done in %.2f s", time.time() - t0)

    return distances.astype(np.float32)


#Distance threshold filtering
def filter_new_points(
    pcd_t2: o3d.geometry.PointCloud,
    distances: np.ndarray,
    dist_thresh: float,
) -> tuple[o3d.geometry.PointCloud, np.ndarray]:
    """
    Retain only T2 points whose nearest T1 neighbour is beyond dist_thresh.

    Choosing the threshold — the gap between noise floor and signal
    --------------------------------------------------------------
    The threshold must sit comfortably above the registration noise floor and
    comfortably below the minimum structural feature we care about detecting.

    Registration noise floor
        Phase 1 ICP targets < 2 cm RMSE; in practice the aligned scans achieve
        < 0.5 cm.  Scanner ranging noise for a mid-range terrestrial scanner is
        typically 2–5 mm at 10 m range.  Combined, existing surfaces in T2 will
        appear 0–10 mm from their T1 correspondents.

    Minimum detectable element
        The thinnest structural element commonly added between scans is:
          • A brick course: 75 mm thick
          • A plasterboard partition: 12.5 mm facing + frame
          • A steel stud: 50 mm
        However, we observe SURFACE points of these elements.  A 12 mm board
        presents a face parallel to the laser — those face points are >> 12 mm
        from the baseline (they are new points on a new plane, not edge points).

    Default: 5 cm (0.05 m)
    -----------------------
    5 cm = 5–10× the combined noise floor and 0.4–4× the thinnest elements.
    This gives a comfortable safety margin on both ends:
      • False positives (noise classified as new): near-zero at 5 cm.
      • False negatives (thin elements missed): minimal, thin elements
        present face points several cm from the baseline.

    Tuning guide
    ------------
    If ICP RMSE from Phase 1 is stored, an adaptive formula is:
        dist_thresh = max(0.05, 5 × rmse_m)
    Increase to 8–10 cm for scans with more residual misalignment.
    Decrease to 2–3 cm only when ICP RMSE < 3 mm AND structures are thin.
    """
    pts_all = np.asarray(pcd_t2.points)
    new_mask = distances > dist_thresh

    n_new = int(new_mask.sum())
    n_total = len(distances)
    log.info(
        "Threshold %.0f cm: %s / %s pts → new construction (%.1f%%)",
        dist_thresh * 100,
        f"{n_new:,}", f"{n_total:,}",
        100.0 * n_new / max(n_total, 1),
    )

    pcd_new = o3d.geometry.PointCloud()
    pcd_new.points = o3d.utility.Vector3dVector(pts_all[new_mask])

    # Preserve scanner colours when present — aids visual verification
    if pcd_t2.has_colors():
        cols_all = np.asarray(pcd_t2.colors)
        pcd_new.colors = o3d.utility.Vector3dVector(cols_all[new_mask])

    return pcd_new, new_mask



#DBSCAN spatial clustering
def cluster_dbscan(pts_new: np.ndarray, eps: float, min_samples: int) -> np.ndarray:
    """
    Group isolated "new" points into spatially distinct structural elements.

    Why DBSCAN and not K-Means or hierarchical clustering?
    -------------------------------------------------------
    K-Means requires k (number of clusters) as input.  Between two construction
    scans we may have 0 new elements (no work done) or 50+ (a full floor poured).
    We cannot know k in advance — DBSCAN discovers it from the data.

    Hierarchical (agglomerative) clustering would work but is O(N²) in memory
    and time, making it infeasible for the 100 k–5 M "new" points typical here.

    DBSCAN's two key properties make it ideal for construction scenes:

    1.  Shape-agnostic clustering
        An L-shaped wall, a curved staircase, or a branching pipe run are each
        one connected physical element.  DBSCAN follows density connectivity —
        it correctly joins any shape as long as consecutive points are within `eps`
        of each other.  K-Means would split an L-shaped wall into 2+ spherical
        blobs based on distance to centroids.

    2.  Native noise rejection
        Any point not reachable from a core point gets label = -1 (noise).
        This naturally discards:
          • Isolated residual misalignment artefacts
          • Moving objects (a worker who walked during the scan)
          • Specular reflection outliers that survived SOR
        No post-processing step needed.

    DBSCAN algorithm detail
    -----------------------
    For each unvisited point p:
      1.  Find Nε(p) = all points within Euclidean radius eps.
      2.  If |Nε(p)| ≥ min_samples: p is a "core point".
            a. Assign p to a new cluster C.
            b. For each q ∈ Nε(p), if q unvisited: recurse (density-reachability).
      3.  Else: tentatively mark p as noise (may be revised if reachable from a
          core point of another iteration).
    Complexity: O(N log N) with the ball_tree index that sklearn builds internally.

    Parameter: eps = 0.15 m (15 cm)
    --------------------------------
    eps is the neighbourhood radius — the maximum gap between two consecutive
    points that are still considered "connected" within a single element.

    The gap between consecutive points ON THE SAME element is bounded by:
      • Raw scan spacing: typically 5–20 mm at 10 m scanner range
      • After 5 cm voxel downsampling: max ~7 cm (diagonal of a 5 cm voxel)

    The gap between the CLOSEST POINTS of two SEPARATE elements is bounded below
    by physical construction tolerances:
      • Wall-to-column gap:         > 5 cm (expansion joint minimum)
      • Adjacent pipe runs:         > 3 cm (insulation + clearance)
      • Slab soffit to wall top:    > 10 cm

    eps = 15 cm is therefore a safe choice:
      • Large enough to bridge within-element gaps (max 7 cm after voxel filter)
      • Small enough to respect the minimum between-element gaps (> 3 cm, with
        eps = 15 cm occasionally merging very close parallel pipes — acceptable)

    Rule of thumb: eps ≈ 3 × voxel_size for voxel-filtered clouds.
    For raw unfiltered point clouds with varying density, use 20–30 cm.

    Parameter: min_samples = 20
    ----------------------------
    min_samples is the minimum number of points within radius eps that a core
    point needs.  It controls the minimum cluster density (not size).

    Physical interpretation at 5 cm voxel spacing:
      • A 0.5 m × 0.5 m wall patch:   ~100 surface points — well above threshold
      • A 10 cm scaffolding pole, 2 m tall:  ~40 points — above threshold
      • Random noise artefact:           1–5 isolated points — below threshold
      • Ghost from reflective surface:   2–8 isolated points — below threshold

    min_samples = 20 eliminates noise while preserving even small structural
    elements.  Raise to 50 if many false-positive mini-clusters appear.
    Lower to 10 only if known thin elements (cables, conduit) are being missed.

    Performance note
    ----------------
    For > 500 k "new" points, DBSCAN with ball_tree may take several minutes.
    A practical optimisation (not implemented here) is to voxel-downsample the
    new points to ~3 cm before clustering, then map labels back by proximity.
    """
    log.info(
        "DBSCAN: eps=%.0f cm, min_samples=%d on %s pts",
        eps * 100, min_samples, f"{len(pts_new):,}",
    )
    if len(pts_new) > 500_000:
        log.warning(
            "Large point set (%s pts). DBSCAN may take several minutes. "
            "Consider reducing --eps or pre-voxelising with a smaller voxel size.",
            f"{len(pts_new):,}",
        )

    t0 = time.time()
    db = DBSCAN(
        eps=eps,
        min_samples=min_samples,
        algorithm="ball_tree",   # O(N log N) for 3-D Euclidean; faster than 'auto' here
        metric="euclidean",
        n_jobs=-1,               # parallelise across all CPU cores
    )
    labels = db.fit_predict(pts_new)

    n_clusters = int(labels.max()) + 1 if labels.max() >= 0 else 0
    n_noise = int((labels == -1).sum())
    log.info(
        "DBSCAN done in %.1f s → %d clusters, %s noise pts",
        time.time() - t0, n_clusters, f"{n_noise:,}",
    )
    return labels



#Per-cluster volume computation
def compute_cluster_volumes(
    pts_new: np.ndarray,
    labels: np.ndarray,
    voxel_size: float,
) -> list[dict]:
    """
    Compute geometry and volume for every valid cluster (label ≠ -1).

    Two complementary volume estimates are produced:

    1)Voxel volume  (primary — used for progress % in the Node.js run model)
    ────────────────────────────────────────────────────────────────────────
    Partition the cluster's bounding box into a regular grid of voxels
    (edge = voxel_size).  Count only cells that contain ≥ 1 point.
    Volume = occupied_voxels × voxel_size³.

    This is a SURFACE MATERIAL VOLUME — it counts only voxels touched by
    actual laser returns.  For a concrete wall scanned from one side:
        result ≈ wall_area × point_cloud_depth_uncertainty (~voxel_size)
    NOT wall_area × wall_thickness.

    Why voxel volume for progress tracking?
    The project schedule usually expresses progress as material placed (m³
    poured, m² formwork set), not bounding-box volume.  Voxel volume closely
    correlates with material quantity and is consistent between runs regardless
    of element orientation.

    2) OBB volume  (secondary — structural element size classification)
    ─────────────────────────────────────────────────────────────────
    Open3D's Oriented Bounding Box (OBB) is the minimum-volume axis-free box
    enclosing all cluster points.  It is computed via PCA on the point positions:
        1. Compute covariance matrix of cluster points.
        2. Extract eigenvectors (principal axes).
        3. Project points onto the three axes; extents = (max − min) per axis.
        4. Volume = extent₁ × extent₂ × extent₃.

    For a diagonal wall segment, the OBB aligns with the wall and produces
    roughly (length × height × thickness), whereas an AABB would produce a
    much larger box due to the diagonal orientation.

    When to prefer OBB: classifying the TYPE of element added (a slab vs. a
    wall vs. a column) — extent ratios reveal geometry:
        slab:    large × large × small  (~5:5:0.2)
        wall:    large × medium × small  (~5:3:0.2)
        column:  small × small × large   (~0.4:0.4:3)

    OBB overestimates when only one face of a solid element is scanned
    (typical for terrestrial LiDAR), so it should not be used for material
    quantity calculations.
    """
    unique_labels = sorted([lbl for lbl in np.unique(labels) if lbl != -1])
    clusters = []

    for label in unique_labels:
        mask = labels == label
        cluster_pts = pts_new[mask]
        n_pts = int(mask.sum())

        #Voxel volume 
        # Quantise to grid, deduplicate occupied cells, count × cell volume.
        voxel_indices = np.floor(cluster_pts / voxel_size).astype(np.int32)
        n_occupied = len(np.unique(voxel_indices, axis=0))
        voxel_vol_m3 = float(n_occupied * (voxel_size ** 3))

        #OBB volume via Open3D
        cluster_pcd = o3d.geometry.PointCloud()
        cluster_pcd.points = o3d.utility.Vector3dVector(cluster_pts)
        obb = cluster_pcd.get_oriented_bounding_box()
        # obb.extent: 3-vector of full side lengths along each OBB axis
        obb_vol_m3 = float(np.prod(obb.extent))
        obb_extent = [round(float(e), 4) for e in obb.extent]

        #Centroid for map / dashboard pinning
        centroid = cluster_pts.mean(axis=0)

        clusters.append({
            "clusterId":       int(label),
            "pointCount":      n_pts,
            "centroidXYZ":     [round(float(v), 4) for v in centroid],
            "voxelVolumeM3":   round(voxel_vol_m3, 6),
            "obbVolumeM3":     round(obb_vol_m3, 6),
            "obbExtentM":      obb_extent,         # [length, height, thickness] (approx)
        })

    #Descending by voxel volume — largest new element first in the JSON list
    clusters.sort(key=lambda c: c["voxelVolumeM3"], reverse=True)

    log.info(
        "Volume computed for %d clusters. Largest: %.4f m³ voxel / %.4f m³ OBB",
        len(clusters),
        clusters[0]["voxelVolumeM3"] if clusters else 0.0,
        clusters[0]["obbVolumeM3"]   if clusters else 0.0,
    )
    return clusters


#Export coloured PLY for CloudCompare verification
def export_colored_ply(pts_new: np.ndarray, labels: np.ndarray, out_path: str) -> None:
    """
    Write isolated new-construction points with per-cluster colours to PLY.

    Colour scheme
    -------------
    Each cluster gets a visually distinct hue sampled evenly around the HSV
    colour wheel (saturation = 0.85, value = 0.95 for vibrant but readable
    colours).  Clusters are assigned hues in label order (label 0, 1, 2, …),
    so consecutive labels get maximally spaced colours.

    Noise points (label = -1) are rendered in neutral mid-grey (0.5, 0.5, 0.5).
    """
    unique_labels = [lbl for lbl in np.unique(labels) if lbl != -1]
    n_clusters = len(unique_labels)

    # Default: grey for noise points
    colors = np.full((len(pts_new), 3), 0.5, dtype=np.float64)

    if n_clusters > 0:
        # Evenly distribute hues; endpoint=False ensures hue 0 ≠ hue N
        hues = np.linspace(0.0, 1.0, n_clusters, endpoint=False)
        for idx, label in enumerate(unique_labels):
            r, g, b = colorsys.hsv_to_rgb(hues[idx], 0.85, 0.95)
            colors[labels == label] = [r, g, b]

    pcd_out = o3d.geometry.PointCloud()
    pcd_out.points = o3d.utility.Vector3dVector(pts_new)
    pcd_out.colors = o3d.utility.Vector3dVector(colors)

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    # write_ascii=False → binary PLY (smaller, faster to load in CloudCompare)
    o3d.io.write_point_cloud(out_path, pcd_out, write_ascii=False, compressed=True)
    log.info("Coloured new-elements PLY written → %s", out_path)



# PIPELINE ORCHESTRATOR
def detect_changes(
    path_t1: str,
    path_t2_aligned: str,
    out_new: str,
    dist_thresh: float = 0.05,
    voxel_size: float = 0.05,
    eps: float = 0.15,
    min_pts: int = 20,
) -> dict:
    """
    Run the full change-detection pipeline and return metrics as a JSON-ready dict.

    Output files
    ------------
    out_new (.ply)   Per-cluster coloured binary PLY of all new construction
                     points.  Load alongside scan1.ply in CloudCompare to
                     visually validate the algorithm before trusting the volumes.

    Returned dict
    -------------
    totalNewVolumeM3    Sum of voxel volumes across all valid clusters (m³).
                        This is the primary metric fed into the run progress %.
    newElementCount     Number of distinct structural clusters detected.
    noisePointCount     Points classified as DBSCAN noise (label = -1).
                        High values indicate a too-tight threshold or poor alignment.
    clusters            List of per-cluster dicts (sorted largest first):
                          clusterId, pointCount, centroidXYZ,
                          voxelVolumeM3, obbVolumeM3, obbExtentM
    newElementsPath     Absolute path of the written PLY file.
    elapsedS            Wall-clock seconds for the full pipeline.
    """
    t_start = time.time()
    log.info("=== Change detection pipeline START ===")

    #Load
    pcd_t1 = load_ply(path_t1)
    pcd_t2 = load_ply(path_t2_aligned)

    pts_t1 = np.asarray(pcd_t1.points)
    pts_t2 = np.asarray(pcd_t2.points)

    #KD-Tree distance from every T2 point to its nearest T1 neighbour
    distances = compute_nn_distances(pts_t2, pts_t1)

    #Filter: keep only T2 points farther than dist_thresh from T1
    pcd_new, _ = filter_new_points(pcd_t2, distances, dist_thresh)
    pts_new = np.asarray(pcd_new.points)

    if len(pts_new) == 0:
        log.warning(
            "No new points found above %.0f cm threshold. "
            "Verify alignment quality (Phase 1) and that T2 is actually newer than T1.",
            dist_thresh * 100,
        )
        _write_empty_ply(out_new)
        return {
            "totalNewVolumeM3": 0.0,
            "newElementCount":  0,
            "noisePointCount":  0,
            "clusters":         [],
            "newElementsPath":  os.path.abspath(out_new),
            "elapsedS":         round(time.time() - t_start, 2),
        }

    # DBSCAN: group new points into distinct structural elements
    labels = cluster_dbscan(pts_new, eps, min_pts)

    #Volume computation for each valid cluster
    clusters = compute_cluster_volumes(pts_new, labels, voxel_size)

    total_vol = sum(c["voxelVolumeM3"] for c in clusters)
    n_noise = int((labels == -1).sum())

    #Export coloured PLY for visual verification 
    export_colored_ply(pts_new, labels, out_new)

    elapsed = time.time() - t_start
    log.info("=== Change detection DONE (%.1f s) — %.4f m³ across %d elements ===",
             elapsed, total_vol, len(clusters))

    return {
        "totalNewVolumeM3": round(total_vol, 6),
        "newElementCount":  len(clusters),
        "noisePointCount":  n_noise,
        "clusters":         clusters,
        "newElementsPath":  os.path.abspath(out_new),
        "elapsedS":         round(elapsed, 2),
    }


def _write_empty_ply(path: str) -> None:
    """Write a valid but empty PLY so the calling code always gets a file path."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    o3d.io.write_point_cloud(path, o3d.geometry.PointCloud())


# CLI  —  called by python.ts via child_process.spawn
def main() -> int:
    ap = argparse.ArgumentParser(
        description="Phase 2: detect new construction and compute volumes."
    )
    ap.add_argument("--t1",          required=True,              help="Baseline scan (.ply)")
    ap.add_argument("--t2_aligned",  required=True,              help="ICP-aligned later scan (.ply)")
    ap.add_argument("--out_new",     required=True,              help="Output path for new-elements .ply")
    ap.add_argument("--dist_thresh", type=float, default=0.05,   help="New-point distance threshold in metres (default 0.05)")
    ap.add_argument("--voxel",       type=float, default=0.05,   help="Voxel size for volume in metres (default 0.05)")
    ap.add_argument("--eps",         type=float, default=0.15,   help="DBSCAN neighbourhood radius in metres (default 0.15)")
    ap.add_argument("--min_pts",     type=int,   default=20,     help="DBSCAN minimum cluster size (default 20)")
    args = ap.parse_args()

    try:
        result = detect_changes(
            path_t1=args.t1,
            path_t2_aligned=args.t2_aligned,
            out_new=args.out_new,
            dist_thresh=args.dist_thresh,
            voxel_size=args.voxel,
            eps=args.eps,
            min_pts=args.min_pts,
        )
        print(json.dumps(result))
        return 0

    except Exception as exc:
        log.exception("Change detection failed: %s", exc)
        print(json.dumps({"error": str(exc)}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
