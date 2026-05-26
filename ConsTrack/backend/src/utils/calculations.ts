import { ZoneModel, type ZoneDoc } from "../models.js";

export function pickConfidence(volumeChange: number): "high" | "medium" | "low" {
  const mag = Math.abs(volumeChange);
  if (mag < 1) return "high";
  if (mag < 10) return "medium";
  return "low";
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
