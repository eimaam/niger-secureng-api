import mongoose, { Document, Schema } from "mongoose";

export interface IStakeholder extends Document {
  name: string;
  email: string;
  description: string;
  earningsWallet: mongoose.Types.ObjectId;
  /**
   * @description
   * The user account linked to or who is the owner of this stakeholder
   */
  userId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const StakeholderSchema = new Schema<IStakeholder>(
  {
    name: { type: String, required: true, unique: true, index: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: { type: String },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    earningsWallet: {
      type: Schema.Types.ObjectId,
      ref: "EarningsWallet",
      required: true,
      index: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export const StakeholderModel =
  mongoose.models.Stakeholder ||
  mongoose.model<IStakeholder>("Stakeholder", StakeholderSchema);
