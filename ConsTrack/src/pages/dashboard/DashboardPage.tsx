// Dashboard — KPI tiles, progress trend chart, and navigation shortcuts.
import { useMemo } from "react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { useNavigate } from "react-router-dom";
import { useAppData } from "../../app/data/useAppData";

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-app surface-2 p-4">
      <div className="text-sm muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs muted">{hint}</div>}
    </div>
  );
}

export function DashboardPage() {
  const nav = useNavigate();
  const { data, dashboard } = useAppData();
  const latest = data.runs[0];

  // TODO: backend /api/dashboard endpoint should return completionPctDelta/etaISO directly — frontend fallback to runs[0] is a stopgap
  const completionValue = latest?.completionPctDelta ?? dashboard.overallProgressPct;
  const overall = completionValue !== undefined ? `${completionValue.toFixed(1)}%` : "—";
  const volumeChange =
    dashboard.volumeChangeM3 !== undefined
      ? `${dashboard.volumeChangeM3.toFixed(3)} m³`
      : "—";
  const forecastISO = latest?.etaISO ?? dashboard.forecastCompletionISO;
  const forecast = forecastISO
    ? (() => {
        const d = new Date(forecastISO);
        return isNaN(d.getTime())
          ? "—"
          : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
      })()
    : "—";
  const productivity =
    dashboard.productivityIndex !== undefined && dashboard.productivityIndex !== null
      ? dashboard.productivityIndex.toFixed(2)
      : "—";

  const trendPath = useMemo(() => {
    const series = dashboard.series || [];
    if (!series.length) return "";
    const values = series.map((p) => p.progressPct);
    const max = Math.max(100, ...values);
    const min = Math.min(0, ...values);
    const range = Math.max(1, max - min);
    const width = 320;
    const height = 80;
    return series
      .map((p, i) => {
        const x = (i / Math.max(1, series.length - 1)) * width;
        const y = height - ((p.progressPct - min) / range) * height;
        return `${i === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");
  }, [dashboard.series]);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl font-semibold">Overview</div>
        <div className="text-sm muted">
          Decision support summary based on the latest comparison run.
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Completion" value={overall} hint="Completion percentage" />
        <Kpi label="Volume change" value={volumeChange} hint="Between baseline and latest scan" />
        <Kpi label="Forecast completion date" value={forecast} hint="Estimated project finish" />
        <Kpi label="Productivity index" value={productivity} hint="Higher is better" />
      </div>

      {/* Progress trend on the left, navigation shortcuts on the right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Progress trend" subtitle="Overall progress % over time" className="lg:col-span-2">
          {trendPath ? (
            <div className="space-y-2">
              <svg viewBox="0 0 320 80" className="w-full max-h-28">
                <path d={trendPath} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
              </svg>
              <div className="text-xs muted">Shows overall progress % over comparison runs.</div>
            </div>
          ) : (
            <div className="text-sm muted">Run a comparison to see the progress chart.</div>
          )}
        </Card>

        <div className="flex flex-col gap-3 justify-center">
          <Button onClick={() => nav("/statistics")}>
            View statistics →
          </Button>
          <Button variant="secondary" onClick={() => nav("/reports")}>
            View reports →
          </Button>
        </div>
      </div>
    </div>
  );
}
