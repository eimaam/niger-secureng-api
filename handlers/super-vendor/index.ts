import { Request, Response } from "express";
import { withMongoTransaction } from "../../utils/mongoTransaction";
import { UserModel } from "../../models/User";
import { ISuperVendor, SuperVendorModel } from "../../models/SuperVendor";
import {
  FundingWalletModel,
  IFundingWallet,
  IWallet,
} from "../../models/Wallet";
import { IUser, RoleName } from "../../types";
import { checkAccountNumberExists } from "../../utils";
import { WalletService } from "../../services/wallet.service";
import { VendorModel } from "../../models/Vendor";
import { MonnifyService } from "../../services/monnify.wallet.service";
import { PaymentDetailsModel } from "../../models/PaymentDetail";
import { DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_PAGE } from "../../utils/constants";
import { SuperVendorService } from "../../services/supervendor.service";
import { body, param, validationResult } from "express-validator";

export class SuperVendor {
  static async create(req: Request, res: Response) {
    const {
      fullName,
      phoneNumber,
      email,
      accountNumber,
      accountName,
      bankCode,
    } = req.body;

    const userId = req.headers["userid"];

    if (!accountNumber || !accountName || !bankCode) {
      return res.status(400).json({
        success: false,
        message: "Account number, account name and bank code are required",
      });
    }

    if (!fullName || !phoneNumber || !email) {
      return res.status(400).json({
        success: false,
        message: "Full name, phone number and email are required",
      });
    }

    try {
      const result = await withMongoTransaction(async (session) => {
        const existingUser: IUser | null = await UserModel.findOne({
          $or: [{ phoneNumber }, { email }],
        }).session(session);

        if (existingUser) {
          throw {
            code: 400,
            message: "Super Vendor account already exists",
          };
        }

        const existingSuperVendor = await SuperVendorModel.findOne({
          $or: [{ email }, { phoneNumber }],
        }).session(session);

        if (existingSuperVendor) {
          throw { code: 400, message: "Super Vendor data exists" };
        }
        const existingFundingWallet = await FundingWalletModel.findOne({
          accountEmail: email,
        }).session(session);

        if (existingFundingWallet) {
          throw { code: 400, message: "Wallet with this Email already exists" };
        }

        const newUserData = {
          fullName,
          phoneNumber: phoneNumber,
          email,
          password: phoneNumber,
          role: RoleName.SuperVendor,
          createdBy: userId,
        };

        const newUserAccount: IUser[] = await UserModel.create([newUserData], {
          session,
        });

        if (!newUserAccount) {
          throw { code: 500, message: "Error creating user account" };
        }

        const newEarningsWallet: IWallet[] =
          await WalletService.createEarningsWallet(
            newUserAccount[0]._id as string,
            session
          );

        const newDepositWallet: IWallet[] =
          await WalletService.createDepositWallet(
            newUserAccount[0]._id as string,
            session
          );

        if (!newDepositWallet || !newEarningsWallet) {
          throw { code: 500, message: "Error creating wallets" };
        }

        const monnifyReservedAccount = await MonnifyService.reserveAccount(
          newUserAccount[0]._id as string,
          fullName,
          email
        );

        // Loop through the accounts array and check for each account number if it already exists or assigned to another user
        for (const account of monnifyReservedAccount.accounts) {
          const accountExists = await checkAccountNumberExists(
            account.accountNumber
          );
          if (accountExists) {
            throw new Error(
              `Account number ${account.accountNumber} already exists.`
            );
          }
        }

        const newFundingWallet: IFundingWallet[] =
          await FundingWalletModel.create(
            [
              {
                owner: newUserAccount[0]._id,
                accountReference: newUserAccount[0]._id,
                accountName: fullName,
                accountEmail: email,
                accounts: monnifyReservedAccount.accounts,
                reservationReference:
                  monnifyReservedAccount.reservationReference,
                status: monnifyReservedAccount.status,
              },
            ],
            { session }
          );

        const withdrawalBank = await MonnifyService.getBankDetailsByCode(
          bankCode
        );

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

        const newSuperVendor: ISuperVendor[] = await SuperVendorModel.create(
          [
            {
              fullName,
              phoneNumber,
              email,
              depositWallet: newDepositWallet[0]._id,
              earningsWallet: newEarningsWallet[0]._id,
              fundingWallet: newFundingWallet[0]._id,
              paymentDetails: paymentDetails[0]._id,
              userId: newUserAccount[0]._id,
              createdBy: userId,
            },
          ],
          { session }
        );

        const data = {
          ...newSuperVendor[0].toObject(),
          ...monnifyReservedAccount,
          paymentDetails: paymentDetails?.[0],
        };

        return data;
      });

      return res.status(201).json({
        success: true,
        message: "Super Vendor created successfully",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error creating vendor",
        error: error?.message,
      });
    }
  }

