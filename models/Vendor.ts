import mongoose, { Schema, Document } from "mongoose";

// Define IVendor interface
export interface IVendor extends Document {
  fullName: string;
  phoneNumber: string;
  email: string;
  /**
   * @description 
   * the id of the deposit wallet of the vendor > Wallet used to carry out tax payments
   */
  depositWallet: mongoose.Types.ObjectId;
  /**
   * @description 
   * the id of the earnings wallet of the vendor > Wallet used to receive earnings/percentages from tax payments
   */
  earningsWallet: mongoose.Types.ObjectId;
  /**
   * @description 
   * the id of the payment details of the vendor > details of the bank account of the vendor
   */
  paymentDetails: mongoose.Types.ObjectId;
  /** 
    @description   
    the id of the user account of the vendor
   */
  userId: mongoose.Types.ObjectId;
  superVendor: mongoose.Types.ObjectId;
}

const vendorSchema: Schema = new Schema<IVendor>(
  {
    fullName: { type: String, required: true },
    phoneNumber: {
      type: String,
      required: true,
      maxlength: 11,
      minlength: 11,
      unique: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    depositWallet: { type: Schema.Types.ObjectId, ref: "DepositWallet", required: true },
    earningsWallet: { type: Schema.Types.ObjectId, ref: "EarningsWallet", required: true },
    paymentDetails: { type: Schema.Types.ObjectId, ref: "PaymentDetails", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    superVendor: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export const VendorModel = mongoose.model<IVendor>("Vendor", vendorSchema);
