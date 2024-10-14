import mongoose, { Schema } from "mongoose";
import { PaymentTypeEnum, RoleName } from "../types";

/**
 * The PaymentType is used in indicating the vehicle types from Keke, Okada, Taxi, Buses etc
 * as each of these vehicle types have their individual payment cycles and renewal cycles
 */

export interface IBeneficiary extends Document {
  userId: mongoose.Types.ObjectId; // Reference to User
  role: RoleName; // Role of the user
  percentage: number; // Percentage of the total amount for this role
  paymentType: mongoose.Types.ObjectId; // Reference to PaymentType
  createdBy: mongoose.Types.ObjectId;
}

const BeneficiarySchema = new Schema<IBeneficiary>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  role: { type: String, enum: Object.values(RoleName), required: true },
  percentage: { type: Number, required: true, min: 0, max: 100, default: 0 },
  paymentType: {
    type: Schema.Types.ObjectId,
    ref: "PaymentType",
    required: true,
  },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

const BeneficiaryModel = mongoose.model<IBeneficiary>(
  "Beneficiary",
  BeneficiarySchema
);

export { BeneficiaryModel };

export interface IPaymentType extends Document {
  name: PaymentTypeEnum | string;
  category: mongoose.Types.ObjectId;
  paymentCycle: number; // in days
  renewalCycle: number; // in days
  amount: number; // Base amount for the payment
  createdBy: mongoose.Types.ObjectId;
}

const PaymentTypeSchema = new Schema<IPaymentType>({
  name: {
    type: String,
    required: true,
    unique: true,
    set: function(value: string) {
      return value.replace(/\s+/g, '_').toUpperCase();
    }
  },
  paymentCycle: { type: Number, required: true },
  renewalCycle: { type: Number, required: true },
  amount: { type: Number, required: true },
  category: {
    type: Schema.Types.ObjectId,
    ref: "PaymentCategory",
    required: true,
  },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
});

export const PaymentTypeModel = mongoose.model<IPaymentType>(
  "PaymentType",
  PaymentTypeSchema
);
