import { Request, Response } from "express";
import mongoose, { ClientSession, Types } from "mongoose";
import {
  IWallet,
  DepositWalletModel,
  EarningsWalletModel,
  WalletTypeEnum,
} from "../models/Wallet";
import { UserModel } from "../models/User";
import { PaymentStatusEnum, RoleName } from "../types";
import { DEFAULT_QUERY_PAGE } from "../utils/constants";
import { withMongoTransaction } from "../utils/mongoTransaction";
import {
  IWalletTransaction,
  WalletTransactionModel,
  WalletTransactionType,
} from "../models/WalletTransaction";

interface WalletTransactionQuery {
  userId: string;
  receiver?: string;
  transactionType?: string;
  amount?: string;
  page?: number;
  limit?: number;
}

export class WalletService {
  static async createDepositWallet(userId: string, session?: ClientSession) {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new Error("Invalid user ID");
    }

    try {
      const mongoSession = session ?? null;
      const newWallet = await DepositWalletModel.create([{ owner: userId }], {
        session: mongoSession,
      });
      return newWallet;
    } catch (error) {
      throw new Error("Error creating wallet");
    }
  }

  static async createEarningsWallet(userId: string, session?: ClientSession) {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new Error("Invalid user ID");
    }

    try {
      const mongoSession = session ?? null;
      const newWallet = await EarningsWalletModel.create([{ owner: userId }], {
        session: mongoSession,
      });
      return newWallet;
    } catch (error) {
      throw new Error("Error creating wallet");
    }
  }

  static async getWalletHeldBalance(
    walletId: string,
    walletType: WalletTypeEnum,
    session?: ClientSession
  ) {
    const mongoSession = session ?? null;
    const wallet =
      walletType === WalletTypeEnum.EARNINGS
        ? await EarningsWalletModel.findById(walletId).session(mongoSession)
        : await DepositWalletModel.findById(walletId).session(mongoSession);

    return wallet?.heldBalance;
  }

  static async getAvailableBalance(
    walletId: string,
    walletType: WalletTypeEnum,
    session?: ClientSession
  ) {
    const mongoSession = session ?? null;
    const wallet =
      walletType === WalletTypeEnum.EARNINGS
        ? await EarningsWalletModel.findById(walletId).session(mongoSession)
        : await DepositWalletModel.findById(walletId).session(mongoSession);

    const availableBalance = wallet?.balance - (wallet?.heldBalance ?? 0);

    return availableBalance;
  }

  static async holdWalletBalance(
    walletId: string,
    amount: number,
    walletType: WalletTypeEnum,
    session?: ClientSession
  ) {
    const mongoSession = session ?? null;
    const WalletModel =
      walletType === WalletTypeEnum.EARNINGS
        ? EarningsWalletModel
        : DepositWalletModel;

    const wallet = await WalletModel.findByIdAndUpdate(
      walletId,
      { $inc: { heldBalance: amount } },
      { session: mongoSession, new: true, runValidators: true }
    );

    if (!wallet) {
      throw new Error("Wallet not found");
    }

    const heldBalance = wallet.heldBalance ?? 0;

    return heldBalance;
  }

  static async releaseHeldWalletBalance(
    walletId: mongoose.Types.ObjectId | string,
    amount: number,
    walletType: WalletTypeEnum,
    session?: ClientSession
  ) {
    const mongoSession = session ?? null;
    const WalletModel =
      walletType === WalletTypeEnum.EARNINGS
        ? EarningsWalletModel
        : DepositWalletModel;

    const wallet = await WalletModel.findByIdAndUpdate(
      walletId,
      { $inc: { heldBalance: -amount } },
      { session: mongoSession, new: true, runValidators: true }
    );

    if (!wallet) {
      throw new Error("Wallet not found");
    }

    return wallet;
  }

  static async resetWalletHeldBalance(
    walletId: string,
    walletType: WalletTypeEnum,
    session?: ClientSession
  ) {
    const mongoSession = session ?? null;
    const WalletModel =
      walletType === WalletTypeEnum.EARNINGS
        ? EarningsWalletModel
        : DepositWalletModel;

    const wallet = await WalletModel.findByIdAndUpdate(
      walletId,
      { heldBalance: 0 },
      { session: mongoSession, new: true, runValidators: true }
    );

    if (!wallet) {
      throw new Error("Wallet not found");
    }

    return wallet;
  }

  static async getWalletByOwnerId(
    userId: mongoose.Types.ObjectId | string,
    type: WalletTypeEnum,
    session?: ClientSession
  ) {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new Error("Invalid user ID");
    }

    try {
      const mongoSession = session ?? null;
      let wallet: IWallet | null = null;
      if (type === WalletTypeEnum.EARNINGS) {
        wallet = await EarningsWalletModel.findOne({ owner: userId }, null, {
          session: mongoSession,
        });
      } else {
        wallet = await DepositWalletModel.findOne({ owner: userId }, null, {
          session: mongoSession,
        });
      }

      return wallet;
    } catch (error) {
      throw new Error("Error fetching wallet");
    }
  }

  static async creditDepositWallet(
    userId: mongoose.Types.ObjectId | string,
    amount: number,
    type: WalletTransactionType,
    from: Types.ObjectId,
    to: Types.ObjectId,
    reference: string,
    description: string,
    status: PaymentStatusEnum = PaymentStatusEnum.SUCCESSFUL,
    processedBy: mongoose.Types.ObjectId,
    session?: ClientSession
  ) {
    return this.creditWallet(
      DepositWalletModel,
      userId,
      amount,
      type,
      from,
      to,
      reference,
      description,
      status,
      processedBy,
      session
    );
  }

  /**
   * Debit the deposit wallet of a user
   * @param userId The userId of the user to debit from
   * @param amount The amount to debit in +ve integer
   * @param type The type of transaction
   * @param from The ID of the sender of the transaction > the user's ID
   * @param to The ID of the receiver of the transaction > the user's ID
   * @param reference A unique reference for the transaction
   * @param description A description of the transaction
   * @param status The status of the transaction from PaymentStatusEnum
   * @param processedBy The ID of the user processing the transaction
   * @param session The Mongoose session
   * @returns The wallet and transaction data
   */
  static async debitDepositWallet(
    userId: mongoose.Types.ObjectId | string,
    amount: number,
    type: WalletTransactionType,
    from: Types.ObjectId,
    to: Types.ObjectId,
    reference: string,
    description: string,
    status: PaymentStatusEnum = PaymentStatusEnum.SUCCESSFUL,
    processedBy: mongoose.Types.ObjectId,
    session?: ClientSession
  ) {
    return this.debitWallet(
      DepositWalletModel,
      userId,
      amount,
      type,
      from,
      to,
      reference,
      description,
      status,
      processedBy,
      session
    );
  }

  static async creditEarningsWallet(
    ownerUserId: mongoose.Types.ObjectId | string,
    amount: number,
    type: WalletTransactionType,
    from: Types.ObjectId,
    to: Types.ObjectId,
    reference: string,
    description: string,
    status: PaymentStatusEnum = PaymentStatusEnum.SUCCESSFUL,
    processedBy: mongoose.Types.ObjectId,
    session?: ClientSession
  ) {
    return this.creditWallet(
      EarningsWalletModel,
      ownerUserId,
      amount,
      type,
      from,
      to,
      reference,
      description,
      status,
      processedBy,
      session
    );
  }

  static async debitEarningsWallet(
    userId: string,
    amount: number,
    type: WalletTransactionType,
    from: Types.ObjectId,
    to: Types.ObjectId,
    reference: string,
    description: string,
    status: PaymentStatusEnum = PaymentStatusEnum.SUCCESSFUL,
    processedBy: mongoose.Types.ObjectId,
    session?: ClientSession
  ) {
    return this.debitWallet(
      EarningsWalletModel,
      userId,
      amount,
      type,
      from,
      to,
      reference,
      description,
      status,
      processedBy,
      session
    );
  }

  static async getTransactionHistoryByUser(query: WalletTransactionQuery) {
    const {
      userId,
      receiver = "",
      transactionType = "",
      amount = "",
      page = DEFAULT_QUERY_PAGE,
      limit = DEFAULT_QUERY_PAGE,
    } = query;
    const skip = Number(page - 1) * limit;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new Error("Invalid user ID");
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    try {
      const result = await withMongoTransaction(async (session) => {
        // Additional filters
        const filters: any = {};

        // Base query depends on user role
        const baseQuery =
          user.role === RoleName.SuperAdmin
            ? {} // Empty query to get all transactions
            : {
                $or: [
                  { from: new mongoose.Types.ObjectId(userId) },
                  { to: new mongoose.Types.ObjectId(userId) },
                ],
              };

        if (receiver) {
          const receiverUser = await UserModel.findOne({
            $or: [
              { email: new RegExp(receiver, "i") },
              { phoneNumber: new RegExp(receiver, "i") },
            ],
          }).select("_id");

          if (!receiverUser) {
            return { transactions: [], totalTransactions: 0 };
          }
          filters["to"] = receiverUser._id;
        }

        if (transactionType) {
          filters["type"] = transactionType;
        }

        if (amount) {
          filters["amount"] = parseFloat(amount);
        }

        // Only add $and if there are actual filters
        const dbQuery =
          Object.keys(filters).length > 0
            ? { $and: [baseQuery, filters] }
            : baseQuery;

        const [transactions, totalTransactions] = await Promise.all([
          WalletTransactionModel.find(dbQuery)
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
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .session(session),

          WalletTransactionModel.countDocuments(dbQuery).session(session),
        ]);

        return {
          transactions,
          totalTransactions,
        };
      });

      return {
        success: true,
        message: "Wallet transaction history fetched successfully",
        total: result.totalTransactions,
        page,
        totalPages: Math.ceil(result.totalTransactions / limit),
        data: result.transactions,
      };
    } catch (error: any) {
      console.error("Get wallet transaction history error:", error);
      throw new Error("Failed to fetch transaction history");
    }
  }

  // delete
  static async delete(userId: string, session?: ClientSession) {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new Error("Invalid user ID");
    }

    try {
      const mongoSession = session ?? null;
      await DepositWalletModel.findOneAndDelete(
        { owner: userId },
        { session: mongoSession }
      );
      return true;
    } catch (error) {
      throw new Error("Error deleting wallet");
    }
  }

  static async deleteEarningsAndDepositWallets(
    userId: string,
    session?: ClientSession
  ) {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new Error("Invalid user ID");
    }

    try {
      const mongoSession = session ?? null;
      await DepositWalletModel.findOneAndDelete(
        { owner: userId },
        { session: mongoSession }
      );
      await EarningsWalletModel.findOneAndDelete(
        { owner: userId },
        { session: mongoSession }
      );
      return true;
    } catch (error) {
      throw new Error("Error deleting wallet");
    }
  }

  // private methods
  private static async creditWallet(
    WalletModel: mongoose.Model<IWallet>,
    ownerUserId: mongoose.Types.ObjectId | string,
    amount: number,
    type: WalletTransactionType,
    from: Types.ObjectId,
    to: Types.ObjectId,
    reference: string,
    description: string,
    status: PaymentStatusEnum = PaymentStatusEnum.SUCCESSFUL,
    processedBy: mongoose.Types.ObjectId,
    session?: ClientSession
  ) {
    if (
      !mongoose.Types.ObjectId.isValid(ownerUserId) ||
      !mongoose.Types.ObjectId.isValid(from) ||
      !mongoose.Types.ObjectId.isValid(to) ||
      !mongoose.Types.ObjectId.isValid(processedBy)
    ) {
      throw new Error("Invalid Id found in provided data");
    }

    if (amount <= 0) {
      throw new Error("Invalid Amount. Amount must be greater than 0");
    }

    try {
      const wallet = await WalletModel.findOne({ owner: ownerUserId });

      if (!wallet) {
        throw new Error("Wallet not found");
      }

      const updatedWallet = await WalletModel.findOneAndUpdate(
        { owner: ownerUserId },
        { $inc: { balance: amount } },
        { session, new: true }
      );

      if (!updatedWallet) {
        throw new Error("Wallet not found");
      }

      const transactionData = {
        type,
        from,
        to,
        amount: Number(amount),
        reference,
        description,
        status,
        processedBy,
      };

      const transaction: IWalletTransaction[] =
        await WalletTransactionModel.create([transactionData], { session });

      if (!transaction) {
        throw new Error("Error creating transaction");
      }

      return {
        wallet,
        transaction,
      };
    } catch (error: any) {
      console.error("Error in creditWallet:", error);
      console.error("Error stack:", error.stack);
      console.error("Credit wallet parameters:", {
        ownerUserId,
        amount,
        type,
        from: from.toString(),
        to: to.toString(),
        reference,
        description,
        status,
        processedBy: processedBy.toString(),
      });

      // Rethrow the error with more details
      throw new Error(`Error crediting wallet: ${error.message}`);
    }
  }

  // debit logic > debit wallet and save transaction
  private static async debitWallet(
    WalletModel: mongoose.Model<IWallet>,
    userId: mongoose.Types.ObjectId | string,
    amount: number,
    type: WalletTransactionType,
    from: Types.ObjectId,
    to: Types.ObjectId,
    reference: string,
    description: string,
    status: PaymentStatusEnum = PaymentStatusEnum.SUCCESSFUL,
    processedBy: mongoose.Types.ObjectId,
    session?: ClientSession
  ) {
    if (
      !mongoose.Types.ObjectId.isValid(userId) ||
      !mongoose.Types.ObjectId.isValid(from) ||
      !mongoose.Types.ObjectId.isValid(to) ||
      !mongoose.Types.ObjectId.isValid(processedBy)
    ) {
      throw new Error("Invalid Id found in provided data");
    }

    if (amount <= 0) {
      throw new Error("Invalid Amount. Amount must be greater than 0");
    }

    try {
      const wallet = await WalletModel.findOneAndUpdate(
        { owner: userId },
        { $inc: { balance: -amount } },
        { session, new: true }
      );

      if (!wallet) {
        throw new Error("Wallet not found");
      }

      const transactionData = {
        type,
        from,
        to,
        amount: Number(amount),
        reference,
        description,
        status,
        processedBy,
      };

      const transaction: IWalletTransaction[] =
        await WalletTransactionModel.create([transactionData], { session });

      if (!transaction) {
        throw new Error("Error creating transaction");
      }

      return {
        wallet,
        transaction,
      };
    } catch (error) {
      throw new Error("Error crediting wallet");
    }
  }
}
