import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { useNavigate } from "react-router-dom";
import { useAppData } from "../../app/data/useAppData";
import { formatDate } from "../../app/format";

function MetricRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-app/40 last:border-0">
      <span className="text-sm muted">{label}</span>
      <span className={["text-sm font-semibold", accent ?? ""].join(" ")}>{value}</span>
    </div>
  );
}

export function StatisticsPage() {
  const nav = useNavigate();
  const { data } = useAppData();
  const latest = data.runs[0];

  const etaDisplay = latest?.etaISO
    ? (() => {
        const d = new Date(latest.etaISO);
        return isNaN(d.getTime())
          ? "—"
          : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
      })()
    : "—";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold">Statistics</div>
          <div className="text-sm muted">Detailed run breakdown and zone progress.</div>
        </div>
        <Button className="w-auto" variant="secondary" onClick={() => nav("/dashboard")}>
          ← Overview
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Latest run — zone heat list */}
        <Card
          title="Latest run"
          subtitle={latest ? `Created: ${formatDate(latest.createdAtISO)}` : "No runs yet"}
          className="lg:col-span-2"
          right={
            <Button className="w-auto" variant="secondary" onClick={() => nav("/reports")}>
              View reports
            </Button>
          }
        >
          {!latest ? (
            <div className="text-sm muted">
              Select two scans (t₁, t₂) and run a comparison to see results.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="muted">t₁ scan</div>
                  <div className="font-medium">
                    {data.scans.find((s) => s.id === latest.t1ScanId)?.name ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="muted">t₂ scan</div>
                  <div className="font-medium">
                    {data.scans.find((s) => s.id === latest.t2ScanId)?.name ?? "—"}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-app surface-2 p-3">
                <div className="text-sm muted mb-2">Progress by zone</div>
                {latest.metricsByArea.length === 0 ? (
                  <div className="text-sm muted">No zone data available.</div>
                ) : (
                  <div className="space-y-2">
                    {latest.metricsByArea.slice(0, 6).map((m) => {
                      const areaName =
                        data.areas.find((a) => a.id === m.areaId)?.name ?? `Zone ${m.areaId}`;
                      return (
                        <div key={m.areaId} className="flex items-center gap-3">
                          <div className="w-40 truncate text-sm">{areaName}</div>
                          <ProgressBar
                            value={m.progressPct}
                            color="accent"
                            showValue={false}
                            className="flex-1"
                          />
                          <div className="w-12 text-right text-sm muted">{m.progressPct}%</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* Setup checklist */}
        <Card title="Setup checklist" subtitle="Status">
          <div className="space-y-1 text-sm">
            <MetricRow
              label="Scans uploaded"
              value={data.scans.length ? `${data.scans.length} scans` : "Missing"}
              accent={data.scans.length ? "text-emerald-400" : "muted"}
            />
            <MetricRow
              label="t₁ + t₂ selected"
              value={data.selectedT1 && data.selectedT2 ? "Done" : "Missing"}
              accent={data.selectedT1 && data.selectedT2 ? "text-emerald-400" : "muted"}
            />
            <MetricRow
              label="Zones defined"
              value={data.areas.some((a) => a.type === "zone") ? "Done" : "Optional"}
              accent={data.areas.some((a) => a.type === "zone") ? "text-emerald-400" : "muted"}
            />
            <MetricRow
              label="Comparison run"
              value={latest ? "Done" : "Missing"}
              accent={latest ? "text-emerald-400" : "muted"}
            />
            <div className="pt-3">
              <Button className="w-full" onClick={() => nav("/compare")}>
                Go to Compare
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Detailed metrics from latest run */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Progress metrics" subtitle={latest ? "From latest run" : "No run data"}>
          {!latest ? (
            <div className="text-sm muted">Run a comparison to see progress metrics.</div>
          ) : (
            <div>
              <MetricRow
                label="Completion"
                value={latest.completionPctDelta !== undefined ? `${latest.completionPctDelta.toFixed(1)}%` : "—"}
              />
              <MetricRow
                label="Days elapsed"
                value={latest.daysElapsed !== undefined ? `${Math.round(latest.daysElapsed)} days` : "—"}
              />
              <MetricRow
                label="New construction"
                value={latest.newConstructionM3 !== undefined ? `${latest.newConstructionM3.toFixed(3)} m³` : "—"}
                accent="text-emerald-400"
              />
              <MetricRow
                label="Net progress"
                value={latest.netProgressM3 !== undefined ? `${latest.netProgressM3.toFixed(3)} m³` : "—"}
              />
              <MetricRow
                label="Progress rate"
                value={latest.progressRateM3PerDay !== undefined ? `${latest.progressRateM3PerDay.toFixed(3)} m³/day` : "—"}
              />
              <MetricRow
                label="Gross rate"
                value={latest.grossRateM3PerDay !== undefined ? `${latest.grossRateM3PerDay.toFixed(3)} m³/day` : "—"}
              />
              {latest.displacementM3 !== undefined && latest.displacementM3 > 0 && (
                <MetricRow
                  label="Displacement"
                  value={`${latest.displacementM3.toFixed(3)} m³`}
                  accent="text-amber-400"
                />
              )}
              <MetricRow
                label="ETA"
                value={etaDisplay}
              />
              <MetricRow
                label="Productivity index"
                value={latest.productivityIndex !== undefined ? latest.productivityIndex.toFixed(2) : "—"}
              />
            </div>
          )}
        </Card>

        <Card title="Pipeline details" subtitle={latest ? "Alignment + volume breakdown" : "No run data"}>
          {!latest ? (
            <div className="text-sm muted">Run a comparison to see pipeline details.</div>
          ) : (
            <div>
              <div className="text-xs font-semibold muted uppercase tracking-wide mb-2">Scan alignment</div>
              <MetricRow
                label="Alignment confidence"
                value={latest.alignmentConfidence ?? "—"}
              />
              <MetricRow
                label="Overlap quality (fitness)"
                value={latest.fitness != null ? `${(latest.fitness * 100).toFixed(1)}%` : "—"}
              />
              <MetricRow
                label="Alignment error (RMSE)"
                value={latest.rmseCm != null ? `${latest.rmseCm.toFixed(1)} cm` : "—"}
              />

              <div className="text-xs font-semibold muted uppercase tracking-wide mt-4 mb-2">Volume breakdown</div>
              <MetricRow
                label="Added volume"
                value={latest.addedVolumeM3 != null ? `+${latest.addedVolumeM3.toFixed(3)} m³` : "—"}
                accent="text-emerald-400"
              />
              <MetricRow
                label="Removed volume"
                value={latest.removedVolumeM3 != null ? `−${latest.removedVolumeM3.toFixed(3)} m³` : "—"}
                accent="text-red-400"
              />
              <MetricRow
                label="Net volume change"
                value={latest.volumeChangeM3 != null ? `${latest.volumeChangeM3.toFixed(3)} m³` : "—"}
              />
              <MetricRow
                label="New elements detected"
                value={latest.addedElementCount != null ? String(latest.addedElementCount) : "—"}
              />
              <MetricRow
                label="Removed elements"
                value={latest.removedElementCount != null ? String(latest.removedElementCount) : "—"}
              />
              {latest.volumeBasis && (
                <MetricRow label="Volume basis" value={latest.volumeBasis} />
              )}
            </div>
          )}
        </Card>

      </div>
    </div>
  );
}
