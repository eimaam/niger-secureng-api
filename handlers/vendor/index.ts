import { Request, Response } from "express";
import { IVendor, VendorModel } from "../../models/Vendor";
import { WalletService } from "../../services/wallet.service";
import { UserModel } from "../../models/User";
import { IUser, RoleName } from "../../types";
import { withMongoTransaction } from "../../utils/mongoTransaction";
import { generatePassword } from "../../utils";
import { ISuperVendor, SuperVendorModel } from "../../models/SuperVendor";
import { performance } from "perf_hooks";
import { UserService } from "../../services/user.service";
import { WalletTypeEnum } from "../../models/Wallet";
import { MonnifyService } from "../../services/monnify.wallet.service";
import { PaymentDetailsModel } from "../../models/PaymentDetail";
import { BeneficiaryService } from "../../services/beneficiary.service";
import { Types } from "mongoose";

export class Vendors {
  static async create(req: Request, res: Response) {
    const {
      fullName,
      phoneNumber,
      email,
      accountName,
      accountNumber,
      bankCode,
      // available if the account is being created by SuperAdmin on behalf of a SuperVendor
      superVendorId,
    } = req.body;
    const userId = req.headers["userid"];

    if (!fullName || !phoneNumber || !email) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    if (!accountNumber || !accountName || !bankCode) {
      return res.status(400).json({
        success: false,
        message: "Account number, account name and bank code are required",
      });
    }


    try {
      const result = await withMongoTransaction(async (session) => {

        if (superVendorId) {
          const checkSuperAdmin = await UserModel.findById(userId);
    
          if (!checkSuperAdmin || checkSuperAdmin.role !== RoleName.SuperAdmin) {
            throw {
              code: 403,
              message: "You are not authorized to perform this action",
            };
          }
    
        }

        const existingSuperVendor =  await SuperVendorModel.findOne(superVendorId ? {_id: superVendorId} : {userId}).session(session) as ISuperVendor;

        if (!existingSuperVendor) {
          throw {
            code: 400,
            message: "Super Vendor account does not exist",
          };
        }

        const existingVendorAccount = await UserModel.findOne({
          $or: [{ phoneNumber }, { email }],
        }).session(session);

        if (existingVendorAccount) {
          const existingDepositWallet = await WalletService.getWalletByOwnerId(
            existingVendorAccount._id,
            WalletTypeEnum.DEPOSIT,
            session
          );

          const existingEarningsWallet = await WalletService.getWalletByOwnerId(
            existingVendorAccount._id,
            WalletTypeEnum.EARNINGS,
            session
          );

          if (existingDepositWallet || existingEarningsWallet) {
            throw {
              code: 400,
              message: "Vendor account exists",
            };
          }
        }

        const existingVendor = await VendorModel.findOne({
          $or: [{ email }, { phoneNumber }],
        }).session(session);

        if (existingVendor) {
          throw {
            code: 400,
            message: "Vendor data exists",
          };
        }

        // create new vendor account if user does not exist

        const newUserData = {
          fullName,
          phoneNumber,
          email,
          role: RoleName.Vendor,
          password: phoneNumber,
          createdBy: userId,
        };

        const newUserAccount: IUser[] = await UserModel.create([newUserData], {
          session,
        });

        if (!newUserAccount) {
          throw {
            code: 500,
            message: "Failed to create user account",
          };
        }

        // create deposit and earnings wallet for the new user account
        const newDepositWallet = await WalletService.createDepositWallet(
          newUserAccount[0]._id as string,
          session
        );

        const newEarningsWallet = await WalletService.createEarningsWallet(
          newUserAccount[0]._id as string,
          session
        );

        const withdrawalBank = await MonnifyService.getBankDetailsByCode(bankCode); 

          // save payment account details 
          const paymentAccountDetails = {
            accountNumber,
            accountName,
            bankCode,
            bankName: withdrawalBank?.name,
            owner: newUserAccount[0]._id,
          };

          const paymentDetails = await PaymentDetailsModel.create(
            [paymentAccountDetails],
            { session }
          ); 

        await BeneficiaryService.addUserToTaxPaymentBeneficiaries(
          newUserAccount?.[0]?._id as Types.ObjectId,
          RoleName.Vendor,
          session
        );

        const newVendor: IVendor[] = await VendorModel.create(
          [
            {
              fullName,
              phoneNumber,
              email,
              depositWallet: newDepositWallet[0]._id,
              earningsWallet: newEarningsWallet[0]._id,
              userId: newUserAccount[0]._id,
              paymentDetails: paymentDetails[0]._id,
              superVendor: superVendorId ? existingSuperVendor?.userId : userId,
            },
          ],
          { session }
        );

        const updateSuperVendor = await SuperVendorModel.findByIdAndUpdate(
          existingSuperVendor._id,
          {
            $push: {
              vendors: newUserAccount[0]._id,
            },
          },
          { session }
        );

        if (!updateSuperVendor) {
          throw {
            code: 500,
            message: "Failed to update Super Vendor",
          };
        }

        return newVendor[0];
      });

      return res.status(201).json({
        success: true,
        message: "Vendor created successfully",
        data: result,
      });
    } catch (error: any) {
      console.log({ error });
      return res.status(500).json({
        success: false,
        message: "Error creating vendor",
        error,
      });
    }
  }

