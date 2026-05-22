import { useState } from "react";
import { Card } from "../../../components/ui/Card";
import { Input } from "../../../components/ui/Input";
import { Select } from "../../../components/ui/Select";
import { useScans } from "../hooks/useScans";
import { useAppData } from "../../../app/data/useAppData";

export function ScanUploader() {
  const { addScan } = useScans();
  const { data } = useAppData(); // zones list for optional zone linking

  const [capturedAtISO, setCapturedAtISO] = useState(() => new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  return (
    <Card title="Upload scan" subtitle="Metadata only (prototype)">
      <div className="space-y-3">
        <Input
          label="Captured date/time"
          type="datetime-local"
          value={capturedAtISO}
          onChange={(e) => setCapturedAtISO(e.target.value)}
        />
        <label className="block">
          <div className="mb-1 text-sm muted">Notes</div>
          <textarea
            className="w-full rounded-xl border px-3 py-2 text-sm outline-none bg-app text-app border-app focus:border-app resize-none"
            rows={2}
            value={notes}
            placeholder="Optional"
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <Select
          label="Link to zone (optional)"
          value={zoneId}
          onChange={(e) => setZoneId(e.target.value)}
        >
          <option value="">No zone</option>
          {(data.areas || []).map((z) => (
            <option key={z.id} value={z.id}>
              {z.name} ({z.type})
            </option>
          ))}
        </Select>
        <label className="block">
          <div className="mb-1 text-sm muted">Point cloud file</div>
          <div className="mb-2 text-xs text-gray-500">
            Supported: LAS/LAZ (LiDAR point clouds), PLY, E57, PCD, XYZ, CSV
          </div>
          <input
            className="block w-full text-sm text-app file:mr-3 file:rounded-xl file:border file:border-app file:bg-app file:px-3 file:py-2 file:text-sm file:text-app"
            type="file"
            accept=".las,.laz,.ply,.e57,.pcd,.xyz,.txt,.csv"
            disabled={status === "uploading"}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setErrorMsg(null);
              setStatus("uploading");
              try {
                await addScan(
                  f,
                  new Date(capturedAtISO).toISOString(),
                  notes.trim() || undefined,
                  zoneId || undefined
                );
                setStatus("success");
                setNotes("");
                setZoneId("");
                setTimeout(() => setStatus("idle"), 2000);
              } catch (err: any) {
                setErrorMsg(err.message || "Upload failed");
                setStatus("error");
              } finally {
                e.target.value = "";
              }
            }}
          />
          {status === "uploading" && <div className="mt-1 text-xs text-blue-400">Uploading…</div>}
          {status === "success" && <div className="mt-1 text-xs text-green-400">Upload successful</div>}
          {status === "error" && <div className="mt-1 text-xs text-red-400">{errorMsg}</div>}
        </label>
      </div>
    </Card>
  );
}
