import { Request, Response } from "express";
import path from "path";
import { Scan, ProgressEvent } from "../models/index.js";
import {
  runPythonStandardize,
  runPythonPreprocess,
  runPythonChangeDetect,
} from "../services/python.js";

export async function uploadNewScan(req: Request, res: Response): Promise<void> {
  try {
    // ── 1. Validation ────────────────────────────────────────────────────────
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded." });
      return;
    }
    const { projectId } = req.params;

    // ── 2. Sequence Check ────────────────────────────────────────────────────
    const previousScan = await Scan.findOne({ projectId })
      .sort({ sequenceNumber: -1 })
      .lean();

    const sequenceNumber = previousScan ? previousScan.sequenceNumber + 1 : 1;

    // ── 3. Standardize ───────────────────────────────────────────────────────
    const uploadDir = path.dirname(req.file.path);
    const stem = path.basename(req.file.filename, path.extname(req.file.filename));
    const cleanedPlyHint = path.join(uploadDir, `${stem}_cleaned.ply`);

    // Python is the source of truth for the actual output path.
    console.log(`[scan] project=${projectId} seq=${sequenceNumber} standardizing ${req.file.filename}`);
    const standardizeResult = await runPythonStandardize(req.file.path, cleanedPlyHint);
    const cleanedPlyPath = standardizeResult.cleanedPlyPath;
    console.log(`[scan] standardized → ${cleanedPlyPath} (${standardizeResult.cleanedPointCount} pts, ${standardizeResult.elapsedS}s)`);

    // ── 4. Save Scan ─────────────────────────────────────────────────────────
    const newScan = await Scan.create({
      projectId,
      sequenceNumber,
      scanDate: new Date(),
      rawFilePath: req.file.path,
      cleanedPlyPath,
    });

    // ── 5. Baseline Exit ─────────────────────────────────────────────────────
    if (sequenceNumber === 1) {
      res.status(201).json({
        message: "Baseline scan established",
        scan: newScan,
      });
      return;
    }

    // ── 6. Preprocess (Alignment) ────────────────────────────────────────────
    // Prefer the previously aligned version so each scan aligns to the same
    // cleaned coordinate space rather than an ever-drifting chain of raw scans.
    const targetT1Path = previousScan!.alignedPlyPath || previousScan!.cleanedPlyPath;
    const alignedPlyHint = path.join(uploadDir, `${stem}_aligned.ply`);

    console.log(`[scan] preprocessing (align T2→T1) against ${targetT1Path}`);
    const preprocessResult = await runPythonPreprocess(
      targetT1Path,
      newScan.cleanedPlyPath,
      alignedPlyHint
    );
    console.log(
      `[scan] aligned → ${preprocessResult.alignedT2Path} ` +
        `(fitness=${preprocessResult.fitness}, rmse=${preprocessResult.rmseCm}cm, ${preprocessResult.alignmentConfidence})`
    );

    // Use the path Python actually wrote, not the hint we suggested.
    newScan.alignedPlyPath = preprocessResult.alignedT2Path;
    await newScan.save();

    // ── 7. Change Detection (bidirectional: added + removed) ──────────────────
    const addedHint = path.join(uploadDir, `${stem}_added.ply`);
    const removedHint = path.join(uploadDir, `${stem}_removed.ply`);

    console.log(`[scan] change-detecting (bidirectional T2↔T1)`);
    const changeResult = await runPythonChangeDetect(
      targetT1Path,
      preprocessResult.alignedT2Path,
      addedHint,
      removedHint
    );
    console.log(
      `[scan] change-detect done in ${changeResult.elapsedS}s — ` +
        `added: ${changeResult.added.elementCount} el / ${changeResult.added.volumeM3} m³, ` +
        `removed: ${changeResult.removed.elementCount} el / ${changeResult.removed.volumeM3} m³`
    );

    // ── 8. Save Progress Event ───────────────────────────────────────────────
    const progressEvent = await ProgressEvent.create({
      projectId,
      baselineScanId: previousScan!._id,
      newScanId: newScan._id,
      added: {
        volumeM3: changeResult.added.volumeM3,
        pointCount: changeResult.added.pointCount,
        elementCount: changeResult.added.elementCount,
        noisePointCount: changeResult.added.noisePointCount,
        clusters: changeResult.added.clusters,
        plyPath: changeResult.added.path,
      },
      removed: {
        volumeM3: changeResult.removed.volumeM3,
        pointCount: changeResult.removed.pointCount,
        elementCount: changeResult.removed.elementCount,
        noisePointCount: changeResult.removed.noisePointCount,
        clusters: changeResult.removed.clusters,
        plyPath: changeResult.removed.path,
      },
    });

    // ── 9. Return ────────────────────────────────────────────────────────────
    res.status(201).json({
      scan: newScan,
      progressEvent,
      alignment: {
        fitness: preprocessResult.fitness,
        rmseM: preprocessResult.rmseM,
        rmseCm: preprocessResult.rmseCm,
        alignmentConfidence: preprocessResult.alignmentConfidence,
        transformMatrix: preprocessResult.transformMatrix,
        elapsedS: preprocessResult.elapsedS,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred";
    // The catch previously logged nothing — a real failure (e.g. a rejected
    // Python bridge Promise) was invisible in the Node terminal. Log it.
    console.error("[scan] pipeline failed:", message);
    res.status(500).json({ error: message });
  }
}
