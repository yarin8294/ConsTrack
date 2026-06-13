import mongoose, { Schema, Model, Document, Types } from "mongoose";

export interface ICluster {
  clusterId: number;
  pointCount: number;
  centroidXYZ: [number, number, number];
  voxelVolumeM3: number;
  obbVolumeM3: number;
  obbExtentM: [number, number, number];
}

/** One direction of the bidirectional comparison (added OR removed). */
export interface IDelta {
  volumeM3: number;
  pointCount: number;
  elementCount: number;
  noisePointCount: number;
  clusters: ICluster[];
  /** PLY path Python wrote, or null when this side had zero delta points. */
  plyPath: string | null;
}

export interface IProgressEvent extends Document {
  projectId: Types.ObjectId;
  baselineScanId: Types.ObjectId;
  newScanId: Types.ObjectId;
  added: IDelta;
  removed: IDelta;
  createdAt: Date;
}

const ClusterSchema = new Schema<ICluster>(
  {
    clusterId: { type: Number, required: true },
    pointCount: { type: Number, required: true },
    centroidXYZ: { type: [Number], required: true },
    voxelVolumeM3: { type: Number, required: true },
    obbVolumeM3: { type: Number, required: true },
    obbExtentM: { type: [Number], required: true },
  },
  { _id: false }
);

const DeltaSchema = new Schema<IDelta>(
  {
    volumeM3: { type: Number, required: true, default: 0 },
    pointCount: { type: Number, required: true, default: 0 },
    elementCount: { type: Number, required: true, default: 0 },
    noisePointCount: { type: Number, required: true, default: 0 },
    clusters: { type: [ClusterSchema], required: true, default: [] },
    // null when the side had zero delta points (no PLY written — see analyze_delta).
    plyPath: { type: String, default: null },
  },
  { _id: false }
);

const ProgressEventSchema = new Schema<IProgressEvent>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    baselineScanId: { type: Schema.Types.ObjectId, ref: "PointCloudScan", required: true },
    newScanId: { type: Schema.Types.ObjectId, ref: "PointCloudScan", required: true },
    added: { type: DeltaSchema, required: true },
    removed: { type: DeltaSchema, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const ProgressEvent: Model<IProgressEvent> =
  (mongoose.models.ProgressEvent as Model<IProgressEvent>) ||
  mongoose.model<IProgressEvent>("ProgressEvent", ProgressEventSchema);
