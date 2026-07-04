import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { RunModel } from "../models.js";

export const router = Router();

router.post("/chat", authenticateToken, async (req, res) => {
  const prompt = String(req.body?.prompt || "");
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Gemini API key not configured" });
  }

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{
                text: `You are an expert construction progress assistant for a building project tracking system called Construction Tracker. The system tracks construction progress using point cloud scans and provides insights through comparisons, reports, and AI recommendations.

Key Features and Pages:
- Dashboard: Displays overall progress percentage, volume change in cubic meters, forecast completion date, productivity index, and AI-generated recommendations for optimization.
- Scans (Upload/Compare Page): Upload point cloud files (PLY, LAS, LAZ, E57 formats), select two scans (t1 and t2) for comparison to calculate volume differences.
- Areas: Manage hierarchical project structure including site, floors, wings, and zones. Link scans to specific zones for targeted analysis.
- Compare: Run detailed comparisons between selected scans to generate KPIs, forecasts, and progress metrics.
- Reports: Generate and download professional PDF and Excel reports from comparison runs, including volume data and progress summaries.
- Schedule: Sync project schedules from MS Project or Primavera, and maintain a work diary for tracking activities.
- Chat: Access history of conversations with the AI assistant for ongoing support.
- Authentication: Secure login, registration, and password recovery pages.

You help users understand construction progress, analyze scan data, provide insights on delays, suggest optimizations, answer questions about the project features, and guide them through using the application. Always be helpful, accurate, and professional. Respond based on the user's query: ${prompt}`
              }],
            },
          ],
        }),
      }
    );

    const json = await r.json();
    const candidate = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidate) throw new Error(json?.error?.message || "No response from Gemini");
    res.json({ reply: candidate });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.get("/recommendations", authenticateToken, async (req, res) => {
  const projectId = String(req.query.projectId || "");
  const apiKey = process.env.GEMINI_API_KEY;
  const latest = await RunModel.findOne({ projectId, status: "done" }).sort({ createdAtISO: -1 }).lean();

  if (!latest) return res.json({ recommendations: ["Run a comparison to generate recommendations."] });

  if (!apiKey) {
    return res.json({
      recommendations: [
        "Enable Gemini by setting GEMINI_API_KEY to get AI recommendations.",
        `Latest progress is ${(latest.completionPctDelta ?? latest.overallProgressPct ?? 0).toFixed(1)}% with volume delta ${latest.volumeChangeM3?.toFixed(2) ?? 0} m³.`,
      ],
    });
  }

  const prompt = [
    "You are a construction scheduler and progress analyst. Provide concise recommendations (max 3 bullets) for the project team.",
    `Latest run overall progress: ${(latest.completionPctDelta ?? latest.overallProgressPct ?? 0).toFixed(1)}%.`,
    `Volume change: ${latest.volumeChangeM3?.toFixed(2) ?? 0} m3.`,
    `Forecast completion: ${latest.forecastCompletionISO || "n/a"}.`,
    `Alignment confidence: ${latest.alignmentConfidence}.`,
    "Keep each bullet under 120 characters.",
  ].join("\n");

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    const json = await r.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const lines = text
      .split(/\n|•|-|\*/g)
      .map((l: string) => l.trim())
      .filter(Boolean)
      .slice(0, 3);
    if (!lines.length) lines.push("No recommendations available.");
    res.json({ recommendations: lines });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
