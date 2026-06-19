import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunDoc, ZoneDoc } from "./models.js";

const execFileAsync = promisify(execFile);

export type ReportPaths = { pdfPath: string; xlsxPath: string };


export async function generateReportFiles(opts: {
  outDir: string;
  projectName: string;
  run: RunDoc;
  zones: ZoneDoc[];
  t1ScanDate: string; 
  t2ScanDate: string; 
}): Promise<ReportPaths> {
  console.log("[DEBUG 1] Entering generateReportFiles...");
  console.log(`[DEBUG 2.5] Forwarding to Python -> T1 Date: ${opts.t1ScanDate}, T2 Date: ${opts.t2ScanDate}`);
  
  fs.mkdirSync(opts.outDir, { recursive: true });
  const ts = Date.now();
  const pdfPath = path.join(opts.outDir, `report_${opts.run.projectId}_${ts}.pdf`);
  const xlsxPath = path.join(opts.outDir, `report_${opts.run.projectId}_${ts}.xlsx`);

  console.log("[DEBUG 2] Calculated paths:", { pdfPath, xlsxPath });

  // הכנת האובייקט שיישלח לפייתון
  const payload = {
    outDir: opts.outDir,
    projectName: opts.projectName,
    run: opts.run,
    zones: opts.zones,
    pdfPath,
    xlsxPath,
    t1ScanDate: opts.t1ScanDate, 
    t2ScanDate: opts.t2ScanDate  
  };

  // פתרון פשוט ונקי: מכיוון שאתה מריץ מתוך תיקיית backend, 
  // נתיב ה-src המלא מחושב בצורה מושלמת באמצעות path.join הרגיל
  const scriptDirectory = path.join(process.cwd(), "src");
  const scriptName = "reports.py"; 

  console.log("[DEBUG 3] Script directory location:", scriptDirectory);
  console.log("[DEBUG 3.5] Looking for file name:", scriptName);

  try {
    console.log("[DEBUG 4] Executing Python process...");
    
    // הרצה נקייה ללא shell: true, מה שמונע את קריסת ה-cmd ואת אזהרת האבטחה
    const { stdout, stderr } = await execFileAsync("python", [scriptName, JSON.stringify(payload)], {
      cwd: scriptDirectory
    });
    
    console.log("[DEBUG 5] Python executed successfully!");
    console.log("[DEBUG Python stdout]:", stdout);
    if (stderr) console.log("[DEBUG Python stderr]:", stderr);

  } catch (error: any) {
    console.error("!!! [DEBUG ERROR] Python execution failed !!!");
    console.error("Error Message:", error.message);
    console.error("Python Stderr:", error.stderr);
    console.error("Python Stdout:", error.stdout);
    throw new Error(`Python generation failed: ${error.message}`);
  }

  return { pdfPath, xlsxPath };
}