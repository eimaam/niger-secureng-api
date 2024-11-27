
import mongoose, { Schema, Document } from "mongoose";
import { VehicleStatusEnum } from "../types";

export interface IVehicleStatusLog extends Document {
  vehicle: mongoose.Types.ObjectId;
  previousStatus: VehicleStatusEnum;
  newStatus: VehicleStatusEnum;
    taxPaidUntil: Date;
  updatedBy: mongoose.Types.ObjectId;
  deactivationDate: Date;
  createdAt: Date;
}

const vehicleStatusLogSchema = new Schema<IVehicleStatusLog>({
  vehicle: {
    type: Schema.Types.ObjectId,
    ref: 'Vehicle',
    required: true,
    index: true
  },
  previousStatus: {
    type: String,
    enum: Object.values(VehicleStatusEnum),
    required: true
  },
  newStatus: {
    type: String,
    enum: Object.values(VehicleStatusEnum),
    required: true
  },
  taxPaidUntil: {
    type: Date,
    required: true
  },
  deactivationDate: {
    type: Date,
    required: true,
    index: true,
    default: Date.now
  },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, { timestamps: true });

export const VehicleStatusLog = mongoose.models.VehicleStatusLog || 
  mongoose.model<IVehicleStatusLog>('VehicleStatusLog', vehicleStatusLogSchema);