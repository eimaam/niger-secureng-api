import { Request, Response } from "express";
import { IVehicle, Vehicle } from "../../models/Vehicle";
import { TransactionModel } from "../../models/Transaction";
import { Beneficiary, PaymentTypeModel } from "../../models/PaymentType";
import { UserModel } from "../../models/User";
import { withMongoTransaction } from "../../utils/mongoTransaction";
import {
  AccountStatusEnum,
  IUser,
  VehicleStatusEnum,
  PaymentStatusEnum,
  RoleName,
} from "../../types";
import { VendorModel } from "../../models/Vendor";
import { SuperVendorModel } from "../../models/SuperVendor";
import { BeneficiaryService } from "../../services/beneficiary.service";
import { AssociationModel } from "../../models/Association";
import { WalletService } from "../../services/wallet.service";
import moment from "moment";
import { UnregisteredVehicle } from "../../models/UnregisteredVehicle";
import { Config } from "../../utils/config";
import { DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_PAGE } from "../../utils/constants";
import mongoose, { isValidObjectId, ObjectId } from "mongoose";
import { WalletTransactionType } from "../../models/WalletTransaction";
import { UserService } from "../../services/user.service";
import { generateUniqueReference } from "../../utils";
import { WalletTypeEnum } from "../../models/Wallet";
import { body, param, validationResult } from "express-validator";
import {
  TaxWaiveLogModel,
  TaxWaiveLogTypeEnum,
} from "../../models/TaxWaiveLog";

