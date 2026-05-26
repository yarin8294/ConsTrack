import { useNavigate } from "react-router-dom";
import { useScans } from "../hooks/useScans";
import { ScanCard } from "./ScanCard";

export function ScanList() {
  const { scans, isLoading, selectedT1, selectedT2, removeScan, setSelectedT1, setSelectedT2 } = useScans();
  const navigate = useNavigate();

  if (isLoading) {
    return <div className="text-sm muted">Loading scans…</div>;
  }

  if (scans.length === 0) {
    return <div className="text-sm muted">No scans yet. Upload your first scan above.</div>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {scans.map((scan) => (
        <ScanCard
          key={scan.id}
          scan={scan}
          isT1={selectedT1 === scan.id}
          isT2={selectedT2 === scan.id}
          onSelectAsT1={setSelectedT1}
          onSelectAsT2={setSelectedT2}
          onDelete={(id) => void removeScan(id)}
          onView3D={(id) => { setSelectedT2(id); navigate("/model"); }}
        />
      ))}
    </div>
  );
}
