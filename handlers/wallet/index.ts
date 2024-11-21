import { Request, Response } from "express";
import { withMongoTransaction } from "../../utils/mongoTransaction";
import {
  DepositWalletModel,
  EarningsWalletModel,
  IWallet,
  WalletTypeEnum,
} from "../../models/Wallet";
import {
  WalletTransactionModel,
  WalletTransactionType,
} from "../../models/WalletTransaction";
import { SuperVendorModel } from "../../models/SuperVendor";
import { PaymentStatusEnum, RoleName } from "../../types";
import { UserModel } from "../../models/User";
import { VendorModel } from "../../models/Vendor";
import { WalletService } from "../../services/wallet.service";
import { Config } from "../../utils/config";
import { DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_PAGE } from "../../utils/constants";
import { generateUniqueReference } from "../../utils";
import mongoose, { isValidObjectId } from "mongoose";
import { header, query, validationResult } from "express-validator";

export class WalletController {
  static async getAll(req: Request, res: Response) {
    const page = parseInt(req.query.page as string) || DEFAULT_QUERY_PAGE;
    const limit = parseInt(req.query.limit as string) || DEFAULT_QUERY_LIMIT;
    const skip = (Number(page) - 1) * Number(limit);

    try {
      const result = await withMongoTransaction(async (session) => {
        const allDepositWallets = await DepositWalletModel.find()
          .populate({
            path: "owner",
            select: "fullName phoneNumber email role",
          })
          .sort({ createdAt: -1 })
          .session(session);

        const allEarningWallets = await EarningsWalletModel.find()
          .populate({
            path: "owner",
            select: "fullName phoneNumber email role",
          })
          .sort({ createdAt: -1 })
          .session(session);

        const allWallets = [...allDepositWallets, ...allEarningWallets];
        const totalWallets = allWallets.length;

        // Sort combined results by createdAt
        allWallets.sort((a, b) => b.createdAt - a.createdAt);

        // Apply pagination to the combined results
        const paginatedWallets = allWallets.slice(skip, skip + limit);

        return {
          allWallets: paginatedWallets,
          totalWallets,
        };
      });

      res.status(200).json({
        success: true,
        message: "All wallets fetched successfully",
        total: result.totalWallets,
        page,
        data: result.allWallets,
      });
    } catch (error: any) {
      console.log("Get all wallets error: ", error);
      return res.status(500).json({
        success: false,
        message: "There was a problem fetching all wallets",
        error,
      });
    }
  }

  static async getByType(req: Request, res: Response) {
    const { type } = req.params;

    if (!type) {
      return res.status(400).json({
        success: false,
        message: "Wallet type is required",
      });
    }

    const page = parseInt(req.query.page as string) || DEFAULT_QUERY_PAGE;
    const limit = parseInt(req.query.limit as string) || DEFAULT_QUERY_LIMIT;
    const skip = (Number(page) - 1) * Number(limit);

    try {
      const result = await withMongoTransaction(async (session) => {
        let wallets: IWallet[] = [];
        let totalWallets = 0;

        if (type === WalletTypeEnum.DEPOSIT) {
          wallets = (await DepositWalletModel.find()
            .populate({
              path: "owner",
              select: "fullName phoneNumber email role",
            })
            .skip(skip)
            .limit(limit)
            .sort({ createdAt: -1 })
            .session(session)) as IWallet[];

          totalWallets = await DepositWalletModel.countDocuments().session(
            session
          );
        } else if (type === WalletTypeEnum.EARNINGS) {
          wallets = (await EarningsWalletModel.find()
            .populate({
              path: "owner",
              select: "fullName phoneNumber email role",
            })
            .skip(skip)
            .limit(limit)
            .sort({ createdAt: -1 })
            .session(session)) as IWallet[];

          totalWallets = await EarningsWalletModel.countDocuments().session(
            session
          );
        } else {
          throw new Error("Invalid wallet type");
        }

        return {
          wallets,
          totalWallets,
        };
      });

      return res.status(200).json({
        success: true,
        message: "Wallets fetched successfully",
        total: result.totalWallets,
        page,
        pages: Math.ceil(result.totalWallets / limit),
        data: result.wallets,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "There was a problem fetching wallets",
        error: error.message,
      });
    }
  }

  static async getById(req: Request, res: Response) {
    const { walletId } = req.params;

    try {
      const result = await withMongoTransaction(async (session) => {
        const wallet = await DepositWalletModel.findById(walletId).session(
          session
        );

        if (!wallet) {
          throw new Error("Wallet not found");
        }

        return wallet;
      });

      return res.status(200).json({
        success: true,
        message: "Wallet fetched successfully",
        data: result,
      });
    } catch (error: any) {
      console.log("Get wallet by owner error: ", error);
      return res.status(400).json({ success: false, message: error.message });
    }
  }