  static async getAll(req: Request, res: Response) {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skipIndex = (page - 1) * limit;

    const userId = req.headers["userid"] as string;

    try {
      const result = await withMongoTransaction(async (session) => {

        const user = await UserService.getUserById(userId, session);

        let allVendors: IVendor[] = [];

        // the role check middle ware will not allow any user that's not any of the below access the endpoint

        if (user.role === RoleName.SuperAdmin){
          allVendors = await VendorModel.find({})
            .populate({
              path: "superVendor",
              select: "fullName phoneNumber email",
            })
            .populate("depositWallet")
            .populate("earningsWallet")
            .populate("paymentDetails")
            .skip(skipIndex)
            .limit(limit)
            .session(session);
        } 

        if (user.role === RoleName.SuperVendor || user.role === RoleName.SuperVendorAdmin) {
          allVendors = await VendorModel.find({ superVendor: userId })
            .populate({
              path: "superVendor",
              select: "fullName phoneNumber email",
            })
            .populate("depositWallet")
            .populate("earningsWallet")
            .populate("paymentDetails")
            .skip(skipIndex)
            .limit(limit)
            .session(session);
        }

        const totalVendors = await VendorModel.countDocuments().session(
          session
        );

        

        return {
          allVendors,
          totalVendors,
        };
      });

      return res.status(200).json({
        success: true,
        message: "All vendors fetched successfully",
        total: result?.totalVendors,
        page,
        totalPages: Math.ceil(result?.totalVendors / limit),
        data: result?.allVendors,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving vendors",
        error: error.message,
      });
    }
  }

  static async getById(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const vendor = await VendorModel.findById(id)
        .populate("userId")
        .populate("depositWallet")
        .populate("earningsWallet")
        .populate("superVendor");

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Vendor fetched successfully",
        data: vendor,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving vendor",
        error: error.message,
      });
    }
  }

  static async update(req: Request, res: Response) {
    const { id } = req.params;
    const { fullName, phoneNumber, email, accountName, accountNumber, bankCode } = req.body;

    try {
      const result = await withMongoTransaction(async (session) => {
        // check existing account having the same phone number or email

        const existingVendorAccount = await UserModel.findOne({
          $or: [{ phoneNumber }, { email }],
        }).session(session);

        // check existing vendor data having the same phone number or email
        const existingVendor = await VendorModel.findOne({
          $or: [{ email }, { phoneNumber }],
        }).session(session);

        if (existingVendorAccount || existingVendor) {
          throw {
            code: 400,
            message:
              "Duplicate! Vendor with this email or phone number already exsists.",
          };
        }

        const updateData = {
          fullName,
          phoneNumber,
          email,
        };
        const vendor = await VendorModel.findByIdAndUpdate(id, updateData, {
          new: true,
          runValidators: true,
          session,
        });

        if (!vendor) {
          throw {
            code: 404,
            message: "Vendor not found",
          };
        }

        if (accountName || accountNumber || bankCode) {
          const updatedPaymentDetails = await PaymentDetailsModel.findOneAndUpdate(
            { owner: vendor.userId },
            {
              accountNumber,
              accountName,
              bankCode,
            },
            { new: true, runValidators: true, session }
          );
        }

        const updatedVendorUserAccount = await UserModel.findByIdAndUpdate(
          vendor.userId,
          {
            ...updateData,
          },
          { new: true, runValidators: true, session }
        );

        return vendor.populate("userId");
      });

      return res.status(200).json({
        success: true,
        message: "Vendor updated successfully",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error updating vendor",
        error,
      });
    }
  }

  static async delete(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const result = await withMongoTransaction(async (session) => {
        const vendor = await VendorModel.findByIdAndDelete(id, { session });
        if (!vendor) {
          throw {
            code: 404,
            message: "Vendor Not Found",
          };
        }

        const deletedUser = await UserModel.findByIdAndDelete(vendor.userId, {
          session,
        });

        if (!deletedUser) {
          throw {
            code: 404,
            message: "User Not Found",
          };
        }

        const deletedWallet = await WalletService.delete(
          deletedUser._id,
          session
        );

        if (!deletedWallet) {
          throw {
            code: 404,
            message: "Wallet Not Found",
          };
        }

        return vendor;
      });

      return res.status(200).json({
        success: true,
        message: "Vendor deleted successfully",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error deleting vendor",
        error: error.message,
      });
    }
  }
}
