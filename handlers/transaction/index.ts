import { Request, Response } from "express";
import { param, validationResult } from "express-validator";
import { TransactionModel } from "../../models/Transaction";
import { Vehicle } from "../../models/Vehicle";
import { getDaysOwing, isOwingTax } from "../../utils";

export class Transactions {
  // public transaction verification
  static async getTransactionByQRCode(req: Request, res: Response) {
    const { transactionId } = req.params; // transactionId is contained in the qr and passed here on scan

    await param("transactionId")
      .notEmpty()
      .withMessage("Transaction Id is required")
      .isMongoId()
      .withMessage("Invalid transaction Id")
      .run(req);

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()?.[0]?.msg,
        errors: errors.array(),
      });
    }

    try {
      // find transaction by vehicleId
      const transaction = await TransactionModel.findById(transactionId)
        .populate({
          path: "vehicle",
          select: "identityCode licensePlateNumber",
        })
        .populate({
          path: "type",
          select: "name",
        })
        .select("-beneficiaries");

      if (!transaction) {
        return res.status(404).json({
          success: false,
          message: "Transaction not found",
        });
      }

      console.log({ transaction });

      const vehicle = await Vehicle.findById(transaction.vehicle);

      if (!vehicle) {
        return res.status(404).json({
          success: false,
          message: "Vehicle not found",
        });
      }

      const IS_OWING = isOwingTax(vehicle?.taxPaidUntil);
      const DAYS_OWING = getDaysOwing(vehicle?.taxPaidUntil);

      // Calculate the "Not Valid After" date
      const notValidAfterDate = new Date(transaction.date);
      notValidAfterDate.setDate(
        notValidAfterDate.getDate() + (transaction.daysPaid || 0)
      );

      const data = {
        transaction,
        isOwing: IS_OWING,
        daysOwing: DAYS_OWING,
        expiryDate: notValidAfterDate,
      };

      return res.status(200).json({
        success: true,
        message: "Transaction fetched successfully",
        data,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching transaction",
      });
    }
  }
}
