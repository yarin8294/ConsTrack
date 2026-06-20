import mongoose, { Schema } from "mongoose";
// ============================================================================
// Project Model
// ============================================================================

/**
 * Represents a construction project.
 * A project is the top-level container for all zones, scans, and runs.
 */
export type ProjectDoc = {
  name: string;
  createdAtISO: string;
  userId: string;
  description?: string;
  startDateISO?: string;
  targetFinishDateISO?: string;
  /** Total planned construction volume in m³ — used as the scope baseline for Task 4.3 metrics. */
  targetVolumeM3?: number;
};

const ProjectSchema = new Schema<ProjectDoc>(
  {
    name: { type: String, required: true },
    createdAtISO: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    description: { type: String, required: false },
    startDateISO: { type: String, required: false },
    targetFinishDateISO: { type: String, required: false },
    targetVolumeM3: { type: Number, required: false },
  },
  { versionKey: false }
);

export const ProjectModel = mongoose.model<ProjectDoc>("Project", ProjectSchema);

// ============================================================================
// Zone Model
// ============================================================================

export type ZoneType = "site" | "floor" | "wing" | "zone";
/**
 * Represents a specific area within a project.
 * Zones are hierarchical: Site -> Building -> Floor -> Zone.
 */
export type ZoneDoc = {
  _id: string;
  projectId: string;
  name: string;
  type: ZoneType;
  parentId?: string;
  completionPct: number;
  createdAtISO: string;
  linkedScanIds: string[];
};

const ZoneSchema = new Schema<ZoneDoc>(
  {
    projectId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    type: { type: String, required: true },
    parentId: { type: String, required: false, index: true },
    completionPct: { type: Number, required: true, default: 0 },
    linkedScanIds: { type: [String], required: true, default: [] },
    createdAtISO: { type: String, required: true },
  },
  { versionKey: false }
);

export const ZoneModel = mongoose.model<ZoneDoc>("Zone", ZoneSchema);
// ============================================================================
// Run (Analysis) Model
// ============================================================================

/**
 * Represents a single metric for a specific zone calculated during a run.
 */
export type ScanDoc = {
  projectId: string;
  name: string;
  sizeBytes: number;
  capturedAtISO: string;
  uploadedAtISO: string;
  notes?: string;
  filePath: string;
};

const ScanSchema = new Schema<ScanDoc>(
  {
    projectId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    capturedAtISO: { type: String, required: true },
    uploadedAtISO: { type: String, required: true },
    notes: { type: String, required: false },
    filePath: { type: String, required: true },
  },
  { versionKey: false }
);

export const ScanModel = mongoose.model<ScanDoc>("Scan", ScanSchema);
// ============================================================================
// Run (Analysis) Model
// ============================================================================

/**
 * Represents a single metric for a specific zone calculated during a run.
 */
export type AreaMetric = {
  zoneId: string;
  progressPct: number;
  volumeChangeM3: number;
};
/**
 * Represents a comparison run between two scans (T1 and T2).
 * Stores the results of the volume analysis and progress estimation.
 */
export type RunDoc = {
  projectId: string;
  createdAtISO: string;
  t1ScanId: string;
  t2ScanId: string;
  status: "queued" | "processing" | "done" | "failed";
  error?: string;
  alignmentConfidence: "low" | "medium" | "high";
  volumeT1M3: number;
  volumeT2M3: number;
  volumeChangeM3: number;
  overallProgressPct: number;
  metricsByZone: AreaMetric[];
  forecastCompletionISO?: string;
  // ICP alignment metrics
  fitness?: number;
  rmseCm?: number;
  // Change detection results
  addedVolumeM3?: number;
  removedVolumeM3?: number;
  addedElementCount?: number;
  removedElementCount?: number;
  // ── Task 4.3 metrics ──────────────────────────────────────────────────────
  daysElapsed?: number;
  newConstructionM3?: number;
  netProgressM3?: number;
  progressRateM3PerDay?: number;
  grossRateM3PerDay?: number;
  completionPctDelta?: number;
  productivityIndex?: number;
  etaISO?: string;
  // ── Displacement provenance ───────────────────────────────────────────────
  volumeBasis?: "hull" | "obb" | "voxel";
  degenerateClusterCount?: number;
  /** Populated only when calcTask43Metrics threw — signals bad dates or missing scope. */
  task43Error?: string;
};

const MetricSchema = new Schema<AreaMetric>(
  {
    zoneId: { type: String, required: true },
    progressPct: { type: Number, required: true },
    volumeChangeM3: { type: Number, required: true },
  },
  { _id: false }
);

const RunSchema = new Schema<RunDoc>(
  {
    projectId: { type: String, required: true, index: true },
    createdAtISO: { type: String, required: true },
    t1ScanId: { type: String, required: true },
    t2ScanId: { type: String, required: true },
    status: { type: String, required: true, index: true },
    error: { type: String, required: false },
    alignmentConfidence: { type: String, required: true },
    volumeT1M3: { type: Number, required: true, default: 0 },
    volumeT2M3: { type: Number, required: true, default: 0 },
    volumeChangeM3: { type: Number, required: true, default: 0 },
    overallProgressPct: { type: Number, required: true, default: 0 },
    metricsByZone: { type: [MetricSchema], required: true, default: [] },
    forecastCompletionISO: { type: String, required: false },
    fitness: { type: Number, required: false },
    rmseCm: { type: Number, required: false },
    addedVolumeM3: { type: Number, required: false },
    removedVolumeM3: { type: Number, required: false },
    addedElementCount: { type: Number, required: false },
    removedElementCount: { type: Number, required: false },
    // Task 4.3
    daysElapsed: { type: Number, required: false },
    newConstructionM3: { type: Number, required: false },
    netProgressM3: { type: Number, required: false },
    progressRateM3PerDay: { type: Number, required: false },
    grossRateM3PerDay: { type: Number, required: false },
    completionPctDelta: { type: Number, required: false },
    productivityIndex: { type: Number, required: false },
    etaISO: { type: String, required: false },
    // Displacement provenance
    volumeBasis: { type: String, required: false },
    degenerateClusterCount: { type: Number, required: false },
    task43Error: { type: String, required: false },
  },
  { versionKey: false }
);

export const RunModel = mongoose.model<RunDoc>("Run", RunSchema);

// ============================================================================
// Report Model
// ============================================================================

/**
 * Represents a generated report (PDF/XLSX) derived from a Run.
 */
export type ReportDoc = {
  projectId: string;
  runId: string;
  createdAtISO: string;
  pdfPath: string;
  xlsxPath: string;
};

const ReportSchema = new Schema<ReportDoc>(
  {
    projectId: { type: String, required: true, index: true },
    runId: { type: String, required: true, index: true },
    createdAtISO: { type: String, required: true },
    pdfPath: { type: String, required: true },
    xlsxPath: { type: String, required: true },
  },
  { versionKey: false }
);

export const ReportModel = mongoose.model<ReportDoc>("Report", ReportSchema);
// ============================================================================
// User Model
// ============================================================================

/**
 * Represents a registered user of the application.
 */
export type UserDoc = {
  name: string;
  email: string;
  username: string;
  passwordHash: string;
  createdAtISO: string;
  resetToken?: string;
  resetTokenExpiry?: string;
};

const UserSchema = new Schema<UserDoc>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    createdAtISO: { type: String, required: true },
    resetToken: { type: String, required: false },
    resetTokenExpiry: { type: String, required: false },
  },
  { versionKey: false }
);

export const UserModel = mongoose.model<UserDoc>("User", UserSchema);
