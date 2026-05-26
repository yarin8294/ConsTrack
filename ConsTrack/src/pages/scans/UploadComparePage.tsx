import { Card } from "../../components/ui/Card";
import { Select } from "../../components/ui/Select";
import { useScans } from "../../features/scans/hooks/useScans";
import { ScanUploader } from "../../features/scans/components/ScanUploader";
import { ScanList } from "../../features/scans/components/ScanList";

export function UploadComparePage() {
  const { scans, selectedT1, selectedT2, setSelectedT1, setSelectedT2 } = useScans();

  // Clear stale selections if the scan was deleted
  if (selectedT1 && !scans.some((s) => s.id === selectedT1)) setSelectedT1(undefined);
  if (selectedT2 && !scans.some((s) => s.id === selectedT2)) setSelectedT2(undefined);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl font-semibold">Scans</div>
        <div className="text-sm muted">Upload point clouds (t₁ and t₂) and select which scans to compare.</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1">
          <ScanUploader />
        </div>
        <Card title="Active selection" subtitle="Choose scans for comparison" className="lg:col-span-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select label="t₁ scan" value={selectedT1 ?? ""} onChange={(e) => setSelectedT1(e.target.value || undefined)}>
              <option value="">Select…</option>
              {scans.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({new Date(s.capturedAtISO).toLocaleDateString()})</option>
              ))}
            </Select>
            <Select label="t₂ scan" value={selectedT2 ?? ""} onChange={(e) => setSelectedT2(e.target.value || undefined)}>
              <option value="">Select…</option>
              {scans.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({new Date(s.capturedAtISO).toLocaleDateString()})</option>
              ))}
            </Select>
          </div>
          <div className="mt-4 text-sm muted">Tip: t₁ should be the earlier scan and t₂ the later scan.</div>
        </Card>
      </div>

      <Card title="Scan library" subtitle={`${scans.length} scans`}>
        <ScanList />
      </Card>
    </div>
  );
}
