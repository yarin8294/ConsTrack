import path from "path";
import fs from "fs";
import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { RunModel, ScanModel, ZoneModel } from "../models.js";
import { publish } from "../realtime.js";
import { runPythonPreprocess, runPythonChangeDetect } from "../services/python.js";
import { calcOverallProgress, getLeafZones, forecastDateISO } from "../utils/calculations.js";

// Intermediate PLY files produced during a run are stored here.
const RUNS_DIR = path.resolve(process.cwd(), "uploads", "runs");
fs.mkdirSync(RUNS_DIR, { recursive: true });

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
    }))
  );
});

router.post("/", authenticateToken, async (req, res) => {
  const projectId = String(req.body?.projectId || "");
  const t1ScanId = String(req.body?.t1ScanId || "");
  const t2ScanId = String(req.body?.t2ScanId || "");
  const voxelSize = Number(req.body?.voxelSize || 0.05);

  if (!t1ScanId || !t2ScanId) return res.status(400).json({ error: "t1ScanId and t2ScanId are required" });
  if (t1ScanId === t2ScanId) return res.status(400).json({ error: "t1 and t2 must be different scans" });

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

  // Fire-and-forget async processing
  (async () => {
    try {
      await RunModel.findByIdAndUpdate(runId, { status: "processing" });
      publish(projectId, { type: "run.progress", runId, status: "processing", pct: 5 });

      const t1 = await ScanModel.findById(t1ScanId).lean();
      const t2 = await ScanModel.findById(t2ScanId).lean();
      if (!t1 || !t2) throw new Error("Missing scan files");

      // ── Step 1: Align T2 onto T1's coordinate frame (FPFH-RANSAC → Point-to-Plane ICP) ──
      publish(projectId, { type: "run.progress", runId, status: "processing", pct: 10 });
      const alignedT2Path = path.join(RUNS_DIR, `${runId}_aligned_t2.ply`);
      const preprocess = await runPythonPreprocess(t1.filePath, t2.filePath, alignedT2Path, { voxelSize });

      // ── Step 2: Bidirectional change detection on the now-aligned clouds ──
      publish(projectId, { type: "run.progress", runId, status: "processing", pct: 55 });
      const outAddedPath   = path.join(RUNS_DIR, `${runId}_added.ply`);
      const outRemovedPath = path.join(RUNS_DIR, `${runId}_removed.ply`);
      const changes = await runPythonChangeDetect(
        t1.filePath,
        preprocess.alignedT2Path,
        outAddedPath,
        outRemovedPath,
        { voxelSize },
      );

      // ── Step 3: Bridge change-detector output → legacy RunDoc flat metrics ──
      //
      // added.volumeM3   = volume of material newly placed in T2 (construction work)
      // removed.volumeM3 = volume of material present in T1 but absent in T2 (demolition)
      //
      // volumeT1M3 is set to the total change magnitude (added + removed) so that
      // calcOverallProgress produces:
      //   overallProgressPct = (added − removed) / (added + removed) × 100
      // which expresses what fraction of all volumetric activity is net-positive construction.
      publish(projectId, { type: "run.progress", runId, status: "processing", pct: 85 });

      const addedVol       = changes.added.volumeM3;
      const removedVol     = changes.removed.volumeM3;
      const volumeChangeM3 = addedVol - removedVol;
      const volumeT1M3     = addedVol + removedVol;          // total change magnitude
      const volumeT2M3     = volumeT1M3 + volumeChangeM3;   // = 2 × addedVol
      const overallProgressPct = calcOverallProgress(volumeT1M3, volumeT2M3);

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

      // alignmentConfidence comes directly from ICP fitness/RMSE metrics — far more
      // accurate than the old heuristic that guessed from volume magnitude.
      const conf = preprocess.alignmentConfidence.toLowerCase() as "high" | "medium" | "low";
      const forecastCompletionISO = forecastDateISO(overallProgressPct);

      await RunModel.findByIdAndUpdate(runId, {
        status: "done",
        alignmentConfidence: conf,
        volumeT1M3,
        volumeT2M3,
        volumeChangeM3,
        overallProgressPct,
        forecastCompletionISO,
        metricsByZone: perZoneProgress,
      });

      publish(projectId, { type: "run.done", runId, status: "done" });
    } catch (e: any) {
      await RunModel.findByIdAndUpdate(runId, { status: "failed", error: String(e?.message || e) });
      publish(projectId, { type: "run.done", runId, status: "failed", error: String(e?.message || e) });
    }
  })();

  res.json({ id: runId, status: "queued" });
});
