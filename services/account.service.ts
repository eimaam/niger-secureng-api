import mongoose, { isValidObjectId } from "mongoose";
import { withMongoTransaction } from "../utils/mongoTransaction";
import { UserModel } from "../models/User";
import { TokenService } from "./token.service";
import { Config } from "../utils/config";
import { EmailService } from "./email.service";
import crypto from "crypto";
export class AccountService {
  static async deleteAccount(userId: string) {
    if (!userId || !isValidObjectId(userId)) {
      throw new Error("Invalid user ID");
    }

    const result = await withMongoTransaction(async (session) => {
      // Delete user account
      const user = await UserModel.findByIdAndDelete(userId).session(session);

      if (!user) {
        throw new Error("User not found");
      }
    });
  }

  static async initiatePasswordReset(userId: string) {
    const user = await UserModel.findById(userId);

    if (!user) {
      throw new Error("Account not found");
    }

    const resetToken = await TokenService.generateUniquePasswordResetToken();
    const hashedToken = await TokenService.cryptoTokenHash(resetToken);
    // Update user password reset token
    const updatedUser = await UserModel.findByIdAndUpdate(
      userId,
      {
        passwordResetToken: hashedToken,
        passwordResetTokenExpiry: new Date(Date.now() + 30 * 60 * 1000),
      },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      throw new Error("Failed to update user password reset token");
    }

    // Create reset URL
    const resetUrl = `${Config.FRONTEND_URL}/reset-password?token=${resetToken}`;

    // Send email
    await EmailService.sendPasswordResetEmail(user?.email, resetUrl);

    return updatedUser;
  }

  static async resetPassword({
    email,
    token,
    password,
  }: {
    email: string;
    token: string;
    password: string;
  }) {
    const user = await UserModel.findOne({ email }).select(
      "+passwordResetToken +passwordResetTokenExpiry"
    );

    if (!user) {
      throw new Error("User not found");
    }

    if (
      !user.passwordResetToken ||
      !user.passwordResetTokenExpiry ||
      user.passwordResetTokenExpiry < new Date()
    ) {
      throw new Error("Invalid or expired reset link");
    }

    // Verify token
    const isValidToken = await TokenService.verifyPasswordResetToken(
      user._id,
      token
    );

    if (!isValidToken) {
      throw new Error("Invalid or expired reset link");
    }

    // Hash new password
    const hashedPassword = await TokenService.bcryptTokenHash(password);

    // Update user password
    const updatedUser = await UserModel.findByIdAndUpdate(
      { _id: user._id },
      {
        password: hashedPassword,
        $unset: { passwordResetToken: "", passwordResetTokenExpiry: "" },
      }
    );

    return updatedUser;
  }

  static async findAccountWithPasswordResetToken(token: string) {
    const user = await UserModel.findOne({
      passwordResetToken: token,
      passwordResetTokenExpiry: { $gt: new Date() },
    }).select("+passwordResetToken +passwordResetTokenExpiry");
    if (!user) {
      throw new Error("Invalid or expired reset link");
    }
    return user;
  }
}
