import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { RunModel, ScanModel, ZoneModel } from "../models.js";
import { publish } from "../realtime.js";
import { runPythonVolumeDiff } from "../services/python.js";
import { calcOverallProgress, getLeafZones, pickConfidence, forecastDateISO } from "../utils/calculations.js";

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

      publish(projectId, { type: "run.progress", runId, status: "processing", pct: 20 });
      const volumes = await runPythonVolumeDiff(t1.filePath, t2.filePath, voxelSize);

      publish(projectId, { type: "run.progress", runId, status: "processing", pct: 75 });

      const overallProgressPct = calcOverallProgress(volumes.volumeT1M3, volumes.volumeT2M3);
      const leafZones = await getLeafZones(projectId);

      const perZoneProgress = leafZones.map((z, i) => {
        const w = leafZones.length <= 1 ? 1 : (i + 1) / leafZones.length;
        const p = Math.max(0, Math.min(100, overallProgressPct * (0.7 + 0.6 * w)));
        return {
          zoneId: String(z._id),
          progressPct: Math.round(p * 10) / 10,
          volumeChangeM3: volumes.volumeChangeM3 / Math.max(1, leafZones.length),
        };
      });

      const root = await ZoneModel.findOne({ projectId, type: "site" }).lean();
      if (root) await ZoneModel.findByIdAndUpdate(String(root._id), { completionPct: overallProgressPct });

      const conf = pickConfidence(volumes.volumeChangeM3);
      const forecastCompletionISO = forecastDateISO(overallProgressPct);

      await RunModel.findByIdAndUpdate(runId, {
        status: "done",
        alignmentConfidence: conf,
        volumeT1M3: volumes.volumeT1M3,
        volumeT2M3: volumes.volumeT2M3,
        volumeChangeM3: volumes.volumeChangeM3,
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
