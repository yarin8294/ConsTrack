#!/usr/bin/env python3
"""
Performs BIDIRECTIONAL change detection between an ICP-aligned T2 scan and the
T1 baseline: it reports both ADDED geometry (new construction — points in T2
with no nearby T1 neighbour) and REMOVED geometry (demolition / missing scan
data — points in T1 with no nearby T2 neighbour). Each side is independently
DBSCAN-clustered, volume-measured, and exported as a coloured PLY for visual
verification in CloudCompare.

CLI (called by python.ts via child_process.spawn):
    python change_detector.py \
        --t1          /path/scan1.ply               baseline (reference)
        --t2_aligned  /path/scan2_aligned.ply        Phase 1 output
        --out_added   /path/scan2_added.ply          new geometry export
        --out_removed /path/scan2_removed.ply        removed geometry export
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
from scipy.spatial import ConvexHull, cKDTree
from scipy.spatial.qhull import QhullError
from sklearn.cluster import DBSCAN

# Silence Open3D's C++ logger. Its [Open3D WARNING]/[Open3D INFO] lines are
# written to STDOUT, which is reserved here for the single JSON object Node
# parses — an unsuppressed warning (e.g. on an empty write) would corrupt that
# payload and crash JSON.parse on the Node side. Belt-and-braces with the
# brace-extraction parsing in python.ts.
o3d.utility.set_verbosity_level(o3d.utility.VerbosityLevel.Error)

#All progress / warnings to stderr; stdout is reserved for JSON
logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# Delta clouds larger than this are voxel-downsampled before DBSCAN to bound its
# time/memory (it otherwise hangs or OOMs on dense 100k+ point clouds). Tunable.
CLUSTER_DOWNSAMPLE_THRESHOLD = 100_000

# Volume basis used by match_displacements() for ratio gating and event volumeM3.
VOLUME_BASIS = "hull"

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
def filter_distant_points(
    pcd: o3d.geometry.PointCloud,
    distances: np.ndarray,
    dist_thresh: float,
) -> tuple[o3d.geometry.PointCloud, np.ndarray]:
    """
    Retain only points whose nearest neighbour in the OTHER cloud is beyond
    dist_thresh. Direction-agnostic, which is what makes the bidirectional
    engine possible: pass (T2, dist-to-T1) to isolate ADDED geometry, or
    (T1, dist-to-T2) to isolate REMOVED geometry.

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
    pts_all = np.asarray(pcd.points)
    mask = distances > dist_thresh

    n_sel = int(mask.sum())
    n_total = len(distances)
    log.info(
        "Threshold %.0f cm: %s / %s pts beyond nearest neighbour (%.1f%%)",
        dist_thresh * 100,
        f"{n_sel:,}", f"{n_total:,}",
        100.0 * n_sel / max(n_total, 1),
    )

    pcd_sel = o3d.geometry.PointCloud()
    pcd_sel.points = o3d.utility.Vector3dVector(pts_all[mask])

    # Preserve scanner colours when present — aids visual verification
    if pcd.has_colors():
        cols_all = np.asarray(pcd.colors)
        pcd_sel.colors = o3d.utility.Vector3dVector(cols_all[mask])

    return pcd_sel, mask



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

        #Convex hull volume via scipy — tighter than OBB for convex surfaces.
        # Falls back to OBB on degenerate (flat/collinear) clusters.
        try:
            hull_vol_m3 = float(ConvexHull(cluster_pts).volume)
            hull_degenerate = False
        except QhullError:
            hull_vol_m3 = obb_vol_m3
            hull_degenerate = True
            log.warning(
                "ConvexHull failed for cluster %d (%d pts) — substituting OBB %.6f m3",
                int(label), n_pts, obb_vol_m3,
            )

        #Centroid for map / dashboard pinning
        centroid = cluster_pts.mean(axis=0)

        clusters.append({
            "clusterId":       int(label),
            "pointCount":      n_pts,
            "centroidXYZ":     [round(float(v), 4) for v in centroid],
            "voxelVolumeM3":   round(voxel_vol_m3, 6),
            "obbVolumeM3":     round(obb_vol_m3, 6),
            "obbExtentM":      obb_extent,         # [length, height, thickness] (approx)
            "hullVolumeM3":    round(hull_vol_m3, 6),
            "hullDegenerate":  hull_degenerate,
        })

    #Descending by voxel volume — largest new element first in the JSON list
    clusters.sort(key=lambda c: c["voxelVolumeM3"], reverse=True)

    log.info(
        "Volume computed for %d clusters. Largest: %.4f m3 voxel / %.4f m3 OBB / %.4f m3 hull",
        len(clusters),
        clusters[0]["voxelVolumeM3"]  if clusters else 0.0,
        clusters[0]["obbVolumeM3"]    if clusters else 0.0,
        clusters[0]["hullVolumeM3"]   if clusters else 0.0,
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


# Displacement matching
def match_displacements(
    added_clusters: list[dict],
    removed_clusters: list[dict],
    *,
    max_displacement_m: float = 5.0,
    volume_ratio_range: tuple[float, float] = (0.6, 1.7),
) -> dict:
    """Pair removed clusters to added clusters by centroid proximity + volume ratio.
    Unmatched added = new construction; unmatched removed = genuine demolition."""
    candidates: list[tuple[int, int, float]] = []
    for r_idx, rc in enumerate(removed_clusters):
        for a_idx, ac in enumerate(added_clusters):
            vR = rc["hullVolumeM3"]
            vA = ac["hullVolumeM3"]
            if vR <= 0 or vA <= 0:
                continue
            ratio = min(vR, vA) / max(vR, vA)
            if ratio < volume_ratio_range[0]:
                continue
            rc_c = np.array(rc["centroidXYZ"], dtype=np.float64)
            ac_c = np.array(ac["centroidXYZ"], dtype=np.float64)
            dist = float(np.linalg.norm(ac_c - rc_c))
            if dist >= max_displacement_m:
                continue
            candidates.append((r_idx, a_idx, dist))

    # Greedy nearest-first matching
    candidates.sort(key=lambda x: x[2])

    consumed_removed: set[int] = set()
    consumed_added: set[int] = set()
    events: list[dict] = []

    for r_idx, a_idx, dist in candidates:
        if r_idx in consumed_removed or a_idx in consumed_added:
            continue
        consumed_removed.add(r_idx)
        consumed_added.add(a_idx)
        rc = removed_clusters[r_idx]
        ac = added_clusters[a_idx]
        vol = (rc["hullVolumeM3"] + ac["hullVolumeM3"]) / 2.0
        events.append({
            "fromClusterId": rc["clusterId"],
            "toClusterId":   ac["clusterId"],
            "fromCentroid":  rc["centroidXYZ"],
            "toCentroid":    ac["centroidXYZ"],
            "displacementM": round(dist, 4),
            "volumeM3":      round(vol, 6),
        })

    unmatched_added   = [ac for i, ac in enumerate(added_clusters)   if i not in consumed_added]
    unmatched_removed = [rc for i, rc in enumerate(removed_clusters) if i not in consumed_removed]

    new_construction_m3 = sum(c["hullVolumeM3"] for c in unmatched_added)
    demolition_m3       = sum(c["hullVolumeM3"] for c in unmatched_removed)
    displacement_m3     = sum(e["volumeM3"] for e in events)

    degenerate_count = sum(
        1 for c in list(added_clusters) + list(removed_clusters)
        if c.get("hullDegenerate", False)
    )

    log.info(
        "Displacement matching: %d removed x %d added -> %d matched, "
        "%d unmatched added, %d unmatched removed",
        len(removed_clusters), len(added_clusters),
        len(events), len(unmatched_added), len(unmatched_removed),
    )

    return {
        "events":            events,
        "newConstructionM3": round(new_construction_m3, 6),
        "demolitionM3":      round(demolition_m3, 6),
        "displacementM3":    round(displacement_m3, 6),
        "stats": {
            "addedClusters":        len(added_clusters),
            "removedClusters":      len(removed_clusters),
            "matched":              len(events),
            "unmatchedAdded":       len(unmatched_added),
            "unmatchedRemoved":     len(unmatched_removed),
            "volumeBasis":          VOLUME_BASIS,
            "degenerateClusterCount": degenerate_count,
        },
    }


# PIPELINE ORCHESTRATOR
def analyze_delta(
    pcd_delta: o3d.geometry.PointCloud,
    out_path: str,
    eps: float,
    min_pts: int,
    voxel_size: float,
    label: str,
) -> dict:
    """
    Cluster one delta cloud, measure its volumes, and — only when it is
    non-empty — export a coloured PLY. Shared by the ADDED and REMOVED passes.

    Safe file I/O
    -------------
    If the delta cloud has zero points we DO NOT call write_point_cloud. An
    empty write makes Open3D emit "[Open3D WARNING] Write PLY failed: ..." (on
    stdout) and leaves a useless file behind; we return path=None instead so the
    caller knows nothing was written for this side.

    Performance — pre-voxelisation guard
    ------------------------------------
    DBSCAN builds a neighbour graph whose time/memory grows quickly with point
    count; on dense delta clouds (100k+ points) it hangs or OOMs. Above
    CLUSTER_DOWNSAMPLE_THRESHOLD we cluster a grid-snapped copy instead — one
    representative point per `voxel_size` cell, the SAME grid the voxel-volume
    metric uses — so that metric is provably unchanged: every dropped point
    shares a cell with a kept one. `pointCount` still reports the RAW delta size;
    element/volume stats and the exported PLY are computed on the compressed cloud.
    """
    pts_raw = np.asarray(pcd_delta.points)
    n_raw = len(pts_raw)

    if n_raw == 0:
        log.info("%s: 0 points beyond threshold — no DBSCAN, no PLY written.", label)
        return {
            "volumeM3":        0.0,
            "pointCount":      0,
            "elementCount":    0,
            "noisePointCount": 0,
            "clusters":        [],
            "path":            None,
        }

    # Pre-voxelisation guard: keep DBSCAN tractable on dense clouds. We grid-snap
    # to one representative point per voxel cell of edge `voxel_size` — the SAME
    # grid compute_cluster_volumes() counts — so the voxel-volume metric is
    # exactly preserved (every dropped point shares a cell with the kept one).
    # NB: Open3D's voxel_down_sample() returns per-cell CENTROIDS on its own grid
    # origin; re-flooring those at the volume grid shifts occupancy and skews the
    # measured volume (~25% low in testing), so we grid-align the dedup here.
    pts = pts_raw
    if n_raw > CLUSTER_DOWNSAMPLE_THRESHOLD:
        voxel_idx = np.floor(pts_raw / voxel_size).astype(np.int64)
        _, keep = np.unique(voxel_idx, axis=0, return_index=True)
        pts = pts_raw[keep]
        log.info(
            "%s: pre-voxelising for DBSCAN — %s -> %s pts at %.0f cm voxel "
            "(%.1fx compression)",
            label, f"{n_raw:,}", f"{len(pts):,}", voxel_size * 100,
            n_raw / max(len(pts), 1),
        )

    labels = cluster_dbscan(pts, eps, min_pts)
    clusters = compute_cluster_volumes(pts, labels, voxel_size)
    # hullVolumeM3 = convex-hull of each cluster's surface points — this
    # approximates the enclosed solid volume (e.g. the 2.5×1×2 box ≈ 5 m³).
    # voxelVolumeM3 only counts surface-layer voxels (~area × voxel_size),
    # which heavily underestimates solid objects scanned from one direction.
    total_vol = sum(c["hullVolumeM3"] for c in clusters)
    n_noise = int((labels == -1).sum())

    export_colored_ply(pts, labels, out_path)

    log.info(
        "%s: %s pts (raw) -> %d elements, %.4f m3 -> %s",
        label, f"{n_raw:,}", len(clusters), total_vol, out_path,
    )
    return {
        "volumeM3":        round(total_vol, 6),
        "pointCount":      n_raw,
        "elementCount":    len(clusters),
        "noisePointCount": n_noise,
        "clusters":        clusters,
        "path":            os.path.abspath(out_path),
    }


def detect_changes(
    path_t1: str,
    path_t2_aligned: str,
    out_added: str,
    out_removed: str,
    dist_thresh: float = 0.05,
    voxel_size: float = 0.05,
    eps: float = 0.15,
    min_pts: int = 20,
    run_displacement: bool = True,
) -> dict:
    """
    Run BIDIRECTIONAL change detection and return a JSON-ready dict.

    Two independent nearest-neighbour passes make the engine agnostic to the
    direction of change:

      ADDED   (new construction): build a KD-Tree on T1, query every T2 point.
              A T2 point whose nearest T1 neighbour is > dist_thresh away sits on
              geometry that did not exist at T1.

      REMOVED (demolition / missing scan data): build a KD-Tree on T2, query
              every T1 point. A T1 point whose nearest T2 neighbour is
              > dist_thresh away sits on geometry no longer present at T2.

    Each delta cloud is independently DBSCAN-clustered, volume-measured, and
    (only when non-empty) exported to its own coloured PLY.

    Returned dict
    -------------
    added    {volumeM3, pointCount, elementCount, noisePointCount, clusters, path}
    removed  {volumeM3, pointCount, elementCount, noisePointCount, clusters, path}
    elapsedS Wall-clock seconds for the full bidirectional pipeline.

    `path` is null for a side with zero delta points (no file was written).
    """
    t_start = time.time()
    log.info("=== Bidirectional change detection START ===")

    pcd_t1 = load_ply(path_t1)
    pcd_t2 = load_ply(path_t2_aligned)

    pts_t1 = np.asarray(pcd_t1.points)
    pts_t2 = np.asarray(pcd_t2.points)

    # ADDED pass — T2 points with no nearby T1 neighbour are new construction.
    log.info("--- ADDED pass: KD-Tree(T1), query T2 ---")
    dist_t2_to_t1 = compute_nn_distances(pts_t2, pts_t1)
    added_pcd, _ = filter_distant_points(pcd_t2, dist_t2_to_t1, dist_thresh)
    added = analyze_delta(added_pcd, out_added, eps, min_pts, voxel_size, "ADDED")

    # REMOVED pass — T1 points with no nearby T2 neighbour are gone (demolished
    # or simply not captured in the later scan).
    log.info("--- REMOVED pass: KD-Tree(T2), query T1 ---")
    dist_t1_to_t2 = compute_nn_distances(pts_t1, pts_t2)
    removed_pcd, _ = filter_distant_points(pcd_t1, dist_t1_to_t2, dist_thresh)
    removed = analyze_delta(removed_pcd, out_removed, eps, min_pts, voxel_size, "REMOVED")

    elapsed = round(time.time() - t_start, 2)
    log.info(
        "=== Bidirectional change detection DONE (%.1f s) -- "
        "added %.4f m3 / removed %.4f m3 ===",
        elapsed, added["volumeM3"], removed["volumeM3"],
    )

    result: dict = {
        "added":    added,
        "removed":  removed,
        "elapsedS": elapsed,
    }
    if run_displacement:
        result["displacement"] = match_displacements(added["clusters"], removed["clusters"])
    return result


# CLI  —  called by python.ts via child_process.spawn
def main() -> int:
    ap = argparse.ArgumentParser(
        description="Phase 2: bidirectional change detection (added + removed)."
    )
    ap.add_argument("--t1",          required=True,              help="Baseline scan (.ply)")
    ap.add_argument("--t2_aligned",  required=True,              help="ICP-aligned later scan (.ply)")
    ap.add_argument("--out_added",   required=True,              help="Output path for ADDED (new) elements .ply")
    ap.add_argument("--out_removed", required=True,              help="Output path for REMOVED (demolished/missing) elements .ply")
    ap.add_argument("--dist_thresh", type=float, default=0.05,   help="Delta distance threshold in metres (default 0.05)")
    ap.add_argument("--voxel",       type=float, default=0.05,   help="Voxel size for volume in metres (default 0.05)")
    ap.add_argument("--eps",         type=float, default=0.15,   help="DBSCAN neighbourhood radius in metres (default 0.15)")
    ap.add_argument("--min_pts",     type=int,   default=20,     help="DBSCAN minimum cluster size (default 20)")
    ap.add_argument("--no-displacement", action="store_true", default=False,
                    help="Skip displacement matching step (omits 'displacement' key from output)")
    args = ap.parse_args()

    try:
        result = detect_changes(
            path_t1=args.t1,
            path_t2_aligned=args.t2_aligned,
            out_added=args.out_added,
            out_removed=args.out_removed,
            dist_thresh=args.dist_thresh,
            voxel_size=args.voxel,
            eps=args.eps,
            min_pts=args.min_pts,
            run_displacement=not args.no_displacement,
        )
        print(json.dumps(result), flush=True)
        return 0

    except Exception as exc:
        log.exception("Change detection failed: %s", exc)
        print(json.dumps({"error": str(exc)}))
        return 2


def _hard_exit(code: int) -> None:
    """
    Flush stdout, then hard-exit so the main process terminates immediately.

    Why not executor.shutdown(wait=True)
    -------------------------------------
    The previous implementation called executor.shutdown(wait=True) here to try
    to tear down the joblib/loky worker pool before exiting. On Windows this call
    blocks indefinitely in some loky/joblib versions — the try/except only catches
    exceptions, not an infinite block — so os._exit() was never reached, the Node
    'exit' event never fired, and the run hung until the 20-minute timeout.

    The correct approach: os._exit() terminates the main process immediately.
    Loky workers become short-lived orphans (~300 s loky idle timeout), but
    Node.js already handles this correctly:
      • It settles the Promise on the main process 'exit' event, not 'close'.
      • cleanup() then destroys its pipe read handles, so orphan worker
        write-ends cannot pin the Node event loop.

    Why os._exit() and not sys.exit()
    ----------------------------------
    sys.exit() runs atexit handlers and destructor chains (Open3D, OpenMP, loky)
    which can stall for seconds. os._exit() bypasses all of that and terminates
    the process immediately — safe here because the JSON is already flushed.
    """
    try:
        sys.stdout.flush()
    except Exception:
        pass
    os._exit(code)


if __name__ == "__main__":
    _hard_exit(main())