  static async transferVendorDepositBalance(req: Request, res: Response) {
    const { vendorId } = req.params;

    const { amount } = req.body;

    // validate via express validator
    const validationReq = [
      body("amount")
        .isNumeric()
        .withMessage("Amount must be a number")
        .notEmpty()
        .withMessage("Amount is required"),
      param("vendorId")
        .isMongoId()
        .withMessage("Vendor ID must be a valid ID")
        .notEmpty()
        .withMessage("Vendor ID is required"),
    ];

    await Promise.all(validationReq.map((validation) => validation.run(req)));

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors?.array()?.[0]?.msg,
        errors: errors.array(),
      });
    }

    try {
      const response =
        await SuperVendorService.vendorDepositWalletBalanceTransfer(
          vendorId,
          amount
        );

      return res.status(200).json({
        success: true,
        message: "Vendor balance transferred successfully",
        data: response,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error transferring vendor balance",
        error: error.message,
      });
    }
  }

  static async getVendors(req: Request, res: Response) {
    const superVendorId = req.params.superVendorId || req.headers["userid"];
    const page = parseInt(req.query.page as string) || DEFAULT_QUERY_PAGE;
    const limit = parseInt(req.query.limit as string) || DEFAULT_QUERY_LIMIT;
    const skipIndex = (page - 1) * limit;
    try {
      const result = await withMongoTransaction(async (session) => {
        const superVendor = await SuperVendorModel.findOne({
          userId: superVendorId,
        }).session(session);

        if (!superVendor) {
          throw { code: 404, message: "Super Vendor not found" };
        }

        const allVendors = await VendorModel.find({
          superVendor: superVendorId,
        })
          .populate({
            path: "superVendor",
            select: "fullName phoneNumber email",
          })
          .populate({
            path: "paymentDetails",
            select: "accountNumber accountName bankName",
          })
          .session(session);

        const totalVendors = await VendorModel.countDocuments({
          superVendor: superVendorId,
        }).session(session);

        return {
          allVendors,
          totalVendors,
        };
      });

      return res.status(200).json({
        success: true,
        message: "All Super Vendor's Vendors fetched successfully",
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

  static async getOne(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const superVendor = await SuperVendorModel.findById(id).populate(
        "userId"
      );

      if (!superVendor) {
        return res.status(404).json({
          success: false,
          message: "Super Vendor not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Super Vendor fetched successfully",
        data: superVendor,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching Super Vendor",
        error,
      });
    }
  }

  static async getAll(req: Request, res: Response) {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    try {
      const result = await withMongoTransaction(async (session) => {
        const allSuperVendors = await SuperVendorModel.find({})
          .populate({
            path: "createdBy",
            select: "fullName phoneNumber",
          })
          .populate({
            path: "depositWallet",
            select: "balance",
          })
          .populate({
            path: "earningsWallet",
            select: "balance",
          })
          .populate({
            path: "fundingWallet",
            select: "accounts",
          })
          .populate("paymentDetails")
          .skip(skip)
          .limit(limit)
          .session(session);

        const totalSuperVendors =
          await SuperVendorModel.countDocuments().session(session);

        return {
          allSuperVendors,
          totalSuperVendors,
        };
      });

      return res.status(200).json({
        success: true,
        message: "All vendors fetched successfully",
        total: result.totalSuperVendors,
        page,
        data: result.allSuperVendors,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching vendors",
        error,
      });
    }
  }

  static async update(req: Request, res: Response) {
    const { id } = req.params;
    const {
      fullName,
      phoneNumber,
      email,
      accountName,
      accountNumber,
      bankCode,
    } = req.body;
    try {
      const result = await withMongoTransaction(async (session) => {
        // check for existing user with same phone or email
        const existingUser = await UserModel.findOne({
          $or: [{ phoneNumber }, { email }],
        }).session(session);

        // check for existing super vendor with same phone or email
        const existingSuperVendor = await SuperVendorModel.findOne({
          $or: [{ email }, { phoneNumber }],
        }).session(session);

        if (existingUser || existingSuperVendor) {
          throw {
            code: 400,
            message:
              "User Account or Super Vendor with this phone number or email already exists",
          };
        }

        const updateData = {
          fullName,
          phoneNumber,
          email,
        };

        const superVendor = await SuperVendorModel.findByIdAndUpdate(
          id,
          updateData,
          {
            new: true,
            runValidators: true,
            session,
          }
        );

        if (!superVendor) {
          throw { code: 404, message: "Super Vendor not found" };
        }

        if (accountNumber || accountName || bankCode) {
          const updatedPaymentDetails =
            await PaymentDetailsModel.findByIdAndUpdate(
              superVendor.paymentDetails,
              { accountNumber, accountName, bankCode },
              { new: true, runValidators: true, session }
            );
        }

        const updatedUser = await UserModel.findByIdAndUpdate(
          superVendor.userId,
          { ...updateData },
          {
            new: true,
            runValidators: true,
            session,
          }
        );

        return superVendor.populate("userId");
      });

      return res.status(200).json({
        success: true,
        message: "Super Vendor updated successfully",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error updating Super Vendor",
        error,
      });
    }
  }

  static async delete(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const result = await withMongoTransaction(async (session) => {
        const superVendor = await SuperVendorModel.findByIdAndDelete(id, {
          session,
        });

        const userAccount = await UserModel.findByIdAndDelete(
          superVendor?.userId,
          { session }
        );

        const userWallets = await WalletService.deleteEarningsAndDepositWallets(
          userAccount?._id,
          session
        );

        const userFundingWallet = await FundingWalletModel.findOneAndDelete(
          { owner: userAccount?._id },
          { session }
        );

        return superVendor;
      });

      return res.status(200).json({
        success: true,
        message: "Super Vendor deleted successfully",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error deleting Super Vendor",
        error: error.message,
      });
    }
  }
}
