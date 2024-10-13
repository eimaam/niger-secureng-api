import mongoose, { Document, Schema } from "mongoose";

export interface IAssociation extends Document {
  /**
   * @description
   * the association's created account for login
   */
  userId: mongoose.Types.ObjectId;
  name: string;
  /**
   * @description
   * Usually phone number of the association's head
   */
  phoneNumber: string;
  /**
   * @description
   * Unique code for the association
   */
  code: string;
  /**
   * @description
   * Indicates the type of vehicle the association manages or supports - keke assoc, okada, taxi etc
   */
  type: mongoose.Types.ObjectId;
  /**
   * @description
   * Wallet for the Association
   */
  wallet: mongoose.Types.ObjectId;
  createdBy: string;
}

const associationSchema: Schema = new Schema<IAssociation>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    phoneNumber: {
      type: String,
      required: true,
      minlength: 11,
      maxlength: 11,
      unqiue: true,
    },
    code: { type: String, required: true, unique: true, minlength: 2 },
    type: { type: Schema.Types.ObjectId, required: true, ref: "PaymentType" },
    wallet: { type: Schema.Types.ObjectId, required: true, ref: "Wallet" },
    userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    createdBy: { type: String, required: true, ref: "User" },
  },
  { timestamps: true }
);

export const AssociationModel = mongoose.model<IAssociation>(
  "Association",
  associationSchema
);