export class Tax {
  static async payTax(req: Request, res: Response) {
    const { vehicleId } = req.params;
    const { numberOfDays = 1 } = req.body;
    const vendorUserId = req.headers["userid"];

    if (!vehicleId) {
      throw new Error("Vehicle ID is required");
    }

    if (numberOfDays < 0) {
      throw new Error("Number of days cannot be negative");
    }

    if (numberOfDays < 1) {
      throw new Error("Number of days must be a minimum of 1");
    }

    if (numberOfDays > Number(Config.MAX_TAX_PAYMENT_DAYS)) {
      throw new Error("You cannot pay for over 30 days");
    }

    try {
      const result = await withMongoTransaction(async (session) => {
        const vehicle: IVehicle | null = await Vehicle.findById(
          vehicleId
        ).session(session);
        if (!vehicle) throw new Error("Vehicle not found");

        if (
          vehicle.taxPaidUntil &&
          vehicle.status !== VehicleStatusEnum.ACTIVATED
        )
          throw new Error("Can't proceed. Vehicle is not active");

        // Calculate the effective tax paid until date
        let effectiveTaxPaidUntil =
          vehicle.taxPaidUntil || moment.utc().startOf("day").toDate();

        // Calculate new tax paid until date
        const newTaxPaidUntil = moment(effectiveTaxPaidUntil)
          .add(numberOfDays, "days")
          .endOf("day")
          .toDate();

        const vendorUserAccount: IUser = await UserModel.findById(
          vendorUserId
        ).session(session);

        if (!vendorUserAccount)
          throw new Error("Vendor user account not found");

        if (vendorUserAccount.status !== AccountStatusEnum.ACTIVE)
          throw new Error("Vendor account is not active");

        const vendor = await VendorModel.findOne({
          userId: vendorUserAccount._id,
        }).session(session);
        if (!vendor) throw new Error("Vendor not found");

        const paymentType = await PaymentTypeModel.findById(vehicle.vehicleType)
          .populate("beneficiaries.beneficiary")
          .session(session);

        if (!paymentType) throw new Error("Payment type not found");

        const totalAmount = paymentType.amount * numberOfDays;

        const vendorWallet = await WalletService.getWalletByOwnerId(
          vendorUserAccount._id as mongoose.Types.ObjectId,
          WalletTypeEnum.DEPOSIT,
          session
        );
        if (!vendorWallet) throw new Error("Vendor wallet not found");

        if (vendorWallet.balance < totalAmount) {
          throw new Error("Insufficient funds");
        }

        const superAdmin = await UserService.getSuperAdmin();
        const superAdminId = superAdmin?._id;

        // update vendor wallet balance by debiting their deposit wallet
        const vendorWalletUpdate = await WalletService.debitDepositWallet(
          vendorUserAccount._id as mongoose.Types.ObjectId,
          totalAmount,
          WalletTransactionType.Payment,
          superAdminId as mongoose.Types.ObjectId,
          vendorUserAccount._id as mongoose.Types.ObjectId,
          generateUniqueReference(),
          "Tax Payment Benefit",
          PaymentStatusEnum.SUCCESSFUL,
          vendorUserAccount._id as mongoose.Types.ObjectId,
          session
        );

        if (!vendorWalletUpdate)
          throw new Error(
            "There was a problem updating Vendor's wallet balance"
          );

        const superVendorUserAccount = await UserModel.findById(
          vendor.superVendor
        ).session(session);
        if (!superVendorUserAccount)
          throw new Error("Super vendor user account not found");

        const superVendor = await SuperVendorModel.findOne({
          userId: superVendorUserAccount._id,
        }).session(session);
        if (!superVendor) throw new Error("Super vendor not found");

        const association = await AssociationModel.findById(
          vehicle.association
        ).session(session);
        if (!association) throw new Error("Association not found");

        const mainBeneficiariesAccount =
          await BeneficiaryService.getMainBeneficiaries(
            association.userId.toString(),
            session
          );
        const beneficiariesAccount = [
          ...mainBeneficiariesAccount,
          vendorUserAccount,
          superVendorUserAccount,
        ];

        await BeneficiaryService.validateBeneficiaryPercentages(
          beneficiariesAccount,
          paymentType,
          session
        );

        // hold the beneficiaries with their percentages to store in tx schema
        let beneficiariesWithPercentages: {
          userId: mongoose.Types.ObjectId; // Reference to User
          percentage: number; // Percentage of the total amount for the beneficiary in the tx
        }[] = [];

        for (const beneficiary of beneficiariesAccount) {
          const beneficiaryInBeneficiaryDB = await Beneficiary.findOne({
            role: beneficiary.role,
            _id: { $in: paymentType.beneficiaries.map((b) => b.beneficiary) },
          }).session(session);

          if (!beneficiaryInBeneficiaryDB)
            throw new Error(
              `Beneficiary with role ${beneficiary.role} not found`
            );

          const beneficiaryInPaymentType = paymentType.beneficiaries.find(
            (b: any) =>
              b.beneficiary.toString() ===
                (beneficiaryInBeneficiaryDB as any)._id.toString() ||
              (b.beneficiary._id &&
                b.beneficiary._id.toString() ===
                  (beneficiaryInBeneficiaryDB as any)._id.toString())
          );

          if (!beneficiaryInPaymentType) {
            throw new Error(
              "Beneficiary with this role not a beneficiary of tax payment type"
            );
          }

          // Accumulate the beneficiaries with their percentages to store in tx schema
          beneficiariesWithPercentages.push({
            userId: beneficiary._id,
            percentage: beneficiaryInBeneficiaryDB.percentage,
          });

          // Use $inc to update beneficiary wallet balance so as to maintain atomicity
          const amount: number =
            (totalAmount * beneficiaryInBeneficiaryDB.percentage) / 100;
          const beneficiaryWalletUpdate =
            await WalletService.creditEarningsWallet(
              beneficiary._id,
              amount,
              WalletTransactionType.Commision,
              superAdminId as mongoose.Types.ObjectId,
              beneficiary._id,
              generateUniqueReference(),
              "Tax Payment Commission",
              PaymentStatusEnum.SUCCESSFUL,
              vendorUserAccount._id as mongoose.Types.ObjectId,
              session
            );

          if (!beneficiaryWalletUpdate)
            throw new Error(
              `BeneficiaryId ${beneficiary._id} wallet not found`
            );
        }

        vehicle.taxPaidUntil = newTaxPaidUntil;
        vehicle.status = VehicleStatusEnum.ACTIVATED;
        await vehicle.save({ session });

        const transaction = await TransactionModel.create(
          [
            {
              amount: totalAmount,
              daysPaid: numberOfDays,
              status: PaymentStatusEnum.SUCCESSFUL,
              vehicle: vehicleId,
              processedBy: vendorUserAccount._id,
              type: paymentType._id,
              category: paymentType.category,
              beneficiaries: beneficiariesWithPercentages,
            },
          ],
          { session }
        );

        const transactionObject = transaction[0].toObject();
        delete transactionObject.beneficiaries;

        // Add vendor information directly
        transactionObject.processedBy = {
          fullName: vendorUserAccount.fullName,
          email: vendorUserAccount.email,
          id: vendorUserAccount._id,
        };
        transactionObject.vehicle = {
          identityCode: vehicle.identityCode,
          id: vehicle._id,
          type: paymentType.name,
          taxPaidUntil: vehicle.taxPaidUntil,
        };

        return transactionObject;
      });

      return res.status(200).json({
        success: true,
        message: "Tax payment successful",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  static async payUnregisteredTax(req: Request, res: Response) {
    const { chassisNumber } = req.params;
    const { numberOfDays = 1, vehicleType, associationId } = req.body;
    const vendorUserId = req.headers["userid"];

    if (!chassisNumber) {
      throw new Error("Chassis number is required");
    }

    if (numberOfDays < 0 || numberOfDays === 0) {
      throw new Error("Number of days must be a minimum of 1");
    }

    if (numberOfDays > Number(Config.MAX_TAX_PAYMENT_DAYS)) {
      throw new Error("You cannot pay for over 30 days");
    }

    try {
      const result = await withMongoTransaction(async (session) => {
        let vehicle;

        const existingRegisteredVehicle = await Vehicle.findOne({
          chassisNumber,
        }).session(session);
        if (existingRegisteredVehicle)
          throw new Error("Vehicle with same Chassis exists as registered.");

        vehicle = await UnregisteredVehicle.findOne({ chassisNumber }).session(
          session
        );

        if (vehicle) {
          if (
            vehicle.taxPaidUntil &&
            vehicle.status !== VehicleStatusEnum.ACTIVATED
          )
            throw new Error("Can't proceed. Vehicle is not active");
        } else {
          const vehicleData = {
            chassisNumber,
            status: VehicleStatusEnum.ACTIVATED,
            vehicleType,
            association: associationId,
          };

          const createVehicle = await UnregisteredVehicle.create(
            [vehicleData],
            { session }
          );
          vehicle = createVehicle[0];
        }

        if (!vehicle) throw new Error("Vehicle not found");

        const vendorUserAccount: IUser = await UserModel.findById(
          vendorUserId
        ).session(session);

        if (!vendorUserAccount)
          throw new Error("Vendor user account not found");

        if (vendorUserAccount.status !== AccountStatusEnum.ACTIVE)
          throw new Error("Vendor account is not active");

        const vendor = await VendorModel.findOne({
          userId: vendorUserAccount._id,
        }).session(session);

        if (!vendor) throw new Error("Vendor not found");

        const paymentType = await PaymentTypeModel.findById(vehicle.vehicleType)
          .populate("beneficiaries.beneficiary")
          .session(session);

        if (!paymentType) throw new Error("Payment type not found");

        const totalAmount = paymentType.amount * numberOfDays;

        // get vendor transaction wallet
        const vendorDepositWallet = await WalletService.getWalletByOwnerId(
          vendorUserAccount._id as mongoose.Types.ObjectId,
          WalletTypeEnum.DEPOSIT,
          session
        );
        if (!vendorDepositWallet) throw new Error("Vendor wallet not found");

        if (vendorDepositWallet.balance < totalAmount) {
          throw new Error("Insufficient funds");
        }

        const superAdmin = await UserService.getSuperAdmin();
        const superAdminId = superAdmin?._id;

        // update vendor wallet balance
        const vendorWalletUpdate = await WalletService.debitDepositWallet(
          vendorUserAccount._id as mongoose.Types.ObjectId,
          totalAmount,
          WalletTransactionType.Payment,
          superAdminId as mongoose.Types.ObjectId,
          vendorUserAccount._id as mongoose.Types.ObjectId,
          generateUniqueReference(),
          "Tax Payment Benefit",
          PaymentStatusEnum.SUCCESSFUL,
          vendorUserAccount._id as mongoose.Types.ObjectId,
          session
        );

        if (!vendorWalletUpdate)
          throw new Error(
            "There was a problem updating Vendor's wallet balance"
          );

        const superVendorUserAccount = await UserModel.findById(
          vendor.superVendor
        ).session(session);

        if (!superVendorUserAccount)
          throw new Error("Super vendor user account not found");

        const superVendor = await SuperVendorModel.findOne({
          userId: superVendorUserAccount._id,
        }).session(session);

        if (!superVendor) throw new Error("Super vendor not found");

        const association = await AssociationModel.findById(
          vehicle.association
        ).session(session);

        if (!association) throw new Error("Association not found");

        const mainBeneficiariesAccount =
          await BeneficiaryService.getMainBeneficiaries(
            association.userId.toString(),
            session
          );

        const beneficiariesAccount = [
          ...mainBeneficiariesAccount,
          vendorUserAccount,
          superVendorUserAccount,
        ];

        await BeneficiaryService.validateBeneficiaryPercentages(
          beneficiariesAccount,
          paymentType,
          session
        );

        // hold the beneficiaries with their percentages to store in tx schema
        let beneficiariesWithPercentages: {
          userId: mongoose.Types.ObjectId; // Reference to User
          percentage: number; // Percentage of the total amount for the beneficiary in the tx
        }[] = [];

        for (const beneficiary of beneficiariesAccount) {
          const beneficiaryInBeneficiaryDB = await Beneficiary.findOne({
            role: beneficiary.role,
            _id: { $in: paymentType.beneficiaries.map((b) => b.beneficiary) },
          }).session(session);

          if (!beneficiaryInBeneficiaryDB)
            throw new Error(
              `Beneficiary with role ${beneficiary.role} not found`
            );

          const beneficiaryInPaymentType = paymentType.beneficiaries.find(
            (b: any) =>
              b.beneficiary.toString() ===
                (beneficiaryInBeneficiaryDB as any)._id.toString() ||
              (b.beneficiary._id &&
                b.beneficiary._id.toString() ===
                  (beneficiaryInBeneficiaryDB as any)._id.toString())
          );

          if (!beneficiaryInPaymentType) {
            throw new Error(
              "Beneficiary with this role not a beneficiary of tax payment type"
            );
          }

          // Accumulate the beneficiaries with their percentages to store in tx schema
          beneficiariesWithPercentages.push({
            userId: beneficiary._id,
            percentage: beneficiaryInBeneficiaryDB.percentage,
          });

          const superAdmin = await UserService.getSuperAdmin();
          const superAdminId = superAdmin?._id;

          // Using $inc to update beneficiary wallet balance so as to maintain atomicity
          const beneficiaryWalletUpdate =
            await WalletService.creditEarningsWallet(
              beneficiary._id,
              (totalAmount * beneficiaryInBeneficiaryDB.percentage) / 100,
              WalletTransactionType.Commision,
              superAdminId as mongoose.Types.ObjectId,
              beneficiary._id,
              generateUniqueReference(),
              "Tax Payment Benefit",
              PaymentStatusEnum.SUCCESSFUL,
              vendorUserAccount._id as mongoose.Types.ObjectId,
              session
            );

          if (!beneficiaryWalletUpdate)
            throw new Error(
              `BeneficiaryId ${beneficiary._id} wallet not found or Error Updating Wallet`
            );
        }

        const lastPaidUntilDate = moment.utc(
          vehicle.taxPaidUntil || moment.utc()
        );
        vehicle.taxPaidUntil = lastPaidUntilDate
          .add(numberOfDays, "days")
          .endOf("day")
          .toDate();

        if (vehicle.status === VehicleStatusEnum.NOT_ACTIVATED)
          vehicle.status = VehicleStatusEnum.ACTIVATED;
        await vehicle.save({ session });

        const transaction = await TransactionModel.create(
          [
            {
              amount: totalAmount,
              daysPaid: numberOfDays,
              status: PaymentStatusEnum.SUCCESSFUL,
              vehicle: vehicle._id,
              processedBy: vendorUserAccount._id,
              type: paymentType._id,
              category: paymentType.category,
              beneficiaries: beneficiariesWithPercentages,
            },
          ],
          { session }
        );

        const transactionObject = transaction[0].toObject();
        delete transactionObject.beneficiaries;

        // Add vendor information directly
        transactionObject.processedBy = {
          fullName: vendorUserAccount.fullName,
          email: vendorUserAccount.email,
          id: vendorUserAccount._id,
        };
        transactionObject.vehicle = {
          identityCode: vehicle.identityCode,
          id: vehicle._id,
          type: paymentType.name,
          taxPaidUntil: vehicle.taxPaidUntil,
        };

        return transaction[0];
      });

      return res.status(200).json({
        success: true,
        message: "Tax payment successful",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  static async getAllTaxPaymentHistory(req: Request, res: Response) {
    const userId = req.headers["userid"] as string;
    const {
      page = DEFAULT_QUERY_PAGE,
      limit = DEFAULT_QUERY_LIMIT,
      paymentTypeId,
      paymentCategoryId,
      amount,
      daysPaid,
      status,
      fromDate,
      toDate,
    }: {
      page?: number;
      limit?: number;
      paymentTypeId?: string;
      paymentCategoryId?: string;
      amount?: number;
      daysPaid?: number;
      vehicleId?: string;
      status?: PaymentStatusEnum;
      fromDate?: Date;
      toDate?: Date;
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    if (!isValidObjectId(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID" });
    }

    // if (vehicleId && !isValidObjectId(vehicleId)) {
    //   return res
    //     .status(400)
    //     .json({ success: false, message: "Invalid vehicle ID" });
    // }

    if (paymentTypeId && !isValidObjectId(paymentTypeId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payment type ID" });
    }

    if (paymentCategoryId && !isValidObjectId(paymentCategoryId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payment category ID" });
    }

    try {
      const result = await withMongoTransaction(async (session) => {
        const dbQuery: any = {};

        const user = await UserModel.findById(userId).session(session);

        if (user.role === RoleName.Vendor) {
          dbQuery["processedBy"] = new mongoose.Types.ObjectId(userId);
        }

        if (user.role === RoleName.SuperVendor) {
          const superVendor = await SuperVendorModel.findOne({
            userId: user._id,
          }).session(session);
          if (!superVendor) throw new Error("Super vendor not found");

          const vendorUserIds = superVendor.vendors.map((vendor: ObjectId) =>
            vendor.toString()
          );

          dbQuery["processedBy"] = { $in: vendorUserIds };
        }

        if (user.role === RoleName.Association) {
          const association = await AssociationModel.findOne({
            userId: userId,
          }).session(session);
          if (!association) throw new Error("Association not found");

          // Fetch only transactions for vehicles under the association account
          const vehicleIds = await Vehicle.find({
            association: association._id,
          })
            .distinct("_id")
            .session(session);
          dbQuery["vehicle"] = { $in: vehicleIds };
        }

        if (paymentTypeId)
          dbQuery["type"] = new mongoose.Types.ObjectId(paymentTypeId);
        if (paymentCategoryId)
          dbQuery["category"] = new mongoose.Types.ObjectId(paymentCategoryId);
        if (amount) dbQuery["amount"] = Number(amount);
        if (daysPaid) dbQuery["daysPaid"] = Number(daysPaid);

        if (status) dbQuery["status"] = new RegExp(status, "i");
        if (fromDate) dbQuery["createdAt"] = { $gte: new Date(fromDate) };
        if (toDate) dbQuery["createdAt"] = { $lte: new Date(toDate) };

        const transactions = await TransactionModel.find(dbQuery)
          .populate({
            path: "vehicle",
            select: "identityCode taxPaidUntil",
          })
          .populate({
            path: "processedBy",
            select: "fullName email",
          })
          .populate({
            path: "type",
            select: "name amount",
          })
          .populate({
            path: "category",
            select: "name",
          })
          .select("-beneficiaries")
          .skip(skip)
          .limit(Number(limit))
          .sort({ createdAt: -1 })
          .session(session);

        const totalTransactions = await TransactionModel.countDocuments(
          dbQuery
        ).session(session);

        return {
          transactions,
          totalTransactions,
        };
      });

      return res.status(200).json({
        success: true,
        message: "Get all tax payment history successful",
        page,
        total: result.totalTransactions,
        totalPages: Math.ceil(result.totalTransactions / Number(limit)),
        data: result.transactions,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Get all tax payment history error",
        error: error.message,
      });
    }
  }

  static async waiveTaxGeneral(req: Request, res: Response) {
    const { days = 1 } = req.body;

    // validate inputs
    await body("days")
      .notEmpty()
      .withMessage("Number of Days to Waive is required")
      .isInt()
      .withMessage("Days must be an integer")
      .run(req);

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()?.[0].msg,
        errors: errors.array(),
      });
    }
    const BATCH_SIZE = 500;
    const MAX_RETRIES = 3;
    try {
      // Fetch all vehicles with taxPaidUntil date
      const vehicles = await Vehicle.find({
        taxPaidUntil: { $exists: true, $ne: null },
      });

      // Process vehicles in batches
      for (let i = 0; i < vehicles.length; i += BATCH_SIZE) {
        const batch = vehicles.slice(i, i + BATCH_SIZE);

        let retries = 0;
        let success = false;

        while (retries < MAX_RETRIES && !success) {
          try {
            await withMongoTransaction(async (session) => {
              const bulkOps = batch.map((vehicle) => {
                const newTaxPaidUntil = moment(vehicle.taxPaidUntil)
                  .add(days, "days")
                  .endOf("day")
                  .toDate();
                return {
                  updateOne: {
                    filter: { _id: vehicle._id },
                    update: { $set: { taxPaidUntil: newTaxPaidUntil } },
                  },
                };
              });

              await Vehicle.bulkWrite(bulkOps, { session });

              success = true;
            });
          } catch (error: any) {
            if (
              error.errorLabels &&
              error.errorLabels.includes("TransientTransactionError")
            ) {
              retries += 1;
              console.log(
                `Retrying transaction (${retries}/${MAX_RETRIES}) for batch starting at index ${i}...`
              );
            } else {
              throw error;
            }
          }
        }

        if (!success) {
          throw new Error(
            `Failed to waive tax for batch starting at index ${i} after multiple attempts`
          );
        }
      }

      //  Log the tax waiving
      const waiveLogData = {
        daysWaived: days,
        type: TaxWaiveLogTypeEnum.General,
        totalVehicles: vehicles.length,
        processedBy: req.headers["userid"] as string,
      };
      const waiveLog = await TaxWaiveLogModel.create(waiveLogData);

      return res.status(200).json({
        success: true,
        message: "All Tax Waived successfully",
        data: vehicles.length,
      });
    } catch (error: any) {
      console.log("Waive Tax General Error: ", error);
      return res.status(500).json({
        success: false,
        message: "An error occurred while waiving tax",
        error: error.message,
      });
    }
  }

  static async waiveTaxForSingleVehicle(req: Request, res: Response) {
    const { vehicleCode } = req.params;
    const { days = 1 } = req.body;

    // Validate inputs
    await param("vehicleCode")
      .notEmpty()
      .withMessage("Vehicle ID is required")
      .isString()
      .withMessage("Vehicle ID must be a string")
      .run(req);
    await body("days")
      .notEmpty()
      .withMessage("Number of Days to Waive is required")
      .isInt()
      .withMessage("Days must be an integer")
      .run(req);

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()?.[0].msg,
        errors: errors.array(),
      });
    }

    try {
      // Fetch the vehicle by ID
      const vehicle = await Vehicle.findOne({ identityCode: vehicleCode });

      if (!vehicle) {
        return res.status(404).json({
          success: false,
          message: "Vehicle not found",
        });
      }

      if (!vehicle.taxPaidUntil) {
        return res.status(400).json({
          success: false,
          message: "Vehicle has no taxPaidUntil date",
        });
      }

      // Update the taxPaidUntil date
      const newTaxPaidUntil = moment(vehicle.taxPaidUntil)
        .add(days, "days")
        .endOf("day")
        .toDate();

      const updatedVehicle = await Vehicle.findByIdAndUpdate(
        vehicle._id,
        { taxPaidUntil: newTaxPaidUntil },
        { new: true, runValidators: true }
      );

      if (!updatedVehicle) {
        return res.status(500).json({
          success: false,
          message: "An error occurred while waiving tax",
        });
      }

      //  Log the tax waiving
      const waiveLogData = {
        vehicleId: vehicle?._id,
        daysWaived: days,
        newTaxPaidUntil,
        type: TaxWaiveLogTypeEnum.Single,
        processedBy: req.headers["userid"] as string,
      };

      const waiveLog = await TaxWaiveLogModel.create(waiveLogData);

      return res.status(200).json({
        success: true,
        message: "Tax waived successfully for the vehicle",
        data: updatedVehicle,
      });
    } catch (error: any) {
      console.log("Waive Tax for Single Vehicle Error: ", error);
      return res.status(500).json({
        success: false,
        message: "An error occurred while waiving tax",
        error: error.message,
      });
    }
  }

  static async getAllTaxWaiveLogs(req: Request, res: Response) {
    const page = parseInt(req.query.page as string) || DEFAULT_QUERY_PAGE;
    const limit = parseInt(req.query.limit as string) || DEFAULT_QUERY_LIMIT;
    const skip = Number(page - 1) * Number(limit);

    const query: any = {};

    const { vehicleCode, daysWaived, date, type, processedBy } = req.query;

    // validate inputs

    if (vehicleCode) {
      const vehicle = await Vehicle.findOne({
        identityCode: vehicleCode,
      });

      if (vehicle) {
        query.vehicleId = vehicle?._id;
      }
    }

    if (daysWaived) {
      query.daysWaived = daysWaived;
    }

    if (date) {
      query.date = new Date(date as string);
    }

    if (type) {
      query.type = type;
    }

    if (processedBy) {
      query.processedBy = processedBy;
    }

    try {
      const allLogs = await TaxWaiveLogModel.find(query)
        .populate({
          path: "processedBy",
          select: "fullName email",
        })
        .populate({
          path: "vehicle",
          select: "identityCode taxPaidUntil",
        })
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 });

      const totalLogs = await TaxWaiveLogModel.countDocuments(query);

      return res.status(200).json({
        success: true,
        message: "Vehicle Tax Waiving Logs Fetched Successfully",
        page: page,
        totalPages: Math.ceil(totalLogs / limit),
        totalLogs,
        data: allLogs,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "There was a problem fetching tax waiving logs",
        error: error?.message,
      });
    }
  }
}
