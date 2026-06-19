import { ZoneModel, type ZoneDoc } from "../models.js";

// fitness is the ICP inlier ratio (0–1) returned by preprocessor.py.
// Mirrors the thresholds in preprocessor.py::_confidence_label.
export function pickConfidence(fitness: number): "high" | "medium" | "low" {
  if (fitness >= 0.90) return "high";
  if (fitness >= 0.70) return "medium";
  return "low";
}

// Progress as a percentage of how much new volume was added relative to T1 baseline.
// Returns 0 when T1 volume is unknown or zero.
export function calcProgressFromDelta(addedM3: number, t1VolumeM3: number): number {
  if (t1VolumeM3 <= 0) return 0;
  // Capped at 99 instead of 100: when T2 adds far more volume than T1 contains
  // (e.g. comparing a corridor-only scan to one with a full room added), the raw
  // ratio exceeds 100% — which is mathematically correct but misleading, since
  // 100% implies the project is complete. True completion requires knowing the
  // total planned volume, which the system doesn't have. 99 signals significant
  // progress without falsely declaring the project done.
  return Math.max(0, Math.min(99, (addedM3 / t1VolumeM3) * 100));
}

export function forecastDateISO(overallProgressPct: number): string {
  const daysLeft = Math.round((100 - overallProgressPct) * 0.6);
  const d = new Date();
  d.setDate(d.getDate() + Math.max(0, daysLeft));
  return d.toISOString();
}

export function calcOverallProgress(volumeT1: number, volumeT2: number): number {
  if (volumeT1 <= 0 || volumeT2 <= 0) return 0;
  const delta = volumeT2 - volumeT1;
  const pct = (delta / Math.abs(volumeT1)) * 100;
  return Math.max(0, Math.min(100, pct));
}

export async function getLeafZones(projectId: string): Promise<(ZoneDoc & { _id: unknown })[]> {
  const zones = await ZoneModel.find({ projectId }).lean();
  const zoneIds = new Set(zones.map((z) => String(z._id)));
  const hasChild = new Set<string>();
  for (const z of zones) {
    if (z.parentId && zoneIds.has(z.parentId)) hasChild.add(z.parentId);
  }
  return zones.filter((z) => !hasChild.has(String(z._id)));
}
