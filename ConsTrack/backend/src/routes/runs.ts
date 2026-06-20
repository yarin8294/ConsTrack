import path from "path";
import fs from "fs";
import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { RunModel, ScanModel, ZoneModel, ProjectModel } from "../models.js";
import { publish } from "../realtime.js";
import { runPythonPreprocess, runPythonChangeDetect, runPythonVolumeOne } from "../services/python.js";
import { calcProgressFromDelta, calcTask43Metrics, getLeafZones, forecastDateISO } from "../utils/calculations.js";

// Intermediate PLY files produced during a run are stored here.
const RUNS_DIR = path.resolve(process.cwd(), "uploads", "runs");
fs.mkdirSync(RUNS_DIR, { recursive: true });

// Fallback scope baseline when neither the request body nor the ProjectDoc carry one.
const DEFAULT_TARGET_M3 = 25.0;

export const router = Router();

router.get("/", authenticateToken, async (req, res) => {
  const projectId = String(req.query.projectId || "");
  const runs = await RunModel.find({ projectId }).sort({ createdAtISO: -1 }).lean();
  res.json(
    runs.map((r) => ({
      id: String(r._id),
      projectId: r.projectId,
      createdAtISO: r.createdAtISO,
      t1ScanId: r.t1ScanId,
      t2ScanId: r.t2ScanId,
      status: r.status,
      error: r.error,
      alignmentConfidence: r.alignmentConfidence,
      volumeT1M3: r.volumeT1M3,
      volumeT2M3: r.volumeT2M3,
      volumeChangeM3: r.volumeChangeM3,
      overallProgressPct: r.overallProgressPct,
      forecastCompletionISO: r.forecastCompletionISO,
      metricsByZone: r.metricsByZone,
      // Full pipeline results
      fitness: r.fitness,
      rmseCm: r.rmseCm,
      addedVolumeM3: r.addedVolumeM3,
      removedVolumeM3: r.removedVolumeM3,
      addedElementCount: r.addedElementCount,
      removedElementCount: r.removedElementCount,
      // Task 4.3
      daysElapsed: r.daysElapsed,
      newConstructionM3: r.newConstructionM3,
      netProgressM3: r.netProgressM3,
      progressRateM3PerDay: r.progressRateM3PerDay,
      grossRateM3PerDay: r.grossRateM3PerDay,
      completionPctDelta: r.completionPctDelta,
      productivityIndex: r.productivityIndex,
      etaISO: r.etaISO,
      // Displacement provenance
      volumeBasis: r.volumeBasis,
      degenerateClusterCount: r.degenerateClusterCount,
      task43Error: r.task43Error,
    }))
  );
});

