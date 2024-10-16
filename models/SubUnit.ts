import mongoose from "mongoose";
import { Document } from "mongoose";

export interface ISubUnit extends Document {
  name: string;
  unit: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
}

const SubUnitSchema = new mongoose.Schema<ISubUnit>(
  {
    name: { type: String, required: true },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: "Unit", required: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

const SubUnitModel =
  mongoose.models.SubUnit || mongoose.model<ISubUnit>("SubUnit", SubUnitSchema);

export default SubUnitModel;
