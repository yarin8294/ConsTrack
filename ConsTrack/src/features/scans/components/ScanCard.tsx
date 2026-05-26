import type { Scan, ScanId } from "../../../app/data/types";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { formatBytes, formatDate } from "../../../app/format";

type Props = {
  scan: Scan;
  isT1: boolean;
  isT2: boolean;
  onSelectAsT1: (id: ScanId) => void;
  onSelectAsT2: (id: ScanId) => void;
  onDelete: (id: ScanId) => void;
  onView3D?: (id: ScanId) => void;
};

export function ScanCard({ scan, isT1, isT2, onSelectAsT1, onSelectAsT2, onDelete, onView3D }: Props) {
  return (
    <Card
      title={scan.name}
      subtitle={`${formatBytes(scan.sizeBytes)} · ${formatDate(scan.capturedAtISO)}`}
      right={
        <div className="flex gap-1">
          {isT1 && <span className="text-xs px-2 py-1 rounded-full bg-zinc-100 text-zinc-900">t₁</span>}
          {isT2 && <span className="text-xs px-2 py-1 rounded-full bg-zinc-100 text-zinc-900">t₂</span>}
        </div>
      }
    >
      <div className="space-y-3">
        {scan.notes && <p className="text-sm text-app">{scan.notes}</p>}
        <div className="flex gap-2 flex-wrap">
          <Button className="w-auto" variant="secondary" onClick={() => onSelectAsT1(scan.id)}>
            Set t₁
          </Button>
          <Button className="w-auto" variant="secondary" onClick={() => onSelectAsT2(scan.id)}>
            Set t₂
          </Button>
          {onView3D && (
            <Button className="w-auto" variant="secondary" onClick={() => onView3D(scan.id)}>
              View 3D
            </Button>
          )}
          <Button className="w-auto" variant="secondary" onClick={() => onDelete(scan.id)}>
            Delete
          </Button>
        </div>
      </div>
    </Card>
  );
}
