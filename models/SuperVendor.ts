import mongoose, { Document, Schema } from "mongoose";

export interface ISuperVendor extends Document {
  fullName: string;
  phoneNumber: string;
  email: string;
  /**
   * @description 
   * the id of the deposit wallet of the super vendor > Wallet used to receive deposits > wallet used to carry out funding of vendors
   * */
  depositWallet: mongoose.Types.ObjectId;
  /**
   * @description 
   * the id of the earnings wallet of the super vendor > Wallet used to receive earnings/percentages 
   * */
  earningsWallet: mongoose.Types.ObjectId;
  /**
   * @description 
   * the id of the funding wallet of the super vendor > monnify reserved account
   * */
  fundingWallet: mongoose.Types.ObjectId;
  /** 
@description   
the id of the user account of the super vendor
   */
  userId: mongoose.Types.ObjectId;
  /**
   * @description 
   * the id of the withdrawal details of the super vendor > details of the bank account of the super vendor
   * */
  paymentDetails: mongoose.Types.ObjectId;
  vendors: mongoose.Types.ObjectId[];
  createdBy: mongoose.Types.ObjectId;
}

const superVendorSchema = new mongoose.Schema<ISuperVendor>({
  fullName: {
    type: String,
    required: true,

    index: true,
  },
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
    index: true,
  },
  depositWallet: { type: Schema.Types.ObjectId, ref: "DepositWallet", required: true, index: true },
  earningsWallet: { type: Schema.Types.ObjectId, ref: "EarningsWallet", required: true, index: true },
  fundingWallet: { type: Schema.Types.ObjectId, ref: "FundingWallet", required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  vendors: [{ type: Schema.Types.ObjectId, ref: "User", }],
  paymentDetails: { type: Schema.Types.ObjectId, ref: "PaymentDetails", required: true },
  createdBy: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: "User",
    index: true,
  },
}, { timestamps: true });

export const SuperVendorModel =
  mongoose.models.SuperVendor ||
  mongoose.model<ISuperVendor>("SuperVendor", superVendorSchema);
