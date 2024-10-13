import mongoose, { Document, Schema } from "mongoose";

export enum PaymentCategoryEnum {
    TaxPayment = 'TAX',
    LicenseFee = 'LICENSE',
    ServiceCharge = 'SERVICE',
  }

export interface IPaymentCategory extends Document{
    name: PaymentCategoryEnum | string;
    description: string;
    createdBy: string;
}

const PaymentCategorySchema = new Schema({
name: { type: String, required: true },
description: { type: String, required: false },
createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });

export const PaymentCategoryModel = mongoose.models.PaymentCategory || mongoose.model<IPaymentCategory>("PaymentCategory", PaymentCategorySchema);