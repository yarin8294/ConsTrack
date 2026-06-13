import mongoose, { Schema, Model, Document } from "mongoose";

export interface IProject extends Document {
  name: string;
  location: string;
  createdAt: Date;
}

const ProjectSchema = new Schema<IProject>(
  {
    name: { type: String, required: true, trim: true },
    location: { type: String, required: true, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Guard against model re-registration (hot reload / shared module registry)
export const Project: Model<IProject> =
  (mongoose.models.Project as Model<IProject>) ||
  mongoose.model<IProject>("Project", ProjectSchema);
