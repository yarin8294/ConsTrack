import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { RunModel } from "../models.js";

export const router = Router();

router.get("/", authenticateToken, async (req, res) => {
  const projectId = String(req.query.projectId || "");
  const latest = await RunModel.findOne({ projectId, status: "done" }).sort({ createdAtISO: -1 }).lean();
  const overallProgressPct = latest?.completionPctDelta ?? latest?.overallProgressPct ?? 0;
  const volumeChangeM3 = latest?.volumeChangeM3 ?? 0;
  const forecastCompletionISO = latest?.forecastCompletionISO || "";

  const firstRun = await RunModel.findOne({ projectId, status: "done" }).sort({ createdAtISO: 1 }).lean();
  let productivityIndex = 1.0;
  if (firstRun && latest) {
    const days = Math.max(
      1,
      (new Date(latest.createdAtISO).getTime() - new Date(firstRun.createdAtISO).getTime()) / (1000 * 60 * 60 * 24)
    );
    const rate = overallProgressPct / days;
    productivityIndex = Math.round((rate / 5) * 100) / 100; // 5%/day baseline
    productivityIndex = Math.max(0, productivityIndex);
  }

  const runs = await RunModel.find({ projectId, status: "done" }).sort({ createdAtISO: 1 }).lean();
  const series = runs.map((r) => ({ t: r.createdAtISO, progressPct: r.completionPctDelta ?? r.overallProgressPct ?? 0 }));

  res.json({ overallProgressPct, volumeChangeM3, forecastCompletionISO, productivityIndex, series });
});
