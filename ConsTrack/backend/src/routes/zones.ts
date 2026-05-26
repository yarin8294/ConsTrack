import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { ZoneModel } from "../models.js";

export const router = Router();

router.get("/", authenticateToken, async (req, res) => {
  const projectId = String(req.query.projectId || "");
  const zones = await ZoneModel.find({ projectId }).lean();
  res.json(
    zones.map((z) => ({
      id: String(z._id),
      projectId: z.projectId,
      name: z.name,
      type: z.type,
      parentId: z.parentId,
      completionPct: z.completionPct ?? 0,
      linkedScanIds: z.linkedScanIds || [],
    }))
  );
});

router.post("/", authenticateToken, async (req, res) => {
  const projectId = String(req.body?.projectId || "");
  const name = String(req.body?.name || "").trim();
  const type = String(req.body?.type || "").trim();
  const parentId = req.body?.parentId ? String(req.body.parentId) : undefined;
  if (!name) return res.status(400).json({ error: "name is required" });
  if (!type) return res.status(400).json({ error: "type is required" });

  const created = await ZoneModel.create({
    projectId,
    name,
    type,
    parentId,
    completionPct: 0,
    linkedScanIds: [],
    createdAtISO: new Date().toISOString(),
  });
  res.json({
    id: String(created._id),
    projectId,
    name,
    type,
    parentId,
    completionPct: 0,
    linkedScanIds: [],
  });
});

router.patch("/:id", authenticateToken, async (req, res) => {
  const id = String(req.params.id);
  const patch: Record<string, unknown> = {};
  if (typeof req.body?.name === "string") patch.name = req.body.name;
  if (typeof req.body?.completionPct === "number") patch.completionPct = req.body.completionPct;
  if (Array.isArray(req.body?.linkedScanIds)) {
    patch.linkedScanIds = (req.body.linkedScanIds as unknown[])
      .map((x) => String(x))
      .filter((v) => !!v);
  }
  const z = await ZoneModel.findByIdAndUpdate(id, patch, { new: true }).lean();
  if (!z) return res.status(404).json({ error: "not found" });
  res.json({
    id: String(z._id),
    projectId: z.projectId,
    name: z.name,
    type: z.type,
    parentId: z.parentId,
    completionPct: z.completionPct ?? 0,
    linkedScanIds: z.linkedScanIds || [],
  });
});

router.delete("/:id", authenticateToken, async (req, res) => {
  const id = String(req.params.id);
  const root = await ZoneModel.findById(id).lean();
  if (!root) return res.status(404).json({ error: "not found" });
  const projectId = String(root.projectId);

  const zones = await ZoneModel.find({ projectId }).lean();
  const childrenByParent = new Map<string, string[]>();
  for (const z of zones) {
    const pid = z.parentId ? String(z.parentId) : "";
    if (!pid) continue;
    const arr = childrenByParent.get(pid) || [];
    arr.push(String(z._id));
    childrenByParent.set(pid, arr);
  }

  const toRemove = new Set<string>();
  const collect = (cur: string) => {
    toRemove.add(cur);
    for (const c of childrenByParent.get(cur) || []) collect(c);
  };
  collect(id);

  await ZoneModel.deleteMany({ _id: { $in: Array.from(toRemove) }, projectId });
  res.json({ ok: true, removed: Array.from(toRemove) });
});
