// Compare page — scan selector, target volume input, run trigger, and latest output metrics.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { useAppData } from "../../app/data/useAppData";
import { useRealtime } from "../../app/realtime/useRealtime";
import { formatDate } from "../../app/format";

function ConfidenceBadge({ v }: { v: string }) {
  const cls =
    v === "high"
      ? "bg-emerald-400 text-zinc-900"
      : v === "medium"
      ? "bg-amber-400 text-zinc-900"
      : "bg-red-400 text-zinc-900";
  return <span className={["text-xs px-2 py-1 rounded-full", cls].join(" ")}>{v}</span>;
}

export function ComparePage() {
  const nav = useNavigate();
  const { data, reports, runComparison, setSelectedT1, setSelectedT2, generateReportForRun } = useAppData();
  const { subscribe } = useRealtime();

  const t1 = data.scans.find((s) => s.id === data.selectedT1);
  const t2 = data.scans.find((s) => s.id === data.selectedT2);
  const latest = data.runs[0];

  const [targetVolumeM3, setTargetVolumeM3] = useState<number>(25);
  const validTarget = targetVolumeM3 > 0 && isFinite(targetVolumeM3);
  const canRun = !!t1 && !!t2 && t1.id !== t2.id;

  // pct=null means no run in progress; pct=0..100 means actively running.
  const [runPct, setRunPct] = useState<number | null>(null);

  const [reportCreating, setReportCreating] = useState(false);
  const [reportCreated, setReportCreated] = useState<string | null>(null); // runId of last created
  const [reportError, setReportError] = useState<string | null>(null);

  // Restore the "running" indicator after a page refresh.
  useEffect(() => {
    if (latest?.status === "processing" || latest?.status === "queued") {
      setRunPct((prev) => (prev !== null ? prev : 0));
    }
  }, [latest?.status]);

  // Keep the progress bar in sync with backend SSE events while a run is active.
  useEffect(() => {
    const unsubProgress = subscribe("run.progress", (msg) => {
      setRunPct(msg.pct ?? 0);
    });
    const unsubDone = subscribe("run.done", () => {
      setRunPct(100);
      setTimeout(() => setRunPct(null), 1200);
    });
    return () => {
      unsubProgress();
      unsubDone();
    };
  }, [subscribe]);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl font-semibold">Compare</div>
        <div className="text-sm muted">
          Select two scans and run a comparison to generate KPIs + forecasts.
        </div>
      </div>

      {/* Left/Right split: 30% input panel, 70% results panel */}
      <div className="flex flex-col lg:flex-row gap-4">

        {/* ── Left: Input panel (30%) ── */}
        <div className="w-full lg:w-[30%] shrink-0 flex flex-col">
          <Card title="Configure run" subtitle="Scan selection + parameters" className="flex-1">
            <div className="space-y-5">
              {/* Scan selectors */}
              <div className="space-y-3">
                <Select
                  label="t₁ baseline scan"
                  value={data.selectedT1 ?? ""}
                  onChange={(e) => setSelectedT1(e.target.value || undefined)}
                >
                  <option value="">Select…</option>
                  {data.scans.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({new Date(s.capturedAtISO).toLocaleDateString()})
                    </option>
                  ))}
                </Select>
                <Select
                  label="t₂ later scan"
                  value={data.selectedT2 ?? ""}
                  onChange={(e) => setSelectedT2(e.target.value || undefined)}
                >
                  <option value="">Select…</option>
                  {data.scans.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({new Date(s.capturedAtISO).toLocaleDateString()})
                    </option>
                  ))}
                </Select>
                {data.selectedT1 && data.selectedT2 && data.selectedT1 === data.selectedT2 && (
                  <div className="text-xs text-red-400">t₁ and t₂ must be different scans.</div>
                )}
                <div className="text-xs muted">t₁ = earlier scan, t₂ = later scan.</div>
              </div>

              <div className="border-t border-app" />

              {/* Target volume + run button */}
              <div className="space-y-3">
                <Input
                  label="Target volume (m³)"
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={targetVolumeM3}
                  onChange={(e) => setTargetVolumeM3(e.target.valueAsNumber)}
                />
                <div className="text-xs muted">Scope baseline for completion % and ETA.</div>

                <Button
                  disabled={!canRun || !validTarget || runPct !== null}
                  onClick={() => {
                    setRunPct(0);
                    void runComparison({ targetVolumeM3 }).catch(() => setRunPct(null));
                  }}
                >
                  {runPct !== null ? "Running…" : "Run comparison"}
                </Button>

                {runPct !== null && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs muted">
                      <span>
                        {runPct < 8
                          ? "Initialising…"
                          : runPct < 15
                          ? "Measuring baseline…"
                          : runPct < 55
                          ? "Aligning scans…"
                          : runPct < 85
                          ? "Detecting changes…"
                          : "Finalising…"}
                      </span>
                      <span>{runPct}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-zinc-700 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-green-400 transition-all duration-500"
                        style={{ width: `${runPct}%` }}
                      />
                    </div>
                  </div>
                )}

                {!canRun && runPct === null && (
                  <div className="text-xs text-red-400">Select two different scans first.</div>
                )}
                {canRun && !validTarget && (
                  <div className="text-xs text-red-400">Target volume must be a positive number.</div>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* ── Right: Results panel (70%) ── */}
        <div className="w-full lg:w-[70%] flex flex-col">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">

            {/* Latest output */}
            <Card
              title="Latest output"
              subtitle={latest ? formatDate(latest.createdAtISO) : "No runs yet"}
              className="h-full"
            >
              {!latest ? (
                <div className="text-sm muted">Run a comparison to generate outputs.</div>
              ) : (
                <div className="space-y-3 text-sm">
                  {latest.status && latest.status !== "done" && (
                    <div className="rounded-xl border border-app surface-2 p-3 text-app">
                      Status: <span className="font-semibold">{latest.status}</span>
                      {latest.status === "failed" && latest.error ? (
                        <div className="mt-2 text-xs text-red-400">{latest.error}</div>
                      ) : null}
                    </div>
                  )}
                  {latest.task43Error && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-400">
                      Metrics warning: {latest.task43Error}
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="muted">Completion</span>
                    <span className="font-semibold">
                      {latest.completionPctDelta !== undefined
                        ? `${latest.completionPctDelta.toFixed(1)}%`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="muted">Days elapsed</span>
                    <span className="font-semibold">
                      {latest.daysElapsed !== undefined ? Math.round(latest.daysElapsed) : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="muted">Progress rate</span>
                    <span className="font-semibold">
                      {latest.progressRateM3PerDay !== undefined
                        ? `${latest.progressRateM3PerDay.toFixed(3)} m³/day`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="muted">ETA</span>
                    <span className="font-semibold">
                      {latest.etaISO
                        ? (() => {
                            const d = new Date(latest.etaISO);
                            return isNaN(d.getTime())
                              ? "—"
                              : d.toLocaleDateString(undefined, {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                });
                          })()
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="muted">Gross added volume</span>
                    <span className="font-semibold">
                      {latest.volumeChangeM3 !== undefined
                        ? `${latest.volumeChangeM3.toFixed(3)} m³`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="muted">New construction</span>
                    <span className="font-semibold">
                      {latest.newConstructionM3 !== undefined
                        ? `${latest.newConstructionM3.toFixed(3)} m³`
                        : "—"}
                    </span>
                  </div>
                  {latest.displacementM3 !== undefined && latest.displacementM3 > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="muted">Displacement</span>
                      <span className="font-semibold">{latest.displacementM3.toFixed(3)} m³</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="muted">Alignment confidence</span>
                    <ConfidenceBadge v={latest.alignmentConfidence} />
                  </div>
                  {latest.volumeBasis && (
                    <div className="flex items-center justify-between">
                      <span className="muted">Volume basis</span>
                      <span className="text-xs muted font-mono">{latest.volumeBasis}</span>
                    </div>
                  )}
                  <div className="pt-2 space-y-2">
                    {(() => {
                      const existingReport = reports.find((r) => r.runId === latest?.id);
                      const justCreated = reportCreated === latest?.id;
                      if (existingReport || justCreated) {
                        return (
                          <Button className="w-full" onClick={() => nav("/reports")}>
                            View in report library →
                          </Button>
                        );
                      }
                      return (
                        <>
                          <Button
                            className="w-full"
                            variant="secondary"
                            disabled={reportCreating}
                            onClick={async () => {
                              if (!latest?.id) return;
                              setReportCreating(true);
                              setReportError(null);
                              try {
                                await generateReportForRun(latest.id);
                                setReportCreated(latest.id);
                              } catch (e: any) {
                                setReportError(e?.message ?? "Report generation failed");
                              } finally {
                                setReportCreating(false);
                              }
                            }}
                          >
                            {reportCreating ? "Creating…" : "Create report"}
                          </Button>
                          {reportError && (
                            <div className="text-xs text-red-400 text-center">{reportError}</div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}
            </Card>

            {/* Analysis detail */}
            <Card
              title="Analysis detail"
              subtitle={latest?.status === "done" ? "Full pipeline results" : "Run a comparison first"}
              className="h-full"
            >
              {!latest || latest.status !== "done" ? (
                <div className="text-sm muted">Results will appear here after a successful run.</div>
              ) : (
                <div className="space-y-3 text-sm">
                  <div className="text-xs font-semibold muted uppercase tracking-wide">
                    Scan alignment
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="muted">Overlap quality</span>
                    <span className="font-semibold">
                      {latest.fitness != null ? `${(latest.fitness * 100).toFixed(1)}%` : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="muted">Alignment error</span>
                    <span className="font-semibold">
                      {latest.rmseCm != null ? `${latest.rmseCm.toFixed(1)} cm` : "—"}
                    </span>
                  </div>
                  <div className="border-t border-app pt-3 text-xs font-semibold muted uppercase tracking-wide">
                    Volume changes
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="muted">Added volume</span>
                    <span className="font-semibold text-emerald-400">
                      +{(latest.addedVolumeM3 ?? 0).toFixed(3)} m³
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="muted">Removed volume</span>
                    <span className="font-semibold text-red-400">
                      −{(latest.removedVolumeM3 ?? 0).toFixed(3)} m³
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="muted">New elements</span>
                    <span className="font-semibold">{latest.addedElementCount ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="muted">Removed elements</span>
                    <span className="font-semibold">{latest.removedElementCount ?? "—"}</span>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
