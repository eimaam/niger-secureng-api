import mongoose, { Document, Schema } from "mongoose";

interface IUnit extends Document {
  // Admin registers the options
  lga: mongoose.Types.ObjectId;
  name: string;
  /**
   * @description 
   * short name to represent the unit - usually abbreviation of the unit name
   */
  code: string;
  taxType: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
}

const UnitSchema: Schema = new Schema<IUnit>({
  name: { type: String, required: true },
  code: { type: String, required: true, unique: true },
  lga: { type: Schema.Types.ObjectId, ref: "LGA", required: true },
  taxType: { type: Schema.Types.ObjectId, ref: "PaymentType", required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

const UnitModel = mongoose.models.Unit || mongoose.model<IUnit>("Unit", UnitSchema);

export default UnitModel;
