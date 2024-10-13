import mongoose, { Schema, Document } from "mongoose";

export enum TaxWaiveLogTypeEnum {
  General = "general",
  Single = "single",
}

export interface ITaxWaiveLog extends Document {
  vehicle?: mongoose.Types.ObjectId;
  daysWaived: number;
  newTaxPaidUntil?: Date;
  date: Date;
  type: TaxWaiveLogTypeEnum;
  totalVehicles?: number;
  processedBy: mongoose.Types.ObjectId;
}

const TaxWaiveLogSchema: Schema = new Schema<ITaxWaiveLog>(
  {
    vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle" },
    daysWaived: { type: Number, required: true },
    newTaxPaidUntil: { type: Date },
    date: { type: Date, default: Date.now },
    type: {
      type: String,
      enum: Object.values(TaxWaiveLogTypeEnum),
      required: true,
    },
    totalVehicles: { type: Number },
    processedBy: { type: Schema.Types.ObjectId, required: true, ref: "User" },
  },
  { timestamps: true }
);

export const TaxWaiveLogModel =
  mongoose.models.TaxWaiveLog ||
  mongoose.model<ITaxWaiveLog>("TaxWaiveLog", TaxWaiveLogSchema);
