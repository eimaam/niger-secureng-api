import mongoose, { Schema, Document } from "mongoose";
import { VehicleStatusEnum, VehicleTypeEnum } from "../types";
import { IVehicleOwner } from "./VehicleOwner";
import { PaymentTypeModel } from "./PaymentType";

interface ILicense {
  issueDate: Date;
  expiryDate: Date;
}

export interface IDownloadQuota {
  type: mongoose.Types.ObjectId;
  quota: number;
}

interface IVehicle extends Document {
  identityCode: string;
  existingId: string;
  association: mongoose.Types.ObjectId;
  vehicleType: mongoose.Types.ObjectId;
  licensePlateNumber: string;
  chassisNumber: string;
  lga: mongoose.Types.ObjectId;
  unit: mongoose.Types.ObjectId;
  subUnit: mongoose.Types.ObjectId;
  owner: mongoose.Types.ObjectId | IVehicleOwner;
  license?: ILicense | null;
  taxPaidUntil?: Date;
  dateSetInactive?: Date;
  downloadQuota?: IDownloadQuota[];
  createdBy: mongoose.Types.ObjectId;
  status: VehicleStatusEnum;
}

// Define schema for vehicle information
const vehicleSchema: Schema = new Schema<IVehicle>(
  {
    identityCode: {
      type: String,
      unique: true,
      index: true,
      sparse: true,
      uppercase: true,
    },
    existingId: {
      type: String,
      unique: true,
      index: true,
      sparse: true,
    },
    vehicleType: {
      type: Schema.Types.ObjectId,
      ref: "PaymentType",
      required: true,
      validate: {
        validator: async function (value: mongoose.Types.ObjectId) {
          const paymentType = await PaymentTypeModel.findById(value);
          return (
            !!paymentType &&
            Object.values(VehicleTypeEnum).includes(
              paymentType.name as unknown as VehicleTypeEnum
            )
          );
        },
        message: (props) =>
          `${
            props.value
          } is not a valid vehicle type. Allowed types are: ${Object.values(
            VehicleTypeEnum
          ).join(", ")}`,
      },
    },
    licensePlateNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      sparse: true, // sparse because we can purge the license plate number when the vehicle is sold to another owner with license included
      uppercase: true,
      set: (value: string) => value?.replace(/\s+/g, ""), // Remove all spaces
    },

    chassisNumber: {
      type: String,
      unique: true,
      index: true,
      sparse: true, // sparse because we can purge the chassis number when the vehicle is sold to another owner
      trim: true,
      uppercase: true,
      set: (value: string) => value?.replace(/\s+/g, ""), // Remove all spaces
    },
    lga: {
      type: Schema.Types.ObjectId,
      ref: "LGA",
      required: true,
      index: true,
    },
    association: {
      type: Schema.Types.ObjectId,
      ref: "Association",
      required: true,
    },
    unit: { type: Schema.Types.ObjectId, ref: "Unit", required: true },
    subUnit: { type: Schema.Types.ObjectId, ref: "SubUnit", required: true },
    owner: { type: Schema.Types.ObjectId, ref: "VehicleOwner", required: true },
    license: {
      issueDate: { type: Date, sparse: true, index: true },
      expiryDate: { type: Date, sparse: true, index: true },
    },
    status: {
      type: String,
      enum: Object.values(VehicleStatusEnum),
      default: VehicleStatusEnum.NOT_ACTIVATED,
    },
    taxPaidUntil: { type: Date, sparse: true, index: true },
    dateSetInactive: { type: Date, sparse: true, index: true },
    downloadQuota: [
      {
        type: {
          type: Schema.Types.ObjectId,
          ref: "PaymentType",
          required: true,
        },
        quota: { type: Number, required: true, default: 0 },
      },
    ],
    // Reference to who registered the vehicle
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

vehicleSchema.pre("save", function (this: IVehicle, next) {
  if (this.identityCode) {
    this.identityCode = this.identityCode.toUpperCase();
  }
  next();
});

const Vehicle =
  mongoose.models.Vehicle || mongoose.model<IVehicle>("Vehicle", vehicleSchema);

export { IVehicle, Vehicle };
