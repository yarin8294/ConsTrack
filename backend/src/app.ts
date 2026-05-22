import "dotenv/config";
import path from "path";
import fs from "fs";
import express from "express";
import cors from "cors";

import { sendTestEmail, FROM_EMAIL, FROM_NAME } from "./services/email.js";
import { router as authRouter } from "./routes/auth.js";
import { router as projectsRouter } from "./routes/projects.js";
import { router as zonesRouter } from "./routes/zones.js";
import { router as scansRouter } from "./routes/scans.js";
import { router as runsRouter } from "./routes/runs.js";
import { router as dashboardRouter } from "./routes/dashboard.js";
import { router as reportsRouter } from "./routes/reports.js";
import { router as aiRouter } from "./routes/ai.js";
import { router as scheduleRouter } from "./routes/schedule.js";

const REPORTS_DIR = path.join(path.resolve(process.cwd()), "reports");
fs.mkdirSync(REPORTS_DIR, { recursive: true });

export function createApp() {
  const app = express();

  app.use(cors({
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
  }));
  app.use(express.json({ limit: "2mb" }));

  app.use("/downloads/reports", express.static(REPORTS_DIR));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRouter);

  app.post("/api/test-email", async (req, res) => {
    try {
      const { to } = req.body;
      const messageId = await sendTestEmail(to || "test@example.com");
      res.json({ message: "Test email sent", id: messageId });
    } catch (e: any) {
      console.error("Test email error:", e);
      res.status(500).json({ error: String(e?.message || e?.body?.message || e) });
    }
  });

  app.get("/api/debug-email", (_req, res) => {
    res.json({
      ok: true,
      config: {
        provider: "Brevo",
        apiKeySet: !!process.env.BREVO_API_KEY,
        fromEmail: FROM_EMAIL,
        fromName: FROM_NAME,
      },
      message: "Brevo configuration loaded",
    });
  });

  app.use("/api/projects", projectsRouter);
  app.use("/api/zones", zonesRouter);
  app.use("/api/scans", scansRouter);
  app.use("/api/runs", runsRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/reports", reportsRouter);

  // AI and schedule are mounted at /api so their internal paths match the original URLs
  app.use("/api", aiRouter);
  app.use("/api", scheduleRouter);

  return app;
}
