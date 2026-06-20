export type ScanId = string;
export type AreaId = string;
export type RunId = string;

export type Scan = {
  id: ScanId;
  name: string;
  sizeBytes: number;
  capturedAtISO: string; // user-provided
  uploadedAtISO: string;
  notes?: string;
};

export type AreaNode = {
  id: AreaId;
  name: string;
  type: "site" | "floor" | "wing" | "zone";
  parentId?: AreaId;
  completionPct?: number; // 0..100 (mainly for zones)
  linkedScanIds?: ScanId[];
};

export type AreaMetric = {
  areaId: AreaId;
  progressPct: number; // 0..100
  volumeChangeM3: number;
  areaChangeM2: number;
  workRatePerDay: number;
  deviationDays: number;
};

export type DisplacementEvent = {
  fromClusterId: number;
  toClusterId: number;
  fromCentroid: [number, number, number];
  toCentroid: [number, number, number];
  displacementM: number;
  volumeM3: number;
};

export type ComparisonRun = {
  id: RunId;
  createdAtISO: string;
  t1ScanId: ScanId;
  t2ScanId: ScanId;
  status?: "queued" | "processing" | "done" | "failed";
  error?: string;
  alignmentConfidence: "low" | "medium" | "high";
  forecastCompletionISO: string;
  overallProgressPct: number;
  volumeT1M3?: number;
  volumeT2M3?: number;
  volumeChangeM3?: number;
  metricsByArea: AreaMetric[];
  // Full pipeline results
  fitness?: number;
  rmseCm?: number;
  addedVolumeM3?: number;
  removedVolumeM3?: number;
  addedElementCount?: number;
  removedElementCount?: number;
  // Task 4.3 fields (all optional — older runs won't have them)
  daysElapsed?: number;
  newConstructionM3?: number;
  demolitionM3?: number;
  netProgressM3?: number;
  displacementM3?: number;
  progressRateM3PerDay?: number;
  grossRateM3PerDay?: number;
  completionPctDelta?: number;
  productivityIndex?: number;
  etaISO?: string;
  targetVolumeM3?: number;
  volumeBasis?: "hull" | "obb" | "voxel";
  degenerateClusterCount?: number;
  task43Error?: string;
  displacementEvents?: DisplacementEvent[];
};

export type AppData = {
  projectId?: string;
  scans: Scan[];
  selectedT1?: ScanId;
  selectedT2?: ScanId;
  areas: AreaNode[];
  runs: ComparisonRun[];
};

export type ScheduleTask = {
  id: string;
  providerId: string;
  name: string;
  start: string;
  finish: string;
  progressPct: number;
  owner: string;
  critical: boolean;
};

export type WorkDiaryEntry = {
  id: string;
  projectId: string;
  dateISO: string;
  crew: string;
  summary: string;
};
