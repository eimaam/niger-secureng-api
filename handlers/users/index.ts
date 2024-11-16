import { Request, Response } from "express";
import { UserModel } from "../../models/User";
import { AccountStatusEnum, IUser, RoleName } from "../../types";
import { generatePassword } from "../../utils";
import bcrypt from "bcrypt";
import { withMongoTransaction } from "../../utils/mongoTransaction";
import { WalletService } from "../../services/wallet.service";
import {
  DepositWalletModel,
  EarningsWalletModel,
  FundingWalletModel,
  WalletTypeEnum,
} from "../../models/Wallet";
import { PaymentDetailsModel } from "../../models/PaymentDetail";
import MonnifySupportedBankModel from "../../models/MonnifySupportedBank";

export const NO_PAYMENT_DETAILS_REQUIRED_ROLES = [
  RoleName.SuperAdmin,
  RoleName.Admin,
  RoleName.Consultant,
  RoleName.Developer,
];

export class User {
  // Add/create new user
  static async create(req: Request, res: Response) {
    const {
      fullName,
      phoneNumber,
      email,
      role,
      hasPaymentDetails,
      accountName,
      accountNumber,
      bankCode,
    } = req.body;

    const userId = req.headers["userid"] as string;

    if (hasPaymentDetails && (!accountName || !bankCode || !accountNumber)) {
      return res.status(400).json({
        success: false,
        message: "Please provide all payment details",
      });
    }

    if (!fullName || !phoneNumber || !email || !role) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    // Generate default password > will be hashed via the pre save hook in mongoose model
    const defaultPassword = await generatePassword();

    try {
      const result = await withMongoTransaction(async (session) => {
        // Verify no STAKEHOLDER, GOVERNMENT, or CONSULTANT roles account has been created already

        if (
          role === RoleName.SuperAdmin ||
          role === RoleName.Government ||
          role === RoleName.Consultant
        ) {
          const existingAccount = await UserModel.findOne({
            role: role,
          }).session(session);

          if (existingAccount) {
            throw {
              code: 400,
              message: `You can not create multiple accounts with the selected Role - ${role}`,
            };
          }
        }

        const existingUser = await UserModel.findOne({
          $or: [{ phoneNumber }, { email }],
        }).session(session);

        if (existingUser)
          throw {
            code: 400,
            message: "User already exists",
          };

        const userData = {
          fullName,
          phoneNumber,
          email,
          // TODO: update to use generated password > default password above^ after implementing email sending on account creation
          // do same for vendor, super vendor and all other accounts with login feature
          password: phoneNumber,
          createdBy: req.query.userId || userId,
          role,
        };

        const newUser: IUser[] = await UserModel.create([userData], {
          session,
        });

        // Create earnings wallet for the user
        const newEarningsWallet = await EarningsWalletModel.create(
          [
            {
              owner: newUser[0]._id,
            },
          ],
          { session }
        );

        if (!newEarningsWallet)
          throw {
            code: 500,
            message: "Error creating earnings wallet",
          };

        let newPaymentDetails = null;

        if (hasPaymentDetails) {
          // create payment details > bank details for withdrawal
          const selectedBank = await MonnifySupportedBankModel.findOne({
            code: bankCode,
          }).session(session);

          const paymentDetails = {
            accountName,
            bankName: selectedBank?.name,
            accountNumber,
            bankCode,
            owner: newUser[0]._id,
          };

          newPaymentDetails = await PaymentDetailsModel.create(
            [paymentDetails],
            { session }
          );
        }

        // return the data with the default password not the hashed password
        const data = {
          ...newUser[0].toObject(),
          password: phoneNumber,
          earningsWallet: newEarningsWallet[0],
          paymentDetails: newPaymentDetails?.[0],
        };

        return data;
      });

      // return the data with the default password not the hashed password
      // const data = {
      //   ...result.toObject(),
      //   password: phoneNumber,
      // };

      return res.status(201).json({
        success: true,
        message: "User created successfully",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error creating user",
        error: error.message,
      });
    }
  }

  static async getProfile(req: Request, res: Response) {
    const { userId } = req.params;

    try {
      const result = await withMongoTransaction(async (session) => {
        const user = await UserModel.findById(userId)
          .populate("createdBy")
          .session(session);
        const depositWallet = await WalletService.getWalletByOwnerId(
          user._id,
          WalletTypeEnum.DEPOSIT,
          session
        );
        const earningsWallet = await WalletService.getWalletByOwnerId(
          user._id,
          WalletTypeEnum.EARNINGS,
          session
        );
        const fundingWallet = await FundingWalletModel.findOne({
          owner: user._id,
        }).session(session);
        const paymentDetails = await PaymentDetailsModel.findOne({
          owner: user._id,
        }).session(session);

        if (!user)
          throw {
            code: 404,
            message: "User not found",
          };

        const data = {
          ...user.toObject(),
          depositWallet,
          earningsWallet,
          fundingWallet,
          paymentDetails,
        };
        return data;
      });
      return res.status(200).json({
        success: true,
        message: "User profile fetched successfully",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching user profile",
        error: error.message,
      });
    }
  }

  //get or reterieve a sigle user
  static async singleUser(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const singleUser = await UserModel.findById(id).select("-password");

      if (!singleUser) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      return res.status(200).json({
        success: true,
        message: "Single user data fetched successfully",
        user: singleUser,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving single user",
        error: error.message,
      });
    }
  }

  // Get all users
  static async getAllUsers(_req: Request, res: Response) {
    try {
      const allUsers = await UserModel.find({})
        .populate("createdBy")
        .select("-password");

      return res.status(200).json({
        success: true,
        message: "Users list fetched successfully",
        data: allUsers,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving users",
        error: error.message,
      });
    }
  }

  //Update users
  static async updateUser(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { username, fullName, phoneNumber, email } = req.body;
      const updatedUser = await UserModel.findByIdAndUpdate(
        id,
        { username, fullName, phoneNumber, email },
        { new: true }
      );

      if (!updatedUser) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      return res.status(200).json({
        success: true,
        message: "User updated successfully",
        user: updatedUser,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error updating user",
        error: error.message,
      });
    }
  }

  //delete user by ID
  static async deleteUser(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const deletedUser = await UserModel.findByIdAndDelete(id);

      if (!deletedUser) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      return res
        .status(200)
        .json({ success: true, message: "User deleted successfully" });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error deleting user",
        error: error.message,
      });
    }
  }

  // update password from default password to a new password
  static async updateDefaultPassword(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const { password, newPassword } = req.body;
      const user: IUser | null = await UserModel.findById(userId);

      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      // Verify the current password
      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        return res
          .status(400)
          .json({ success: false, message: "Current password is incorrect" });
      }

      if (!user.isDefaultPassword) {
        return res.status(400).json({
          success: false,
          message: "Password has already been updated",
        });
      }

      user.password = newPassword;
      user.isDefaultPassword = false;
      user.status = AccountStatusEnum.ACTIVE;
      const updatedUser = await user.save();

      return res.status(200).json({
        success: true,
        message: "Password updated successfully",
        data: updatedUser,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error updating user password",
        error: error.message,
      });
    }
  }
}