  static async getByUserId(req: Request, res: Response) {
    const { type } = req.body as { type: WalletTypeEnum };
    const { userId } = req.params;

    if (!userId || !type) {
      return res.status(400).json({
        success: false,
        message: "User ID and wallet type are required",
      });
    }

    if (!isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    try {
      let wallet: IWallet | null = null;

      if (type === WalletTypeEnum.DEPOSIT) {
        wallet = await WalletService.getWalletByOwnerId(
          userId,
          WalletTypeEnum.DEPOSIT
        );
      } else if (type === WalletTypeEnum.EARNINGS) {
        wallet = await WalletService.getWalletByOwnerId(
          userId,
          WalletTypeEnum.EARNINGS
        );
      } else {
        return res.status(400).json({
          success: false,
          message: "Invalid wallet type",
        });
      }

      if (!wallet) {
        return res.status(404).json({
          success: false,
          message: "Wallet not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Wallet fetched successfully",
        data: wallet,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching wallet",
        error: error.message,
      });
    }
  }

  static async fundVendorWallet(req: Request, res: Response) {
    const { vendorId, amount } = req.body;
    // userId of either super vendor or super admin (for case where super admin is funding on behalf of super vendor)
    const userId = req.headers["userid"];
    let superVendorUserId;

    const user = await UserModel.findById(userId);

    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: "User not found" });
    }

    if (user.role === RoleName.SuperAdmin) {
      superVendorUserId = req.body.superVendorUserId;
    } else {
      superVendorUserId = userId;
    }

    if (!superVendorUserId) {
      return res
        .status(400)
        .json({ success: false, message: "Super Vendor ID is required" });
    }

    if (!vendorId || !amount) {
      return res
        .status(400)
        .json({ success: false, message: "Vendor ID and amount are required" });
    }

    try {
      const result = await withMongoTransaction(async (session) => {
        // verify if amount is valid and upto the minimum deposit/funding amount

        if (Number(amount) < Number(Config.MIN_VENDOR_DEPOSIT))
          throw {
            code: 400,
            message: `Minimum deposit amount is ${Config.MIN_VENDOR_DEPOSIT}`,
          };

        const superVendorUserAccount = await UserModel.findById(
          superVendorUserId
        ).session(session);
        const superVendor = await SuperVendorModel.findOne({
          userId: superVendorUserId,
        }).session(session);

        if (!superVendorUserAccount || !superVendor)
          throw new Error("Super Vendor not found");

        // Check Super Vendor and Vendor existence and logic
        const superVendorWallet = await DepositWalletModel.findOne({
          owner: superVendorUserId,
        }).session(session);

        const vendorWallet = await DepositWalletModel.findOne({
          owner: superVendorUserId,
        }).session(session);

        if (!superVendorWallet)
          throw new Error("Super Vendor wallet not found");

        const vendor = await VendorModel.findById(vendorId).session(session);
        if (!vendor) throw new Error("Vendor not found");

        if (vendor.superVendor.toString() !== superVendorUserId.toString())
          throw new Error(
            "Access Denied! Vendor does not belong to Super Vendor"
          );

        const vendorUserAccount = await UserModel.findById(
          vendor.userId
        ).session(session);

        if (!vendorUserAccount)
          throw new Error("Vendor user account not found");

        const vendorDepositWallet = await WalletService.getWalletByOwnerId(
          vendorUserAccount._id,
          WalletTypeEnum.DEPOSIT,
          session
        );

        if (!vendorDepositWallet) throw new Error("Vendor wallet not found");

        if (superVendorWallet.balance < Number(amount))
          throw new Error("Insufficient funds in Super Vendor wallet");

        // Deduct funds from Super Vendor wallet and save the transaction
        const creditVendor = await WalletService.debitDepositWallet(
          superVendorUserId,
          Number(amount),
          WalletTransactionType.Transfer,
          superVendorUserId,
          vendorUserAccount._id,
          generateUniqueReference(),
          "Funding Vendor Wallet",
          PaymentStatusEnum.SUCCESSFUL,
          superVendorUserId,
          session
        );

        if (!creditVendor)
          throw {
            code: 500,
            message: "Error debiting Super Vendor wallet",
          };

        // Add funds to Vendor wallet
        const walletTransaction = await WalletService.creditDepositWallet(
          vendorUserAccount._id,
          Number(amount),
          WalletTransactionType.Funding,
          superVendorUserId,
          vendorUserAccount._id,
          generateUniqueReference(),
          "Funding",
          PaymentStatusEnum.SUCCESSFUL,
          superVendorUserId,
          session
        );

        const transaction = walletTransaction.transaction;

        await superVendorWallet.save({ session });
        await vendorWallet.save({ session });

        // Re-fetch the transaction with population
        const populatedTransaction = await WalletTransactionModel.findById(
          transaction[0]._id
        )
          .populate({
            path: "from",
            select: "fullName",
          })
          .populate({
            path: "to",
            select: "fullName",
          })
          .session(session);

        if (!populatedTransaction)
          throw new Error("Error populating transaction");

        return populatedTransaction;
      });

      return res.status(200).json({
        success: true,
        message: "Vendor wallet funded successfully",
        data: result,
      });
    } catch (error: any) {
      console.log("Fund Vendor wallet error: ", error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  static async transactionHistory(req: Request, res: Response) {
    const userId = req.headers["userid"] as string;
    const {
      receiver,
      transactionType,
      amount,
      page = DEFAULT_QUERY_PAGE,
      limit = DEFAULT_QUERY_LIMIT,
    } = req.query;

    try {
      const result = await WalletService.getTransactionHistoryByUser({
        userId,
        receiver: receiver as string,
        transactionType: transactionType as string,
        amount: amount as string,
        page: parseInt(page as string) || DEFAULT_QUERY_PAGE,
        limit: parseInt(limit as string) || DEFAULT_QUERY_LIMIT,
      });

      return res.status(200).json(result);
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        message: "There was a problem fetching transaction history",
        error: error.message,
      });
    }
  }

