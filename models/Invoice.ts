import mongoose, { Schema, Document } from "mongoose";

export enum InvoiceStatusEnum {
  PENDING = "PENDING",
  PAID = "PAID",
  EXPIRED = "EXPIRED",
  CANCELLED = "CANCELLED",
}

export interface IInvoice extends Document {
  type: mongoose.Types.ObjectId;
  amount: number;
  invoiceReference: string;
  description: string;
  customerEmail: string;
  customerName: string;
  expiryDate: Date;
  accountName: string;
  accountNumber: string;
  bankName: string;
  invoiceStatus: InvoiceStatusEnum;
  metaData: object;
  canceledBy: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
}

const InvoiceSchema: Schema = new Schema<IInvoice>(
  {
    type: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentType",
      required: true,
    },
    amount: { type: Number, required: true },
    invoiceReference: { type: String, required: true },
    description: { type: String, required: true },
    customerEmail: { type: String, trim: true, required: true },
    customerName: { type: String, trim: true, required: true },
    expiryDate: { type: Date, required: true },
    accountName: { type: String, trim: true, required: true },
    accountNumber: { type: String, trim: true, required: true },
    bankName: { type: String, trim: true, required: true },
    invoiceStatus: {
      type: String,
      enum: Object.values(InvoiceStatusEnum),
      default: InvoiceStatusEnum.PENDING,
    },
    metaData: { type: Object, required: false },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    canceledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    }
  },
  {
    timestamps: true,
  }
);

const InvoiceModel = mongoose.model<IInvoice>("Invoice", InvoiceSchema);

export default InvoiceModel;
