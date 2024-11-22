import mongoose, { Schema, Document } from "mongoose";
import {
  Complexion,
  Gender,
  AccountStatusEnum,
  Religion,
  VehicleTypeEnum,
} from "../types";
import { PaymentTypeModel } from "./PaymentType";

interface IPermit {
  issueDate: Date;
  expiryDate: Date;
}

export interface IDriver extends Document {
  nin: string;
  fullName: string;
  image: string;
  vehicleType: mongoose.Types.ObjectId;
  association: mongoose.Types.ObjectId;
  associationNumber: string;
  email: string;
  phoneNumber: string;
  dob: Date;
  complexion: Complexion;
  gender: Gender;
  religion: Religion;
  tribe: string;
  stateOfOrigin: string;
  lga: string;
  address: string;
  guarantor: IGuarantor;
  permit: IPermit;
  createdAt: Date;
  status: AccountStatusEnum;
  downloadQuota?: {
    type: mongoose.Types.ObjectId;
    quota: number;
  }[];
  createdBy: mongoose.Types.ObjectId;
}

export interface IGuarantor extends Document {
  fullName: string;
  phoneNumber: string;
  email: string;
  occupation: string;
  address: string;
  gender: Gender;
}

export const GuarantorSchema: Schema = new Schema<IGuarantor>({
  fullName: { type: String, required: true, trim: true },
  phoneNumber: { type: String, required: true, minlength: 11, maxlength: 11 },
  email: { type: String, required: false, lowercase: true, trim: true },
  occupation: { type: String, required: true },
  address: { type: String, required: true },
  gender: { type: String, enum: Object.values(Gender), required: true },
});

const DriverSchema = new Schema<IDriver>(
  {
    nin: {
      type: String,
      minlength: 11,
      maxlength: 11,
      unique: true,
      index: true,
    },
    fullName: { type: String, required: true, trim: true, index: true },
    image: { type: String, index: true, sparse: true, unique: true },
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
    association: {
      type: Schema.Types.ObjectId,
      ref: "Association",
      required: true,
      index: true,
    },
    associationNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      index: true,
      trim: true,
      set: (value: string) => value?.replace(/\s+/g, ""), // Remove all spaces
    },
    status: {
      type: String,
      enum: Object.values(AccountStatusEnum),
      required: true,
      default: AccountStatusEnum.INACTIVE,
      index: true,
    },
    email: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
      sparse: true,
    },
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      minlength: 11,
      maxlength: 11,
      index: true,
    },
    dob: { type: Date, required: true },
    complexion: {
      type: String,
      enum: Object.values(Complexion),
      required: true,
      lowercase: true,
    },
    gender: {
      type: String,
      enum: Object.values(Gender),
      required: true,
      lowercase: true,
    },
    religion: {
      type: String,
      lowercase: true,
      enum: Object.values(Religion),
      required: true,
      index: true,
    },
    tribe: { type: String, required: true },
    stateOfOrigin: { type: String, required: true, index: true },
    lga: { type: String, required: true, index: true },
    address: { type: String, required: true },
    guarantor: { type: GuarantorSchema, required: true },
    permit: {
      issueDate: { type: Date, sparse: true, index: true },
      expiryDate: { type: Date, sparse: true, index: true },
    },
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
    createdAt: { type: Date, default: Date.now() },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

export const DriverModel = mongoose.model<IDriver>("Driver", DriverSchema);
