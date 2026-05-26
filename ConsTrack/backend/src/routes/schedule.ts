import { Router } from "express";

export const router = Router();

router.post("/schedule/sync", async (req, res) => {
  const provider = String(req.body?.provider || "").toLowerCase();
  const token = String(req.body?.token || "").trim();
  const projectId = String(req.body?.projectId || "");
  if (!provider) return res.status(400).json({ error: "provider is required" });
  if (!token) return res.status(400).json({ error: "token is required" });

  const baseTasks = [
    { id: "T-100", name: "Site mobilization", start: "2024-10-01", finish: "2024-10-10", progressPct: 100 },
    { id: "T-200", name: "Excavation", start: "2024-10-11", finish: "2024-11-05", progressPct: 82 },
    { id: "T-300", name: "Substructure", start: "2024-11-06", finish: "2024-12-15", progressPct: 45 },
    { id: "T-400", name: "Superstructure", start: "2024-12-16", finish: "2025-02-20", progressPct: 10 },
  ];

  res.json({
    provider,
    projectId,
    status: "synced",
    fetchedAtISO: new Date().toISOString(),
    tasks: baseTasks.map((t, i) => ({
      ...t,
      providerId: `${provider.toUpperCase()}-${t.id}`,
      owner: i % 2 === 0 ? "GC" : "Subcontractor",
      critical: i < 2,
    })),
  });
});

router.get("/work-diary", async (req, res) => {
  const projectId = String(req.query.projectId || "");
  const entries = [
    {
      id: "WD-1",
      projectId,
      dateISO: new Date().toISOString(),
      crew: "Concrete",
      summary: "Poured podium slab, inspected formwork, minor rebar issue resolved.",
    },
    {
      id: "WD-2",
      projectId,
      dateISO: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      crew: "Earthworks",
      summary: "Completed north excavation, trucked spoil offsite, survey confirmation signed.",
    },
  ];
  res.json({ entries });
});
