import { useNavigate } from "react-router-dom";
import { useScans } from "../hooks/useScans";
import { formatDate } from "../../../app/format";

export function ScanList() {
  const { scans, isLoading, removeScan } = useScans();
  const navigate = useNavigate();

  if (isLoading) {
    return <div className="text-sm muted">Loading scans…</div>;
  }

  if (scans.length === 0) {
    return <div className="text-sm muted">No scans yet. Upload your first scan above.</div>;
  }

  return (
    <div className="divide-y divide-app">
      {scans.map((scan) => (
        <div key={scan.id} className="flex items-center gap-3 py-3">
          <span className="text-xl select-none">📁</span>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm truncate">{scan.name}</div>
            <div className="text-xs muted">{formatDate(scan.capturedAtISO)}</div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              className="rounded-lg border border-app px-3 py-1.5 text-xs bg-app hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              onClick={() => navigate("/model")}
            >
              View 3D
            </button>
            <button
              className="rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
              onClick={() => void removeScan(scan.id)}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
