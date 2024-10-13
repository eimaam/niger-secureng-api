import mongoose, { Schema, Document } from "mongoose";
import { VehicleStatusEnum, VehicleTypeEnum } from "../types";
import { IVehicleOwner } from "./VehicleOwner";
import { PaymentTypeModel } from "./PaymentType";

interface ILicense {
  issueDate: Date;
  expiryDate: Date;
}

interface IUnregisteredVehicle extends Document {
  // mandatory fields
  vehicleType: mongoose.Types.ObjectId;
  chassisNumber: string;
  taxPaidUntil?: Date;
  status: VehicleStatusEnum;
  // optional fields
  identityCode?: string;
  association?: mongoose.Types.ObjectId;
  licensePlateNumber?: string;
  lga?: mongoose.Types.ObjectId;
  unit?: mongoose.Types.ObjectId;
  owner?: mongoose.Types.ObjectId | IVehicleOwner;
  license?: ILicense;
  createdBy?: mongoose.Types.ObjectId;
}

// Define schema for vehicle information
const vehicleSchema: Schema = new Schema<IUnregisteredVehicle>(
  {
    identityCode: { type: String, unique: true, sparse: true, index: true },
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
        message: (props: { value: string }) =>
          `${
            props.value
          } is not a valid vehicle type. Allowed types are: ${Object.values(
            VehicleTypeEnum
          ).join(", ")}`,
      },
    },
    chassisNumber: { type: String, unique: true, index: true, uppercase: true, trim: true, 
      set: (value: string) => value?.replace(/\s+/g, ""), // Remove all spaces
     },
    licensePlateNumber: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      uppercase: true,
      trim: true,
      set: (value: string) => value?.replace(/\s+/g, ""), // Remove all spaces
    },
    lga: {
      type: Schema.Types.ObjectId,
      ref: "LGA",
      index: true,
    },
    association: {
      type: Schema.Types.ObjectId,
      ref: "Association",
    },
    unit: { type: Schema.Types.ObjectId, ref: "Unit" },
    owner: { type: Schema.Types.ObjectId, ref: "VehicleOwner" },
    license: {
      issueDate: { type: Date },
      expiryDate: { type: Date },
    },
    status: {
      type: String,
      enum: Object.values(VehicleStatusEnum),
      required: true,
      default: VehicleStatusEnum.ACTIVATED,
    },
    taxPaidUntil: { type: Date },
    // Reference to who registered the vehicle
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

const UnregisteredVehicle =
  mongoose.models.UnregisteredVehicle ||
  mongoose.model<IUnregisteredVehicle>("UnregisteredVehicle", vehicleSchema);

export { IUnregisteredVehicle, UnregisteredVehicle };