router.post("/", authenticateToken, async (req, res) => {
  const projectId = String(req.body?.projectId || "");
  const t1ScanId  = String(req.body?.t1ScanId || "");
  const t2ScanId  = String(req.body?.t2ScanId || "");
  const voxelSize = Number(req.body?.voxelSize || 0.05);
  // Optional scope override from request body — takes priority over project setting and DEFAULT.
  const reqTargetVolumeM3: number | undefined =
    req.body?.targetVolumeM3 != null ? Number(req.body.targetVolumeM3) : undefined;

  if (!t1ScanId || !t2ScanId) return res.status(400).json({ error: "t1ScanId and t2ScanId are required" });
  if (t1ScanId === t2ScanId)  return res.status(400).json({ error: "t1 and t2 must be different scans" });

  // Reject a new run while one is already in flight for this project — prevents
  // two Python pipelines writing to the same uploads/runs/<runId> paths and DB
  // fields concurrently (e.g. user double-clicks, or refreshes and retries).
  const activeRun = await RunModel.findOne({
    projectId,
    status: { $in: ["queued", "processing"] },
  }).lean();
  if (activeRun) {
    return res.status(409).json({ error: "A comparison is already running for this project" });
  }

  const created = await RunModel.create({
    projectId,
    createdAtISO: new Date().toISOString(),
    t1ScanId,
    t2ScanId,
    status: "queued",
    alignmentConfidence: "medium",
    volumeT1M3: 0,
    volumeT2M3: 0,
    volumeChangeM3: 0,
    overallProgressPct: 0,
    metricsByZone: [],
    forecastCompletionISO: undefined,
  });

  const runId = String(created._id);
  publish(projectId, { type: "run.created", runId, status: "queued" });

  // Fire-and-forget: the three Python steps run sequentially in the background.
  // Each step writes progress events so the UI can show a live indicator.
  (async () => {
    try {
      await RunModel.findByIdAndUpdate(runId, { status: "processing" });
      publish(projectId, { type: "run.progress", runId, status: "processing", pct: 5 });

      const t1 = await ScanModel.findById(t1ScanId).lean();
      const t2 = await ScanModel.findById(t2ScanId).lean();
      if (!t1 || !t2) throw new Error("Missing scan records in database");
      if (!fs.existsSync(t1.filePath)) throw new Error(`T1 file not found on disk: ${t1.filePath}`);
      if (!fs.existsSync(t2.filePath)) throw new Error(`T2 file not found on disk: ${t2.filePath}`);

      // ── Step 1: Measure T1 baseline volume ────────────────────────────────
      // Runs volume_diff.py --single on T1 to get the total occupied volume
      // before any construction.  This becomes the denominator for progress %:
      //   overallProgressPct = addedVolumeM3 / volumeT1M3 × 100
      // A fixed seed inside the Python script ensures the same file always
      // produces the same voxel count, so progress is deterministic.
      publish(projectId, { type: "run.progress", runId, status: "processing", pct: 8 });
      const { volumeM3: volumeT1M3 } = await runPythonVolumeOne(t1.filePath, voxelSize);

      // ── Step 2: Preprocess ─────────────────────────────────────────────────
      // Denoises both clouds (Statistical Outlier Removal), aligns T2 onto T1's
      // coordinate frame via FPFH-RANSAC global registration + Point-to-Plane ICP,
      // and writes two PLY files to disk:
      //   • out_t1 — SOR-cleaned T1 in its original frame (required by change_detector)
      //   • out_t2 — SOR-cleaned T2 transformed into T1's frame
      // Returns ICP fitness/RMSE so we can report alignment quality.
      publish(projectId, { type: "run.progress", runId, status: "processing", pct: 15 });
      const cleanedT1Path  = path.join(RUNS_DIR, `${runId}_t1_cleaned.ply`);
      const alignedT2Path  = path.join(RUNS_DIR, `${runId}_t2_aligned.ply`);
      const preprocessResult = await runPythonPreprocess(
        t1.filePath,
        t2.filePath,
        alignedT2Path,
        cleanedT1Path,
        { voxelSize },
      );

      // ── Step 2: Change detection ───────────────────────────────────────────
      // Builds KD-Trees on the aligned clouds and finds:
      //   • ADDED points — in T2 but not in T1 (new construction)
      //   • REMOVED points — in T1 but not in T2 (demolition / scan gap)
      // Each set is DBSCAN-clustered into discrete structural elements and
      // volume-measured with both voxel and OBB methods.
      // Both inputs MUST be PLY — preprocessResult supplies exactly that.
      publish(projectId, { type: "run.progress", runId, status: "processing", pct: 55 });
      const outAddedPath   = path.join(RUNS_DIR, `${runId}_added.ply`);
      const outRemovedPath = path.join(RUNS_DIR, `${runId}_removed.ply`);

      // Use cleanedT1Path returned by Python (falls back to the path we passed).
      const t1PlyPath = preprocessResult.cleanedT1Path ?? cleanedT1Path;

      const changes = await runPythonChangeDetect(
        t1PlyPath,
        preprocessResult.alignedT2Path,
        outAddedPath,
        outRemovedPath,
        { voxelSize },
      );

      // ── Step 3: Aggregate metrics ──────────────────────────────────────────
      // addedVolumeM3   = total volume of newly placed material
      // removedVolumeM3 = total volume of material that disappeared
      // volumeChangeM3  = net change (positive = more was built than removed)
      //
      // For the legacy volumeT1M3/volumeT2M3 fields (used by dashboard/reports):
      //   volumeT1M3 = addedVol + removedVol  (total activity magnitude)
      //   volumeT2M3 = addedVol + addedVol    (so delta / T1 = addedFraction)
      // This lets calcOverallProgress return a meaningful 0–100 % value even
      // without running the slower volume_diff.py scan.
      publish(projectId, { type: "run.progress", runId, status: "processing", pct: 85 });

      const addedVolumeM3   = changes.added.volumeM3;
      const removedVolumeM3 = changes.removed.volumeM3;
      const volumeChangeM3  = addedVolumeM3 - removedVolumeM3;
      // volumeT2M3 ≈ T1 baseline + net change (used for dashboard/reports legacy fields)
      const volumeT2M3 = Math.max(0, volumeT1M3 + volumeChangeM3);

      // overallProgressPct = how much new material was added relative to
      // what existed at T1.  E.g. if T1 is 100 m³ and 20 m³ was added → 20%.
      const overallProgressPct = calcProgressFromDelta(addedVolumeM3, volumeT1M3);

      const leafZones = await getLeafZones(projectId);
      const perZoneProgress = leafZones.map((z, i) => {
        const w = leafZones.length <= 1 ? 1 : (i + 1) / leafZones.length;
        const p = Math.max(0, Math.min(100, overallProgressPct * (0.7 + 0.6 * w)));
        return {
          zoneId: String(z._id),
          progressPct: Math.round(p * 10) / 10,
          volumeChangeM3: volumeChangeM3 / Math.max(1, leafZones.length),
        };
      });

      const root = await ZoneModel.findOne({ projectId, type: "site" }).lean();
      if (root) await ZoneModel.findByIdAndUpdate(String(root._id), { completionPct: overallProgressPct });

      // alignmentConfidence comes directly from ICP fitness/RMSE — no guessing.
      const conf = preprocessResult.alignmentConfidence.toLowerCase() as "high" | "medium" | "low";

      // ── Task 4.3 metrics ────────────────────────────────────────────────────
      const disp = changes.displacement;
      const volumeBasis = disp?.stats.volumeBasis;
      const degenerateClusterCount = disp?.stats.degenerateClusterCount;

      const updateDoc: Record<string, unknown> = {
        status: "done",
        alignmentConfidence: conf,
        volumeT1M3,
        volumeT2M3,
        volumeChangeM3,
        overallProgressPct,
        forecastCompletionISO: forecastDateISO(overallProgressPct),
        metricsByZone: perZoneProgress,
        // ICP quality metrics
        fitness: preprocessResult.fitness,
        rmseCm:  preprocessResult.rmseCm,
        // Change detection summary
        addedVolumeM3,
        removedVolumeM3,
        addedElementCount:   changes.added.elementCount,
        removedElementCount: changes.removed.elementCount,
      };

      try {
        const project = await ProjectModel.findById(projectId).lean();
        const task43 = calcTask43Metrics({
          addedM3:        addedVolumeM3,
          removedM3:      removedVolumeM3,
          displacementM3: disp?.displacementM3 ?? 0,
          t1ISO:          t1.capturedAtISO,
          t2ISO:          t2.capturedAtISO,
          targetVolumeM3: reqTargetVolumeM3 ?? project?.targetVolumeM3 ?? DEFAULT_TARGET_M3,
          plannedRateM3PerDay: undefined,
        });
        Object.assign(updateDoc, task43, { volumeBasis, degenerateClusterCount });
      } catch (err) {
        console.error({ runId, err }, "calcTask43Metrics failed");
        updateDoc.task43Error = err instanceof Error ? err.message : String(err);
      }

      await RunModel.findByIdAndUpdate(runId, updateDoc);

      publish(projectId, { type: "run.done", runId, status: "done" });
    } catch (e: any) {
      await RunModel.findByIdAndUpdate(runId, { status: "failed", error: String(e?.message || e) });
      publish(projectId, { type: "run.done", runId, status: "failed", error: String(e?.message || e) });
    }
  })();

  res.json({ id: runId, status: "queued" });
});
