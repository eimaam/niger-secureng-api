import mongoose, { models, Schema, Document } from "mongoose";
import { Gender } from "../types";

export interface INextOfKin {
  fullName: string;
  phoneNumber: string;
  address: string;
  dob?: Date;
  gender?: Gender;
}

export interface IVehicleOwner extends Document {
  nin?: string;
  fullName: string;
  image: string;
  dob: Date;
  gender: Gender;
  phoneNumber: string;
  address: string;
  email: string;
  nextOfKin: INextOfKin;
  vehicles: mongoose.Types.ObjectId[];
  createdBy: mongoose.Types.ObjectId;
}

const vehicleOwnerSchema: Schema = new Schema<IVehicleOwner>({
  fullName: { type: String, required: true, index: true, trim: true },
  image: { type: String, index: true, sparse: true, unique: true },
  nin: { type: String, sparse: true, index: true, unique: true },
  phoneNumber: { type: String, index: true, trim: true, unique: true },
  dob: { type: Date, required: true },
  gender: { type: String, required: true, enum: Gender },
  email: {
    type: String,
    sparse: true,
    unique: true,
    lowercase: true,
    index: true,
    trim: true,
  },
  address: { type: String, trim: true, required: true },
  nextOfKin: {
    fullName: { type: String, trim: true },
    dob: { type: Date, required: false },
    phoneNumber: { type: String, required: false },
    address: { type: String, trim: true },
    gender: { type: String, enum: Gender },
  },
  vehicles: [{ type: Schema.Types.ObjectId, ref: "Vehicle" }],
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

export const VehicleOwner = mongoose.model<IVehicleOwner>(
  "VehicleOwner",
  vehicleOwnerSchema
);
