import fs from "fs";
import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { ScanModel, ZoneModel } from "../models.js";
import { runPythonExtractPoints } from "../services/python.js";
import { getFromCache, addToCache } from "../services/pointCloud.js";

export const router = Router();

router.get("/", authenticateToken, async (req, res) => {
  const projectId = String(req.query.projectId || "");
  const scans = await ScanModel.find({ projectId }).sort({ uploadedAtISO: -1 }).lean();
  res.json(
    scans.map((s) => ({
      id: String(s._id),
      projectId: s.projectId,
      name: s.name,
      sizeBytes: s.sizeBytes,
      capturedAtISO: s.capturedAtISO,
      uploadedAtISO: s.uploadedAtISO,
      notes: s.notes,
    }))
  );
});

router.post("/upload", authenticateToken, upload.single("file"), async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || "");
    const capturedAtISO = String(req.body?.capturedAtISO || new Date().toISOString());
    const notes = req.body?.notes ? String(req.body.notes) : undefined;
    const zoneId = req.body?.zoneId ? String(req.body.zoneId) : undefined;
    if (!req.file) return res.status(400).json({ error: "file is required" });

    const doc = await ScanModel.create({
      projectId,
      name: req.file.originalname,
      sizeBytes: req.file.size,
      capturedAtISO,
      uploadedAtISO: new Date().toISOString(),
      notes,
      filePath: req.file.path,
    });

    if (zoneId) {
      try {
        await ZoneModel.findByIdAndUpdate(zoneId, { $addToSet: { linkedScanIds: String(doc._id) } });
      } catch {
        // zone link failure does not cancel the upload
      }
    }

    res.json({
      id: String(doc._id),
      projectId,
      name: doc.name,
      sizeBytes: doc.sizeBytes,
      capturedAtISO: doc.capturedAtISO,
      uploadedAtISO: doc.uploadedAtISO,
      notes: doc.notes,
    });
  } catch (e: any) {
    console.error("Upload error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.delete("/:id", authenticateToken, async (req, res) => {
  const id = String(req.params.id);
  const scan = await ScanModel.findByIdAndDelete(id).lean();
  if (scan?.filePath) {
    try { fs.unlinkSync(scan.filePath); } catch { /* ignore */ }
  }
  res.json({ ok: true });
});

router.get("/:id/file", authenticateToken, async (req, res) => {
  const id = String(req.params.id);
  const scan = await ScanModel.findById(id).lean();
  if (!scan?.filePath) return res.status(404).json({ error: "Scan not found" });
  res.sendFile(scan.filePath);
});

router.get("/:id/points", authenticateToken, async (req, res) => {
  const id = String(req.params.id);
  const format = String(req.query.format || "json");
  const scan = await ScanModel.findById(id).lean();
  if (!scan?.filePath) return res.status(404).json({ error: "Scan not found" });

  try {
    let cached = getFromCache(id);
    let points: number[][];
    let colors: number[][] | undefined;

    if (cached) {
      points = cached.points;
      colors = cached.colors;
    } else {
      const result = await runPythonExtractPoints(scan.filePath);
      points = result.points;
      colors = result.colors;
      addToCache(id, points, colors);
    }

    if (format === "binary") {
      const numPoints = points.length;
      const hasColors = colors && colors.length === numPoints ? 1 : 0;
      const headerSize = 5;
      const pointsSize = numPoints * 3 * 4;
      const colorsSize = hasColors ? numPoints * 3 * 4 : 0;
      const totalSize = headerSize + pointsSize + colorsSize;

      const buffer = Buffer.alloc(totalSize);
      let offset = 0;

      buffer.writeUInt32LE(numPoints, offset); offset += 4;
      buffer.writeUInt8(hasColors, offset); offset += 1;

      for (let i = 0; i < numPoints; i++) {
        buffer.writeFloatLE(points[i][0], offset); offset += 4;
        buffer.writeFloatLE(points[i][1], offset); offset += 4;
        buffer.writeFloatLE(points[i][2], offset); offset += 4;
      }

      if (hasColors && colors) {
        for (let i = 0; i < numPoints; i++) {
          buffer.writeFloatLE(colors[i][0], offset); offset += 4;
          buffer.writeFloatLE(colors[i][1], offset); offset += 4;
          buffer.writeFloatLE(colors[i][2], offset); offset += 4;
        }
      }

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", totalSize);
      res.send(buffer);
    } else {
      res.json({ points, colors });
    }
  } catch (error) {
    console.error("Error extracting points:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `Failed to extract points from scan: ${errorMessage}` });
  }
});
