import mongoose, { Schema } from "mongoose";
import { PaymentTypeEnum } from "../types";

/**
 * The PaymentType is used in indicating the vehicle types from Keke, Okada, Taxi, Buses etc
 * as each of these vehicle types have their individual payment cycles and renewal cycles
 */

export interface IBeneficiary extends Document {
  userId: mongoose.Types.ObjectId; // Reference to User
  percentage: number; // Percentage of the total amount for this role
  createdBy: mongoose.Types.ObjectId;
}

const BeneficiarySchema = new Schema<IBeneficiary>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  percentage: { type: Number, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

const Beneficiary = mongoose.model<IBeneficiary>(
  "Beneficiary",
  BeneficiarySchema
);

export { Beneficiary };

export interface IPaymentType extends Document {
  name: PaymentTypeEnum | string;
  category: mongoose.Types.ObjectId;
  paymentCycle: number; // in days
  renewalCycle: number; // in days
  amount: number; // Base amount for the payment
  createdBy: mongoose.Types.ObjectId;
  beneficiaries: mongoose.Types.ObjectId[];
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
  beneficiaries: [{ type: Schema.Types.ObjectId, ref: "Beneficiary" }],
});

export const PaymentTypeModel = mongoose.model<IPaymentType>(
  "PaymentType",
  PaymentTypeSchema
);
