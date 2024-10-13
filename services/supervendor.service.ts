import mongoose, { ClientSession } from "mongoose";
import { DepositWalletModel } from "../models/Wallet";
import { WalletService } from "./wallet.service";
import { WalletTransactionType } from "../models/WalletTransaction";
import { VendorModel } from "../models/Vendor";
import { generateUniqueReference } from "../utils";
import { PaymentStatusEnum } from "../types";

export class SuperVendorService {
  /**
   * Transfer wallet balance from vendor's Wallet to its Super Vendor
   * @param vendorId The ID of the vendor
   * @param amount The amount to transfer
   */
  static async vendorDepositWalletBalanceTransfer(
    vendorId: mongoose.Types.ObjectId | string,
    amount: number,
    session?: ClientSession
  ) {
    const mongoSession = session ?? null;

    if (!mongoose.isValidObjectId(vendorId)) {
      throw new Error("Invalid vendor ID");
    }

    console.log({ amount });

    if (amount < 1) {
      throw new Error("Amount must be greater than 0");
    }

    try {
      const vendor = await VendorModel.findById(vendorId).session(mongoSession);

      if (!vendor) {
        throw new Error("Vendor not found");
      }

      // Find the vendor's wallet
      const vendorWallet = await DepositWalletModel.findOne({
        owner: vendor.userId,
      }).session(mongoSession);

      if (!vendorWallet) {
        throw new Error("Vendor wallet not found");
      }

      // Find the super vendor's wallet
      const superVendorWallet = await DepositWalletModel.findOne({
        owner: vendor.superVendor,
      }).session(mongoSession);

      if (!superVendorWallet) {
        throw new Error("Super vendor wallet not found");
      }

      // Check if the vendor has enough balance to transfer
      if (vendorWallet.balance < amount) {
        throw new Error("Insufficient balance");
      }

      // Deduct the amount from the vendor's wallet
      const updatedVendorWallet = await WalletService.debitDepositWallet(
        vendor.userId as mongoose.Types.ObjectId,
        Number(amount),
        WalletTransactionType.Transfer,
        vendor.userId as mongoose.Types.ObjectId,
        vendor?.superVendor,
        generateUniqueReference(vendorId as string),
        "Super Vendor Balance Transfer",
        PaymentStatusEnum.SUCCESSFUL,
        vendor.superVendor as mongoose.Types.ObjectId,
        mongoSession as ClientSession
      );

      if (!updatedVendorWallet) {
        throw new Error("Error updating vendor wallet");
      }

      // Credit the super vendor's wallet
      const updatedSuperVendorWallet = await WalletService.creditDepositWallet(
        vendor.superVendor as mongoose.Types.ObjectId,
        Number(amount),
        WalletTransactionType.Transfer,
        vendor?.userId as mongoose.Types.ObjectId,
        vendor?.superVendor,
        generateUniqueReference(vendorId as string),
        "Super Vendor Balance Transfer",
        PaymentStatusEnum.SUCCESSFUL,
        vendor.superVendor as mongoose.Types.ObjectId,
        mongoSession as ClientSession
      );

      if (!updatedSuperVendorWallet) {
        throw new Error("Error updating super vendor wallet");
      }
    } catch (error) {
      console.error("Error transferring wallet balance: ", error);
      throw new Error("Error transferring wallet balance");
    }
  }
}
