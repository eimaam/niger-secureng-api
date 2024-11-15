import mongoose, { Schema, Document } from "mongoose";
import { PaymentStatusEnum, RoleName } from "../types";

export enum WalletTransactionType {
  Funding = "funding",
  Payment = "payment",
  Commision = "commission",
  Withdrawal = "withdrawal",
  Refund = "refund",
  Settlement = "settlement",
  Disbursement = "disbursement",
  Fee = "fee",
  Transfer = "transfer",
}



export interface IWalletTransaction extends Document {
  type: WalletTransactionType; // e.g., "funding", "withdrawal"
  from: mongoose.Types.ObjectId; // The account from which the funds are coming
  to: mongoose.Types.ObjectId; // The account to which the funds are going
  amount: number; // Amount of funds transferred
  status: PaymentStatusEnum; // Status of the transaction, e.g., "completed"
  reference: string; // Reference number for the transaction
  description?: string; // Optional description or notes
  processedBy: mongoose.Types.ObjectId; // The user who processed the transaction
}

const WalletTransactionSchema = new Schema<IWalletTransaction>(
  {
    type: {
      type: String,
      enum: Object.values(WalletTransactionType),
      required: true,
    },
    from: { type: Schema.Types.ObjectId, ref: "User", required: true },
    to: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: Object.values(PaymentStatusEnum),
      default: PaymentStatusEnum.SUCCESSFUL,
    },
    reference: { type: String, required: true, index: true, unique: true },
    description: { type: String },
    processedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export const WalletTransactionModel = mongoose.model<IWalletTransaction>(
  "WalletTransaction",
  WalletTransactionSchema
);
