import { ZoneModel, type ZoneDoc } from "../models.js";

// ── Task 4.3 types ────────────────────────────────────────────────────────────

export type Task43Input = {
  addedM3: number;
  removedM3: number;
  displacementM3: number;
  t1ISO: string;
  t2ISO: string;
  /** Project scope baseline (from plan). completionPctDelta is 0 when this is 0. */
  targetVolumeM3: number;
  /** If provided, enables productivityIndex in the output. */
  plannedRateM3PerDay?: number;
};

export type Task43Output = {
  daysElapsed: number;
  /** addedM3 - displacementM3, floored at 0. */
  newConstructionM3: number;
  /** newConstructionM3 - demolitionGenuine (can be negative during active demolition). */
  netProgressM3: number;
  /** newConstructionM3 / daysElapsed */
  progressRateM3PerDay: number;
  /** addedM3 / daysElapsed — includes displaced material in the numerator */
  grossRateM3PerDay: number;
  /** newConstructionM3 / targetVolumeM3 × 100, clamped [0, 100] */
  completionPctDelta: number;
  /** progressRateM3PerDay / plannedRateM3PerDay — omitted when plannedRate not supplied */
  productivityIndex?: number;
  /** Single-run linear ETA; omitted when progressRate == 0 or targetVolumeM3 == 0 */
  etaISO?: string;
};

/**
 * Compute Task 4.3 progress metrics from a pair of aligned scans.
 * Throws if t2 is not strictly later than t1.
 */
export function calcTask43Metrics(input: Task43Input): Task43Output {
  const { addedM3, removedM3, displacementM3, t1ISO, t2ISO, targetVolumeM3, plannedRateM3PerDay } =
    input;

  const daysElapsed = (Date.parse(t2ISO) - Date.parse(t1ISO)) / 86_400_000;
  if (!(daysElapsed > 0)) {
    throw new Error(`daysElapsed must be > 0; got ${daysElapsed} (t1=${t1ISO}, t2=${t2ISO})`);
  }

  const newConstructionM3 = Math.max(addedM3 - displacementM3, 0);
  const demolitionGenuine = Math.max(removedM3 - displacementM3, 0);
  const netProgressM3 = newConstructionM3 - demolitionGenuine;
  const progressRateM3PerDay = newConstructionM3 / daysElapsed;
  const grossRateM3PerDay = addedM3 / daysElapsed;
  const completionPctDelta =
    targetVolumeM3 > 0
      ? Math.max(0, Math.min(100, (newConstructionM3 / targetVolumeM3) * 100))
      : 0;

  const out: Task43Output = {
    daysElapsed,
    newConstructionM3,
    netProgressM3,
    progressRateM3PerDay,
    grossRateM3PerDay,
    completionPctDelta,
  };

  if (plannedRateM3PerDay !== undefined && plannedRateM3PerDay > 0) {
    out.productivityIndex = progressRateM3PerDay / plannedRateM3PerDay;
  }

  if (progressRateM3PerDay > 0 && targetVolumeM3 > 0) {
    const remainingM3 = Math.max(targetVolumeM3 - newConstructionM3, 0);
    out.etaISO = new Date(
      Date.parse(t2ISO) + (remainingM3 / progressRateM3PerDay) * 86_400_000
    ).toISOString();
  }

  return out;
}

// ── Legacy helpers ────────────────────────────────────────────────────────────

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

/**
 * @deprecated Use {@link calcTask43Metrics} instead. This function has no
 * scan-date input so it cannot compute a rate, and it derives T1/T2 volumes
 * from change-detection deltas rather than a project scope baseline.
 */
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
