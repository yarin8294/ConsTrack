import { Card } from "../../components/ui/Card";
import { useScans } from "../../features/scans/hooks/useScans";
import { ScanUploader } from "../../features/scans/components/ScanUploader";
import { ScanList } from "../../features/scans/components/ScanList";

export function UploadComparePage() {
  const { scans } = useScans();

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl font-semibold">Scans</div>
        <div className="text-sm muted">Upload point clouds and manage your scan library.</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1">
          <ScanUploader />
        </div>
        <Card title="Scans" subtitle={`${scans.length} scan${scans.length !== 1 ? "s" : ""}`} className="lg:col-span-2">
          <ScanList />
        </Card>
      </div>
    </div>
  );
}
