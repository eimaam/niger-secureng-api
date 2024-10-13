import mongoose, { Schema } from "mongoose";

export interface IPaymentDetail {
  accountName: string;
  bankName: string;
  accountNumber: string;
  bankCode: string;
  owner: mongoose.Types.ObjectId;
}

const PaymentDetailsSchema = new Schema<IPaymentDetail>({
  accountName: { type: String, trim: true, required: true },
  bankName: { type: String, trim: true, required: true },
  accountNumber: {
    type: String,
    required: true,
    minlength: 10,
    maxlength: 10,
  },
  bankCode: { type: String, required: true, minlength: 3 },
  owner: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true,
    index: true,
  },
});

export const PaymentDetailsModel =
  mongoose.models.PaymentDetails ||
  mongoose.model<IPaymentDetail>("PaymentDetails", PaymentDetailsSchema);
