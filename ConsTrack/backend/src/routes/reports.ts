import path from "path";
import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { RunModel, ZoneModel, ReportModel } from "../models.js";
import { generatePdf, generateXlsx } from "../reports.js";

const REPORTS_DIR = path.join(path.resolve(process.cwd()), "reports");

export const router = Router();

router.get("/", authenticateToken, async (req, res) => {
  const projectId = String(req.query.projectId || "");
  const reports = await ReportModel.find({ projectId }).sort({ createdAtISO: -1 }).lean();
  res.json(
    reports.map((r) => ({
      id: String(r._id),
      projectId: r.projectId,
      runId: r.runId,
      createdAtISO: r.createdAtISO,
      pdfUrl: `/downloads/reports/${path.basename(r.pdfPath)}`,
      xlsxUrl: `/downloads/reports/${path.basename(r.xlsxPath)}`,
    }))
  );
});

router.post("/", authenticateToken, async (req, res) => {
  const projectId = String(req.body?.projectId || "");
  const runId = String(req.body?.runId || "");
  if (!runId) return res.status(400).json({ error: "runId is required" });

  const run = await RunModel.findById(runId).lean();
  if (!run) return res.status(404).json({ error: "run not found" });
  if (run.status !== "done") return res.status(400).json({ error: "run is not done yet" });

  const zones = await ZoneModel.find({ projectId }).lean();
  const pdfPath = await generatePdf(REPORTS_DIR, run as any, zones as any);
  const xlsxPath = await generateXlsx(REPORTS_DIR, run as any, zones as any);

  const rep = await ReportModel.create({
    projectId,
    runId,
    createdAtISO: new Date().toISOString(),
    pdfPath,
    xlsxPath,
  });

  res.json({
    id: String(rep._id),
    pdfUrl: `/downloads/reports/${path.basename(pdfPath)}`,
    xlsxUrl: `/downloads/reports/${path.basename(xlsxPath)}`,
  });
});
