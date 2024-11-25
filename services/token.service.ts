import mongoose from "mongoose";
import crypto from "crypto";
import { UserModel } from "../models/User";
import bcrypt from "bcrypt";
import { IUser } from "../types";

export class TokenService {
  static async generateUniquePasswordResetToken(
  ) {
    let token;
    let exists;

    do {
      token = crypto.randomBytes(32).toString("hex");
      const hashedToken = await this.cryptoTokenHash(token);
      exists = await UserModel.exists({ passwordResetToken: hashedToken });
    } while (exists);

    return token;
  }

  static async verifyPasswordResetToken(
    userId: string,
    token: string
  ) {
    const user = await UserModel
      .findById(userId)
      .select("passwordResetToken passwordResetTokenExpiry")
      .lean<IUser>();
  
    if (!user) {
      return false; // If the user is not found, return false.
    }
  
    // Check if the token or expiry is invalid or expired
    if (!user.passwordResetToken || !user.passwordResetTokenExpiry || new Date(user.passwordResetTokenExpiry) < new Date()) {
      return false; // If no token or expired token, return false.
    }
  
    // Validate the token
    if (user.passwordResetToken === token) {
      return true; // If the token matches, return true.
    }
  
    console.log("Token mismatch from verifyPasswordResetToken");
    return false; // If the token doesn't match, return false.
  }
  

  static async cryptoTokenHash(token: string) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }


  static async bcryptTokenHash(token: string) {
    return await bcrypt.hash(token, 10);
  }

  static async bcryptCompareTokens(token: string, hashedToken: string) {
    return await bcrypt.compare(token, hashedToken);
  }

}
