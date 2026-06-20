import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { useAppData } from "../../app/data/useAppData";
import { useRealtime } from "../../app/realtime/useRealtime";
import { formatDate } from "../../app/format";

function ConfidenceBadge({ v }: { v: string }) {
  const cls = v === "high"
    ? "bg-emerald-400 text-zinc-900"
    : v === "medium"
    ? "bg-amber-400 text-zinc-900"
    : "bg-red-400 text-zinc-900";
  return <span className={["text-xs px-2 py-1 rounded-full", cls].join(" ")}>{v}</span>;
}

export function ComparePage() {
  const nav = useNavigate();
  const { data, runComparison } = useAppData();
  const { subscribe } = useRealtime();
  const t1 = data.scans.find((s) => s.id === data.selectedT1);
  const t2 = data.scans.find((s) => s.id === data.selectedT2);
  const latest = data.runs[0];

  const [targetVolumeM3, setTargetVolumeM3] = useState<number>(25);
  const validTarget = targetVolumeM3 > 0 && isFinite(targetVolumeM3);
  const canRun = !!t1 && !!t2 && t1.id !== t2.id;

  // pct=null means no run in progress; pct=0..100 means actively running.
  const [runPct, setRunPct] = useState<number | null>(null);

  // Restore the "running" indicator after a page refresh: the backend run keeps
  // going regardless of the browser, but the local runPct state above resets to
  // null on reload. Without this, the button would look clickable again even
  // though a run is still in flight (the server-side guard in runs.ts blocks a
  // second run either way, but this keeps the UI honest about it).
  useEffect(() => {
    if (latest?.status === "processing" || latest?.status === "queued") {
      setRunPct((prev) => (prev !== null ? prev : 0));
    }
  }, [latest?.status]);

  useEffect(() => {
    const unsubProgress = subscribe("run.progress", (msg) => {
      setRunPct(msg.pct ?? 0);
    });
    const unsubDone = subscribe("run.done", () => {
      // Hold at 100% briefly so the bar completes visually, then hide it.
      setRunPct(100);
      setTimeout(() => setRunPct(null), 1200);
    });
    return () => { unsubProgress(); unsubDone(); };
  }, [subscribe]);

  const leafAreaCount = useMemo(() => data.areas.filter((a) => a.type === "zone").length, [data.areas]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold">Compare</div>
          <div className="text-sm muted">Run a comparison between t₁ and t₂ and generate KPIs + forecasts.</div>
        </div>
        <Button className="w-auto" variant="secondary" onClick={() => nav("/reports")}>Reports</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card title="Inputs" subtitle="Select scans + areas">
          <div className="space-y-3 text-sm">
            <div>
              <div className="muted">t₁</div>
              <div className="font-medium">{t1 ? t1.name : "Not selected"}</div>
            </div>
            <div>
              <div className="muted">t₂</div>
              <div className="font-medium">{t2 ? t2.name : "Not selected"}</div>
            </div>
            <div>
              <div className="muted">Defined leaf areas</div>
              <div className="font-medium">{leafAreaCount}</div>
            </div>

            <div className="pt-2 flex gap-2">
              <Button className="w-auto" variant="secondary" onClick={() => nav("/scans")}>Manage scans</Button>
              <Button className="w-auto" variant="secondary" onClick={() => nav("/areas")}>Manage zones</Button>
            </div>
          </div>
        </Card>

        <Card title="Run" subtitle="Compute volume delta + progress">
          <div className="text-sm muted">
            Runs an async backend job (Python) to compute volume(T1), volume(T2), ΔV, and progress metrics.
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <Input
                label="Target volume (m³)"
                type="number"
                step="0.1"
                min="0.1"
                value={targetVolumeM3}
                onChange={(e) => setTargetVolumeM3(e.target.valueAsNumber)}
              />
              <div className="mt-1 text-xs muted">
                Project scope baseline. Used for completion % and ETA.
              </div>
            </div>

            <div>
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
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between text-xs muted">
                    <span>
                      {runPct < 8  ? "Initialising…"
                      : runPct < 15 ? "Measuring baseline volume…"
                      : runPct < 55 ? "Aligning scans…"
                      : runPct < 85 ? "Detecting changes…"
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
                <div className="mt-2 text-xs text-red-400">
                  Select two different scans (t₁ and t₂) first.
                </div>
              )}
              {canRun && !validTarget && (
                <div className="mt-2 text-xs text-red-400">
                  Target volume must be a positive number.
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card title="Latest output" subtitle={latest ? formatDate(latest.createdAtISO) : "No runs yet"}>
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
                  {latest.completionPctDelta !== undefined ? `${latest.completionPctDelta.toFixed(1)}%` : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="muted">Days elapsed</span>
                <span className="font-semibold">
                  {latest.daysElapsed !== undefined ? latest.daysElapsed : "—"}
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
                          : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
                      })()
                    : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="muted">Gross added volume</span>
                <span className="font-semibold">
                  {latest.volumeChangeM3 !== undefined ? `${latest.volumeChangeM3.toFixed(3)} m³` : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="muted">New construction</span>
                <span className="font-semibold">
                  {latest.newConstructionM3 !== undefined ? `${latest.newConstructionM3.toFixed(3)} m³` : "—"}
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
              <div className="pt-2">
                <Button className="w-full" variant="secondary" onClick={() => nav("/reports")}>Open report</Button>
              </div>
            </div>
          )}
        </Card>

        <Card title="Analysis detail" subtitle={latest?.status === "done" ? "Full pipeline results" : "Run a comparison first"}>
          {!latest || latest.status !== "done" ? (
            <div className="text-sm muted">Results will appear here after a successful run.</div>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="text-xs font-semibold muted uppercase tracking-wide">Scan alignment</div>
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

              <div className="border-t border-app pt-3 text-xs font-semibold muted uppercase tracking-wide">Volume changes</div>
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
  );
}