  static async getDisbursementTransactionHistory(req: Request, res: Response) {
    const userId = req.headers["userid"] as string;

    const { amount } = req.query;

    // validate via express-validator
    header("userid").isMongoId().withMessage("Invalid user ID");
    query("amount").optional().isNumeric().withMessage("Invalid amount");

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()?.[0].msg,
        errors: errors.array(),
      });
    }

    const user = await UserModel.findById(userId);

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User not found",
      });
    }

    const page = parseInt(req.query.page as string) || DEFAULT_QUERY_PAGE;
    const limit = parseInt(req.query.limit as string) || DEFAULT_QUERY_LIMIT;
    const skip = (Number(page) - 1) * Number(limit);

    try {
      const dbQuery: any = {
        type: WalletTransactionType.Disbursement,
      };

      if (user.role === RoleName.SuperAdmin) {
      }

      // Define the 'from', "to" & 'processedBy' value based on role
      if (user.role === RoleName.SuperVendor) {
        dbQuery["$or"] = [
          { from: new mongoose.Types.ObjectId(userId) },
          { to: new mongoose.Types.ObjectId(userId) },
          { processedBy: new mongoose.Types.ObjectId(userId) },
        ];
      }

      if (
        user.role !== RoleName.SuperAdmin &&
        user.role !== RoleName.SuperVendor
      ) {
        dbQuery["to"] = new mongoose.Types.ObjectId(userId);
      }

      if (amount) {
        dbQuery["amount"] = parseFloat(amount as string);
      }

      const transactions = await WalletTransactionModel.find(dbQuery)
        .populate({
          path: "from",
          select: "fullName role email",
        })
        .populate({
          path: "to",
          select: "fullName role email phoneNumber",
        })
        .populate({
          path: "processedBy",
          select: "fullName role email",
        })
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean();

      const totalTransactions = await WalletTransactionModel.countDocuments(
        dbQuery
      );

      return res.status(200).json({
        success: true,
        message: "Disbursement transaction history fetched successfully",
        page,
        totalPages: Math.ceil(totalTransactions / limit),
        total: totalTransactions,
        data: transactions,
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        message:
          "There was a problem fetching disbursement transaction history",
        error: error.message,
      });
    }
  }

  static async resetAllDepositBalances(_req: Request, res: Response) {
    try {
      const result = await withMongoTransaction(async (session) => {
        const wallets = await DepositWalletModel.find().session(session);

        if (!wallets || wallets.length === 0)
          throw new Error("No wallets found");

        for (const wallet of wallets) {
          wallet.balance = 0;
          await wallet.save({ session });
        }

        return wallets;
      });

      return res.status(200).json({
        success: true,
        message: "All wallet balances reset successfully",
        data: result,
      });
    } catch (error: any) {
      console.log("Reset all wallet balances error: ", error);
      return res.status(500).json({
        success: false,
        message: "There was a problem resetting all wallet balances",
        error: error.message,
      });
    }
  }

  static async resetEarningWalletHeldBalances(req: Request, res: Response) {
    const { walletId } = req.params;

    try {
      const wallet = await EarningsWalletModel.findById(walletId);

      if (!wallet) {
        return res.status(404).json({
          success: false,
          message: "Wallet not found",
        });
      }

      await WalletService.resetWalletHeldBalance(
        wallet,
        WalletTypeEnum.EARNINGS
      );

      return res.status(200).json({
        success: true,
        message: "Wallet held balance reset successfully",
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error resetting wallet held balance",
        error: error.message,
      });
    }
  }
}
