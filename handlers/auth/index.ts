import { Request, Response } from "express";
import { UserModel } from "../../models/User";
import { AccountStatusEnum, IUser } from "../../types";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { withMongoTransaction } from "../../utils/mongoTransaction";
import { WalletService } from "../../services/wallet.service";
import { FundingWalletModel, WalletTypeEnum } from "../../models/Wallet";
import { PaymentDetailsModel } from "../../models/PaymentDetail";
import { Config } from "../../utils/config";
import { EmailService } from "../../services/email.service";
import { hashData } from "../../utils";
import crypto from "crypto";
import { AccountService } from "../../services/account.service";
import { TokenService } from "../../services/token.service";

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_EXPIRY = process.env.JWT_EXPIRY as string;

export class Auth {
  static async login(req: Request, res: Response) {
    const { password, email } = req.body;
    let user: IUser | null = null;

    if (!email || !password) {
      throw {
        code: 400,
        message: "Email and password are required",
      };
    }

    try {
      const result = await withMongoTransaction(async (session) => {
        user = await UserModel.findOne({ email })
          .populate({
            path: "createdBy",
            select: "fullName email role phoneNumber",
          })
          .session(session);

        if (!user || !(await bcrypt.compare(password, user.password))) {
          throw {
            code: 400,
            message: "Invalid email or password",
          };
        }

        // return error if user account is not active or is suspended
        if (user.status === AccountStatusEnum.SUSPENDED) {
          throw {
            code: 400,
            message: "Account is suspended or inactive",
          };
        }

        const depositWallet = await WalletService.getWalletByOwnerId(
          user._id as string,
          WalletTypeEnum.DEPOSIT,
          session
        );
        const earningsWallet = await WalletService.getWalletByOwnerId(
          user._id as string,
          WalletTypeEnum.EARNINGS,
          session
        );
        const fundingWallet = await FundingWalletModel.findOne({
          owner: user._id,
        }).session(session);
        const paymentDetails = await PaymentDetailsModel.findOne({
          owner: user._id,
        }).session(session);

        const token = jwt.sign({ _id: user._id }, JWT_SECRET, {
          expiresIn: JWT_EXPIRY,
        });

        const data = {
          ...user.toObject(),
          password: undefined,
          token,
          depositWallet,
          earningsWallet,
          fundingWallet,
          paymentDetails,
        };

        return data;
      });

      return res
        .status(200)
        .json({ success: true, message: "Login successful", data: result });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error logging in",
        error: error?.message,
      });
    }
  }

  static async forgotPassword(req: Request, res: Response) {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    try {
      const user = await UserModel.findOne({ email });

      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Account not found",
        });
      }

      const passwordReset = await AccountService.initiatePasswordReset(
        user._id
      );

      if (!passwordReset) {
        return res.status(400).json({
          success: false,
          message: "Error sending password reset link",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Password reset link sent to email",
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error sending password reset link",
        error: error?.message,
      });
    }
  }

  static async resetPassword(req: Request, res: Response) {
    const { token, password } = req.body;

    try {
      const hashedToken = await TokenService.cryptoTokenHash(token);
      const user = await AccountService.findAccountWithPasswordResetToken(
        hashedToken
      );
      if (!user) {
        return res.status(400).json({
          success: false,
          message: "User not found",
        });
      }

      // reset password
      const updatedUser = await AccountService.resetPassword({
        email: user.email,
        token: hashedToken,
        password,
      });

      return res.status(200).json({
        success: true,
        message: "Password reset successful",
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error resetting password",
        error: error?.message,
      });
    }
  }
}
