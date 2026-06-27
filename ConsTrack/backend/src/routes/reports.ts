import path from "path";
import fs from "fs/promises";
import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { ProjectModel, RunModel, ZoneModel, ReportModel, ScanModel } from "../models.js";
import { generateReportFiles } from "../reporting.js";

const REPORTS_DIR = path.join(path.resolve(process.cwd()), "reports");

export const router = Router();

router.get("/", authenticateToken, async (req: Request, res: Response) => {
  const projectId = String(req.query.projectId || "");
  const reports = await ReportModel.find({ projectId }).sort({ createdAtISO: -1 }).lean();
  res.json(
    reports.map((r: any) => ({
      id: String(r._id),
      projectId: r.projectId,
      runId: r.runId,
      createdAtISO: r.createdAtISO,
      pdfUrl: `/downloads/reports/${path.basename(r.pdfPath)}`,
      xlsxUrl: `/downloads/reports/${path.basename(r.xlsxPath)}`,
    }))
  );
});

router.post("/", authenticateToken, async (req: Request<{}, any, { projectId?: string; runId?: string }>, res: Response) => {
  const projectId = String(req.body?.projectId || "");
  const runId = String(req.body?.runId || "");
  if (!runId) return res.status(400).json({ error: "runId is required" });

  const run = await RunModel.findById(runId).lean();
  if (!run) return res.status(404).json({ error: "run not found" });
  if (run.status !== "done") return res.status(400).json({ error: "run is not done yet" });

  const [zones, project, scanT1, scanT2] = await Promise.all([
    ZoneModel.find({ projectId }).lean(),
    ProjectModel.findById(projectId).lean(),
    ScanModel.findById(run.t1ScanId).lean(),
    ScanModel.findById(run.t2ScanId).lean(),
  ]);

  const t1Date = scanT1?.capturedAtISO || "Unknown T1 Date";
  const t2Date = scanT2?.capturedAtISO || "Unknown T2 Date";

  console.log(`[DEBUG Node.js Router] Fetched Scan Dates -> T1: ${t1Date} | T2: ${t2Date}`);

  // Use targetVolumeM3 from the run (saved when run completed)
  const targetVolumeM3 = (run as any)?.targetVolumeM3 || 0;
  console.log(`[DEBUG Node.js Router] Using Target Volume from Run: ${targetVolumeM3} m3`);

  // ── Which zone does the headline run itself belong to? ─────────────────
  // The top KPI cards (Overall Progress / Net Volume Change / Forecast) are
  // driven by THIS run alone — and since every scan belongs to exactly one
  // zone, this run's t1ScanId/t2ScanId pair belongs to exactly one zone too.
  // We resolve that zone's name so the report can label the headline numbers
  // instead of leaving them ambiguous about which floor they describe.
  const headlineZone = (zones as any[]).find((z) => {
    const linked: string[] = Array.isArray(z.linkedScanIds) ? z.linkedScanIds : [];
    return linked.includes(String(run.t1ScanId)) && linked.includes(String(run.t2ScanId));
  });
  const headlineZoneName = headlineZone?.name || "Unknown Zone";
  console.log(`[DEBUG Node.js Router] Headline run belongs to zone: ${headlineZoneName}`);

  // ── Per-zone breakdown ──────────────────────────────────────────────────
  // Each scan is captured for exactly one zone (linked at upload time via
  // Zone.linkedScanIds), and each Run compares a T1/T2 scan pair belonging to
  // a single zone. So a zone's *real* volume change is whatever Run used that
  // zone's own linked scans as both t1ScanId and t2ScanId — not a fraction of
  // some other Run's site-wide total. We fetch every "done" run for this
  // project once, then for each zone pick the most recent run whose
  // t1ScanId/t2ScanId are both in that zone's linkedScanIds.
  const allDoneRuns = await RunModel.find({ projectId, status: "done" })
    .sort({ createdAtISO: -1 })
    .lean();

  const zoneRuns = (zones as any[]).map((z) => {
    const linked: string[] = Array.isArray(z.linkedScanIds) ? z.linkedScanIds : [];
    const matchingRun = allDoneRuns.find(
      (r: any) => linked.includes(String(r.t1ScanId)) && linked.includes(String(r.t2ScanId))
    );
    return {
      zoneId: String(z._id),
      name: z.name,
      type: z.type,
      hasData: !!matchingRun,
      volumeT1M3: matchingRun ? (matchingRun as any).volumeT1M3 : undefined,
      volumeT2M3: matchingRun ? (matchingRun as any).volumeT2M3 : undefined,
      volumeChangeM3: matchingRun ? (matchingRun as any).volumeChangeM3 : undefined,
      runCreatedAtISO: matchingRun ? (matchingRun as any).createdAtISO : undefined,
    };
  });
  console.log(`[DEBUG Node.js Router] Resolved per-zone runs:`, zoneRuns.map(z => `${z.name}: ${z.hasData ? z.volumeChangeM3 + 'm3' : 'no matching run'}`));

  let pdfPath: string;
  let xlsxPath: string;
  try {
    ({ pdfPath, xlsxPath } = await generateReportFiles({
      outDir: REPORTS_DIR,
      projectName: project?.name ?? projectId,
      run: run as any,
      zones: zones as any,
      zoneRuns,
      headlineZoneName,
      t1ScanDate: String(t1Date),
      t2ScanDate: String(t2Date),
      targetVolumeM3,
    }));
  } catch (err: any) {
    console.error("[reports] generateReportFiles failed:", err.message);
    return res.status(500).json({ error: `Report generation failed: ${err.message}` });
  }

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

router.delete("/:id", authenticateToken, async (req: Request, res: Response) => {
  const reportId = req.params.id;
  
  console.log(`\n[DEBUG DELETE]  Started deletion process for report ID: ${reportId}`);

  try {
    // 1. חיפוש הדוח במסד הנתונים
    console.log(`[DEBUG DELETE]  Searching for report in Database...`);
    const report = await ReportModel.findById(reportId);
    
    if (!report) {
      console.log(`[DEBUG DELETE]  Report NOT FOUND in DB for ID: ${reportId}`);
      return res.status(404).json({ error: "Report not found" });
    }

    console.log(`[DEBUG DELETE]  Found report! PDF Path: ${report.pdfPath} | XLSX Path: ${report.xlsxPath}`);

    // 2. מחיקת הקבצים הפיזיים מהדיסק
    try {
      if (report.pdfPath) {
        console.log(`[DEBUG DELETE]  Attempting to delete physical PDF: ${report.pdfPath}`);
        await fs.unlink(report.pdfPath);
        console.log(`[DEBUG DELETE]  Physical PDF deleted successfully.`);
      }
      
      if (report.xlsxPath) {
        console.log(`[DEBUG DELETE]  Attempting to delete physical XLSX: ${report.xlsxPath}`);
        await fs.unlink(report.xlsxPath);
        console.log(`[DEBUG DELETE]  Physical XLSX deleted successfully.`);
      }
    } catch (fileErr: any) {
      console.error(`[DEBUG DELETE]  Failed to delete some physical files (maybe they don't exist?):`, fileErr.message);
      // ממשיכים בכל זאת כדי לא לתקוע את המחיקה מהדאטאבייס
    }

    // 3. מחיקת הדוח מה-Database
    console.log(`[DEBUG DELETE]  Removing report document from MongoDB...`);
    await ReportModel.findByIdAndDelete(reportId);
    console.log(`[DEBUG DELETE]  Report ${reportId} completely wiped out!`);

    // 4. החזרת תשובה תקינה לפרונטאנד
    return res.json({ success: true, message: "Report deleted successfully" });

  } catch (err: any) {
    console.error(`[DEBUG DELETE]  CRITICAL ERROR during deletion:`, err.message);
    return res.status(500).json({ error: `Deletion failed: ${err.message}` });
  }
});