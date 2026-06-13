import fs from "fs";
import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { uploadNewScan } from "../controllers/scanController.js";
import { ProjectModel, ZoneModel, ScanModel, RunModel, ReportModel } from "../models.js";

export const router = Router();

// ── Project CRUD ─────────────────────────────────────────────────────────────

router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const projects = await ProjectModel.find({ userId }).lean();
    const projectIds = projects.map((p) => String(p._id));

    const [scanCounts, zoneCounts, latestRuns] = await Promise.all([
      ScanModel.aggregate([
        { $match: { projectId: { $in: projectIds } } },
        { $group: { _id: "$projectId", count: { $sum: 1 } } },
      ]),
      ZoneModel.aggregate([
        { $match: { projectId: { $in: projectIds }, type: { $ne: "site" } } },
        { $group: { _id: "$projectId", count: { $sum: 1 } } },
      ]),
      RunModel.aggregate([
        { $match: { projectId: { $in: projectIds }, status: "done" } },
        { $sort: { createdAtISO: -1 } },
        { $group: { _id: "$projectId", overallProgressPct: { $first: "$overallProgressPct" }, lastRunISO: { $first: "$createdAtISO" } } },
      ]),
    ]);

    const scanMap = Object.fromEntries(scanCounts.map((x: any) => [x._id, x.count]));
    const zoneMap = Object.fromEntries(zoneCounts.map((x: any) => [x._id, x.count]));
    const runMap = Object.fromEntries(latestRuns.map((x: any) => [x._id, { pct: x.overallProgressPct, lastISO: x.lastRunISO }]));

    res.json(
      projects.map((p) => {
        const pid = String(p._id);
        return {
          id: pid,
          name: p.name,
          createdAtISO: p.createdAtISO,
          description: p.description,
          startDateISO: p.startDateISO,
          targetFinishDateISO: p.targetFinishDateISO,
          overallProgressPct: runMap[pid]?.pct ?? 0,
          lastActivityISO: runMap[pid]?.lastISO ?? p.createdAtISO,
          scanCount: scanMap[pid] ?? 0,
          zoneCount: zoneMap[pid] ?? 0,
        };
      })
    );
  } catch (e: any) {
    console.error("GET /api/projects error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post("/", authenticateToken, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });
    const userId = (req as any).user.userId;
    const description = req.body?.description ? String(req.body.description).trim() : undefined;
    const startDateISO = req.body?.startDateISO ? String(req.body.startDateISO) : undefined;
    const targetFinishDateISO = req.body?.targetFinishDateISO ? String(req.body.targetFinishDateISO) : undefined;

    const p = await ProjectModel.create({
      name,
      createdAtISO: new Date().toISOString(),
      userId,
      description,
      startDateISO,
      targetFinishDateISO,
    });
    const projectId = String(p._id);
    await ZoneModel.create({
      projectId,
      name,
      type: "site",
      completionPct: 0,
      createdAtISO: new Date().toISOString(),
    });
    res.json({
      id: projectId,
      name,
      createdAtISO: p.createdAtISO,
      description,
      startDateISO,
      targetFinishDateISO,
      overallProgressPct: 0,
      scanCount: 0,
      zoneCount: 0,
    });
  } catch (e: any) {
    console.error("POST /api/projects error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.patch("/:id", authenticateToken, async (req, res) => {
  try {
    const id = String(req.params.id);
    const userId = (req as any).user.userId;
    const patch: Record<string, unknown> = {};
    if (typeof req.body?.name === "string" && req.body.name.trim()) patch.name = req.body.name.trim();
    if (typeof req.body?.description === "string") patch.description = req.body.description.trim();
    if (req.body?.startDateISO !== undefined) patch.startDateISO = req.body.startDateISO || undefined;
    if (req.body?.targetFinishDateISO !== undefined) patch.targetFinishDateISO = req.body.targetFinishDateISO || undefined;

    const updated = await ProjectModel.findOneAndUpdate({ _id: id, userId }, patch, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: "Project not found" });
    res.json({
      id: String(updated._id),
      name: updated.name,
      createdAtISO: updated.createdAtISO,
      description: updated.description,
      startDateISO: updated.startDateISO,
      targetFinishDateISO: updated.targetFinishDateISO,
    });
  } catch (e: any) {
    console.error("PATCH /api/projects error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const id = String(req.params.id);
    const userId = (req as any).user.userId;
    const project = await ProjectModel.findOneAndDelete({ _id: id, userId }).lean();
    if (!project) return res.status(404).json({ error: "Project not found" });

    await ZoneModel.deleteMany({ projectId: id });

    const scans = await ScanModel.find({ projectId: id }).lean();
    for (const scan of scans) {
      if (scan.filePath) { try { fs.unlinkSync(scan.filePath); } catch { /* ignore */ } }
    }
    await ScanModel.deleteMany({ projectId: id });

    const reports = await ReportModel.find({ projectId: id }).lean();
    for (const report of reports) {
      try { fs.unlinkSync(report.pdfPath); } catch { /* ignore */ }
      try { fs.unlinkSync(report.xlsxPath); } catch { /* ignore */ }
    }
    await ReportModel.deleteMany({ projectId: id });
    await RunModel.deleteMany({ projectId: id });

    res.json({ ok: true });
  } catch (e: any) {
    console.error("DELETE /api/projects error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ── Scan Upload (Rolling Baseline Pipeline) ───────────────────────────────────

router.post(
  "/:projectId/scans",
  authenticateToken,
  upload.single("scanFile"),
  uploadNewScan
);
