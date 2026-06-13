import mongoose, { Schema, Model, Document, Types } from "mongoose";

export interface IScan extends Document {
  projectId: Types.ObjectId;
  sequenceNumber: number;
  scanDate: Date;
  rawFilePath: string;
  cleanedPlyPath: string;
  alignedPlyPath?: string;
}

const ScanSchema = new Schema<IScan>({
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
  sequenceNumber: { type: Number, required: true },
  scanDate: { type: Date, required: true },
  rawFilePath: { type: String, required: true },
  cleanedPlyPath: { type: String, required: true },
  alignedPlyPath: { type: String },
});

// Enforce uniqueness of sequence numbers within a project
ScanSchema.index({ projectId: 1, sequenceNumber: 1 }, { unique: true });

// Registered as "PointCloudScan" (→ collection: pointcloudscans) to avoid
// colliding with the legacy "Scan" model in models.ts, which has an
// incompatible schema. Both must coexist until the legacy model is retired.
export const Scan: Model<IScan> =
  (mongoose.models.PointCloudScan as Model<IScan>) ||
  mongoose.model<IScan>("PointCloudScan", ScanSchema);
