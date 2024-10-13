import mongoose, { Schema } from "mongoose";
import { AccountStatusEnum, IUser, RoleName } from "../types";
import bcrypt from "bcrypt";

const userSchema = new Schema<IUser>(
  {
    fullName: { type: String, required: true },
    phoneNumber: { type: String, required: true, maxlength: 11, minlength: 11, unique: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(AccountStatusEnum),
      required: true,
      default: AccountStatusEnum.INACTIVE,
    },
    password: { type: String, required: true, minlength: 6 },
    role: { type: String, enum: Object.values(RoleName), required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isDefaultPassword: { type: Boolean, default: true },
  },
  { timestamps: true },
);

userSchema.pre<IUser>("save", async function (next) {
  try {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(this.password, saltRounds);
    this.password = hashedPassword;
    next();
  } catch (error: any) {
    next(error);
  }
});

userSchema.methods.comparePassword = async function (
  userPassword: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(userPassword, this.password);
  } catch (error) {
    throw error;
  }
};

export const UserModel =
  mongoose.models.User || mongoose.model<IUser>("User", userSchema);
