import { Request, Response } from "express";
import { generateUniqueReference, hasExpired } from "../../utils";
import {
  IInvoiceData,
  IMonnifyTransaction,
  MonnifyService,
} from "../../services/monnify.wallet.service";
import { Config } from "../../utils/config";
import {
  IPaymentDetail,
  PaymentDetailsModel,
} from "../../models/PaymentDetail";
import { EarningsWalletModel, IWallet, WalletTypeEnum } from "../../models/Wallet";
import { IVehicleOwner } from "../../models/VehicleOwner";
import { PaymentTypeEnum } from "../../types";
import { withMongoTransaction } from "../../utils/mongoTransaction";
import { Vehicle } from "../../models/Vehicle";
import { PaymentTypeModel } from "../../models/PaymentType";
import { DriverModel, IDriver } from "../../models/Driver";
import { VehicleService } from "../../services/vehicle.service";
import { WalletService } from "../../services/wallet.service";

const BANK_TRANSFER_FEE: number = Number(Config.BANK_TRANSFER_FEE);

export class Monnify {
  static async singleTransfer(req: Request, res: Response) {
    const { walletId } = req.params;
    try {
      const result = await withMongoTransaction(async (session) => {
        const wallet = await EarningsWalletModel.findById(walletId).session(
          session
        );

        if (!wallet) {
          throw {
            code: 404,
            message: "Wallet not found",
          };
        }

        const paymentDetail = await PaymentDetailsModel.findOne({
          owner: wallet.owner,
        }).session(session);

        if (!paymentDetail) {
          throw {
            code: 404,
            message: "Payment detail not found",
          };
        }

        const WALLET_BALANCE = wallet.balance;
        const accountNumber = paymentDetail.accountNumber;
        const bankCode = paymentDetail.bankCode;

        if (
          WALLET_BALANCE === null ||
          WALLET_BALANCE === undefined ||
          !accountNumber ||
          !bankCode
        ) {
          throw {
            code: 400,
            message: "Amount, account number and bank code are required",
          };
        }
        const AVAILABLE_BALANCE = await WalletService.getAvailableBalance(
          walletId,
          WalletTypeEnum.EARNINGS,
          session
        );

        const MIN_REQUIRED_BALANCE = Number(Config.MIN_WITHDRAWAL_AMOUNT);
        const AMOUNT_TO_TRANSFER = AVAILABLE_BALANCE - BANK_TRANSFER_FEE;
        const REQUIRED_BALANCE = AMOUNT_TO_TRANSFER + BANK_TRANSFER_FEE;

        if (AVAILABLE_BALANCE < MIN_REQUIRED_BALANCE) {
          throw {
            code: 400,
            message: `Insufficient balance. Minimum withdrawal amount is N${Config.MIN_WITHDRAWAL_AMOUNT}`,
          };
        }
        // place a hold on the wallet balance
        const heldBalance = await WalletService.holdWalletBalance(
          walletId,
          REQUIRED_BALANCE,
          WalletTypeEnum.EARNINGS,
          session
        );

        const paymentData = {
          amount: AMOUNT_TO_TRANSFER,
          reference: generateUniqueReference(),
          narration: wallet.owner.toString(),
          destinationBankCode: bankCode,
          destinationAccountNumber: accountNumber,
        };

        const transfer = await MonnifyService.initiateSingleTransfer(
          paymentData.amount,
          paymentData.destinationAccountNumber,
          paymentData.destinationBankCode,
          paymentData.reference,
          paymentData.narration
        );

        if (!transfer) {
          throw {
            code: 500,
            message: "Error initiating transfer",
          };
        }

        return transfer;
      });

      return res.status(200).json({
        success: true,
        message: "Transfer successful",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error initiating transfer",
        error: error.message,
      });
    }
  }

  static async bulkTransfer(req: Request, res: Response) {
    const { wallets } = req.body;

    if (!Array.isArray(wallets) || wallets.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No wallets provided",
      });
    }

    const MIN_REQUIRED_BALANCE = Number(Config.MIN_WITHDRAWAL_AMOUNT);

    try {
      const result = await withMongoTransaction(async (session) => {
        // Fetch all payment details
        const paymentDetails = await PaymentDetailsModel.find({}).session(
          session
        );
        // Fetch all earnings
        const earningsWallets = (await EarningsWalletModel.find({
          _id: { $in: wallets },
        }).session(session)) as IWallet[];

        // check if there is a at least a single earning wallet with a balance greater than or equal to the minimum withdrawal amount
        // this saves time where once there is no wallet if a min withdrawal amount we simply return error and terminate
        const hasValidEarnings = earningsWallets.some(
          (earning) =>
            earning.balance - (earning?.heldBalance ?? 0) >=
            MIN_REQUIRED_BALANCE
        );

        if (!hasValidEarnings) {
          throw {
            code: 400,
            message: `No Wallet with N${Config.MIN_WITHDRAWAL_AMOUNT} min withdrawal amount found`,
          };
        }

        // Prepare transactions for bulk transfer
        const transactions = earningsWallets
          .map(async (beneficiaryWallet: IWallet) => {
            const paymentDetail: IPaymentDetail = paymentDetails.find(
              (pd) => pd.owner.toString() === beneficiaryWallet.owner.toString()
            );

            // deduct bank transfer fee > will be added when debiting the beneficiary wallet balance to record trx history via webhook after successful disbursement
            const AVAILABLE_BALANCE = await WalletService.getAvailableBalance(
              (beneficiaryWallet as any)._id,
              WalletTypeEnum.EARNINGS,
              session
            );
            const AMOUNT_TO_TRANSFER = AVAILABLE_BALANCE - BANK_TRANSFER_FEE;
            const REQUIRED_BALANCE = AMOUNT_TO_TRANSFER + BANK_TRANSFER_FEE;

            if (paymentDetail && AVAILABLE_BALANCE >= MIN_REQUIRED_BALANCE) {
              const heldBalance = await WalletService.holdWalletBalance(
                (beneficiaryWallet as any)._id,
                REQUIRED_BALANCE,
                WalletTypeEnum.EARNINGS,
                session
              );

              return {
                amount: AMOUNT_TO_TRANSFER,
                reference: generateUniqueReference(
                  beneficiaryWallet?.owner.toString()
                ),
                narration: beneficiaryWallet.owner.toString(),
                destinationBankCode: paymentDetail.bankCode,
                destinationAccountNumber: paymentDetail.accountNumber,
                currency: "NGN",
                async: true,
              } as IMonnifyTransaction;
            }
            return null;
          })
          .filter((transaction) => transaction !== null);

        if (transactions.length === 0 && !hasValidEarnings) {
          throw {
            code: 400,
            message: "No Wallet with min withdrawal amount found",
          };
        }

        const resolvedTransactions = (await Promise.all(transactions)).filter(
          (transaction) => transaction !== null
        ) as IMonnifyTransaction[];

        if (resolvedTransactions.length === 0) {
          throw {
            code: 400,
            message: "No Wallet with min withdrawal amount found",
          };
        }

        const bulkTransfer = await MonnifyService.initiateBulkTransfer(
          resolvedTransactions
        );

        if (!bulkTransfer) {
          return res.status(500).json({
            success: false,
            message: "Error initiating bulk transfer",
          });
        }

        return bulkTransfer;
      });

      return res.status(200).json({
        success: true,
        message: "Bulk transfer successful",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error initiating bulk transfer",
        error: error.message,
      });
    }
  }

  static async resendOtp(req: Request, res: Response) {
    const { reference } = req.body;

    if (!reference || reference === "") {
      return res.status(400).json({
        success: false,
        message: "Reference is required",
      });
    }

    try {
      const data = {
        reference,
      };

      const resend = await MonnifyService.resendOtp(data.reference);

      if (!resend) {
        return res.status(500).json({
          success: false,
          message: "Error resending OTP",
        });
      }

      return res.status(200).json({
        success: true,
        message: "OTP resent successfully",
        data: resend,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error resending OTP",
        error: error.message,
      });
    }
  }

  static async authorizeSingleTransfer(req: Request, res: Response) {
    const { reference, otp } = req.body;

    if (!reference || reference === "" || !otp || otp === "") {
      return res.status(400).json({
        success: false,
        message: "Reference and OTP are required",
      });
    }

    try {
      const data = {
        reference,
        otp,
      };

      const verified = await MonnifyService.verifySingleTransferOtp(
        data.reference,
        data.otp
      );

      if (!verified) {
        return res.status(500).json({
          success: false,
          message: "Error initiating transfer",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Transfer successful",
        data: verified,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Server Error: Error initiating transfer",
        error: error.message,
      });
    }
  }

  static async authorizeBulkTransfer(req: Request, res: Response) {
    const { reference, otp } = req.body;

    if (!reference || reference === "" || !otp || otp === "") {
      return res.status(400).json({
        success: false,
        message: "Reference and OTP are required",
      });
    }

    try {
      const data = {
        reference,
        otp,
      };

      const verified = await MonnifyService.verifyBulkTransferOtp(
        data.reference,
        data.otp
      );

      if (!verified) {
        return res.status(500).json({
          success: false,
          message: "Error initiating transfer",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Transfer successful",
        data: verified,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Server Error: Error initiating transfer",
        error: error.message,
      });
    }
  }

  static async getAllInvoices(_req: Request, res: Response) {
    try {
      const invoices = await MonnifyService.getAllInvoices();

      if (!invoices) {
        return res.status(500).json({
          success: false,
          message: "Server Error: Error fetching invoices",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Invoices fetched successfully",
        data: invoices,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Server Error: Error fetching invoices",
        error: error.message,
      });
    }
  }

  static async generateNewInvoice(req: Request, res: Response) {
    const { id } = req.params;
    // payment type can be CERTIFICATE_PRINTING, VEHICLE_REGISTRATION, etc
    // must be a value from PaymentTypeEnum
    const { paymentType } = req.body;

    const userId = req.headers["userid"];

    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "Driver/Vehicle ID is required" });
    }

    if (!paymentType) {
      return res
        .status(400)
        .json({ success: false, message: "Payment type is required" });
    }

    try {
      const result = await withMongoTransaction(async (session) => {
        if (paymentType === PaymentTypeEnum.VEHICLE_REGISTRATION) {
          const vehicle = await Vehicle.findById(id)
            .populate("owner")
            .session(session);

          if (!vehicle) {
            return res
              .status(404)
              .json({ success: false, message: "Vehicle not found" });
          }

          if (vehicle.identityCode) {
            return res
              .status(400)
              .json({ success: false, message: "Vehicle already registered" });
          }

          const invoiceType = await PaymentTypeModel.findOne(
            {
              name: PaymentTypeEnum.VEHICLE_REGISTRATION,
            },
            {
              _id: true,
              amount: true,
            },
            {
              session,
            }
          );

          if (!invoiceType) {
            throw {
              code: 404,
              message: "Invoice type does not exist",
            };
          }

          const invoiceData: IInvoiceData = {
            type: invoiceType._id?.toString(),
            amount: invoiceType?.amount,
            description: "Vehicle Registration Fee",
            customerEmail: (vehicle?.owner as IVehicleOwner).email,
            customerName: (vehicle?.owner as IVehicleOwner).fullName,
            metaData: {
              vehicleId: id,
              paymentType: invoiceType._id,
            },
            createdBy: userId as string,
          };

          const invoice = await MonnifyService.createInvoice(
            invoiceData,
            session
          );

          if (!invoice) {
            throw {
              code: 500,
              message: "Error creating invoice",
            };
          }

          return {
            amount: invoice[0]?.amount,
            bankName: invoice[0]?.bankName,
            accountName: invoice[0]?.accountName,
            accountNumber: invoice[0]?.accountNumber,
            expiryDate: invoice[0]?.expiryDate,
          };
        } else if (paymentType === PaymentTypeEnum.VEHICLE_UPDATE) {
          const vehicle = await Vehicle.findById(id)
            .populate("owner")
            .session(session);

          if (!vehicle) {
            return res
              .status(404)
              .json({ success: false, message: "Vehicle not found" });
          }

          // verify vehicle's status not BLACKLISTED
          const isVehicleBlacklisted = await VehicleService.isVehicleBlacklisted(
            id,
            session
          );

          if (isVehicleBlacklisted) {
            throw {
              code: 400,
              message: "Vehicle is blacklisted and cannot be updated",
            };
          }

          const invoiceType = await PaymentTypeModel.findOne(
            {
              name: PaymentTypeEnum.VEHICLE_UPDATE,
            },
            {
              _id: true,
              amount: true,
            },
            {
              session,
            }
          );

          if (!invoiceType) {
            throw {
              code: 404,
              message: "Invoice type does not exist",
            };
          }

          const invoiceData: IInvoiceData = {
            type: invoiceType._id?.toString(),
            amount: invoiceType?.amount,
            description: "Vehicle Update Fee",
            customerEmail: (vehicle?.owner as IVehicleOwner).email,
            customerName: (vehicle?.owner as IVehicleOwner).fullName,
            metaData: {
              vehicleId: id,
              paymentType: invoiceType._id,
            },
            createdBy: userId as string,
          };

          const invoice = await MonnifyService.createInvoice(
            invoiceData,
            session
          );

          if (!invoice) {
            throw {
              code: 500,
              message: "Error creating invoice",
            };
          }

          return {
            amount: invoice[0]?.amount,
            bankName: invoice[0]?.bankName,
            accountName: invoice[0]?.accountName,
            accountNumber: invoice[0]?.accountNumber,
            expiryDate: invoice[0]?.expiryDate,
          };
        } else if (paymentType === PaymentTypeEnum.VEHICLE_LICENSE_RENEWAL) {
          const vehicle = await Vehicle.findById(id)
            .populate("owner")
            .session(session);

          if (!vehicle) {
            return res
              .status(404)
              .json({ success: false, message: "Vehicle not found" });
          }

          // verify vehicle's status not BLACKLISTED
          const isVehicleBlacklisted = await VehicleService.isVehicleBlacklisted(
            id,
            session
          );

          if (isVehicleBlacklisted) {
            throw {
              code: 400,
              message: "Vehicle is blacklisted and cannot renew license",
            };
          }

          const EXPIRY_DATE = vehicle.license?.expiryDate;
          // confirm if vehicle's license has expired
          if (!hasExpired(EXPIRY_DATE)) {
            throw {
              code: 400,
              message: "Vehicle's license has not expired",
            };
          }

          const invoiceType = await PaymentTypeModel.findOne(
            {
              name: PaymentTypeEnum.VEHICLE_LICENSE_RENEWAL,
            },
            {
              _id: true,
              amount: true,
            },
            {
              session,
            }
          );

          if (!invoiceType) {
            throw {
              code: 404,
              message: "Invoice type does not exist",
            };
          }

          const invoiceData: IInvoiceData = {
            type: invoiceType._id?.toString(),
            amount: invoiceType?.amount,
            description: "Vehicle License Renewal Fee",
            customerEmail: (vehicle?.owner as IVehicleOwner).email,
            customerName: (vehicle?.owner as IVehicleOwner).fullName,
            metaData: {
              vehicleId: id,
              paymentType: invoiceType._id,
            },
            createdBy: userId as string,
          };

          const invoice = await MonnifyService.createInvoice(
            invoiceData,
            session
          );

          if (!invoice) {
            throw {
              code: 500,
              message: "Error creating invoice",
            };
          }

          return {
            amount: invoice[0]?.amount,
            bankName: invoice[0]?.bankName,
            accountName: invoice[0]?.accountName,
            accountNumber: invoice[0]?.accountNumber,
            expiryDate: invoice[0]?.expiryDate,
          };
        } else if (paymentType === PaymentTypeEnum.VEHICLE_QR_CODE_PRINTING) {
          const vehicle = await Vehicle.findById(id)
            .populate("owner")
            .session(session);

          if (!vehicle) {
            return res
              .status(404)
              .json({ success: false, message: "Vehicle not found" });
          }

          const invoiceType = await PaymentTypeModel.findOne(
            {
              name: PaymentTypeEnum.VEHICLE_QR_CODE_PRINTING,
            },
            {
              _id: true,
              amount: true,
            },
            {
              session,
            }
          );

          if (!invoiceType) {
            throw {
              code: 404,
              message: "Invoice type does not exist",
            };
          }

          const invoiceData: IInvoiceData = {
            type: invoiceType._id?.toString(),
            amount: invoiceType?.amount,
            description: "Vehicle QR Code Printing Fee",
            customerEmail: (vehicle?.owner as IVehicleOwner).email,
            customerName: (vehicle?.owner as IVehicleOwner).fullName,
            metaData: {
              vehicleId: id,
              paymentType: invoiceType._id,
            },
            createdBy: userId as string,
          };

          const invoice = await MonnifyService.createInvoice(
            invoiceData,
            session
          );

          if (!invoice) {
            throw {
              code: 500,
              message: "Error creating invoice",
            };
          }

          return {
            amount: invoice[0]?.amount,
            bankName: invoice[0]?.bankName,
            accountName: invoice[0]?.accountName,
            accountNumber: invoice[0]?.accountNumber,
            expiryDate: invoice[0]?.expiryDate,
          };
        } else if (paymentType === PaymentTypeEnum.CERTIFICATE_PRINTING) {
          const vehicle = await Vehicle.findById(id)
            .populate("owner")
            .session(session);

          if (!vehicle) {
            return res
              .status(404)
              .json({ success: false, message: "Vehicle not found" });
          }

          const invoiceType = await PaymentTypeModel.findOne(
            {
              name: PaymentTypeEnum.CERTIFICATE_PRINTING,
            },
            {
              _id: true,
              amount: true,
            },
            {
              session,
            }
          );

          if (!invoiceType) {
            throw {
              code: 404,
              message: "Invoice type does not exist",
            };
          }

          const invoiceData: IInvoiceData = {
            type: invoiceType._id?.toString(),
            amount: invoiceType?.amount,
            description: "Vehicle Registration Fee",
            customerEmail: (vehicle?.owner as IVehicleOwner).email,
            customerName: (vehicle?.owner as IVehicleOwner).fullName,
            metaData: {
              vehicleId: id,
              paymentType: invoiceType._id,
            },
            createdBy: userId as string,
          };

          const invoice = await MonnifyService.createInvoice(
            invoiceData,
            session
          );

          if (!invoice) {
            throw {
              code: 500,
              message: "Error creating invoice",
            };
          }

          return {
            amount: invoice[0]?.amount,
            bankName: invoice[0]?.bankName,
            accountName: invoice[0]?.accountName,
            accountNumber: invoice[0]?.accountNumber,
            expiryDate: invoice[0]?.expiryDate,
          };
        } else if (paymentType === PaymentTypeEnum.DRIVER_PERMIT_PRINTING) {
          console.log("driver permit printing");
          const driver = await DriverModel.findById(id).session(session);

          if (!driver) {
            return res
              .status(404)
              .json({ success: false, message: "Driver not found" });
          }

          const invoiceType = await PaymentTypeModel.findOne(
            {
              name: PaymentTypeEnum.DRIVER_PERMIT_PRINTING,
            },
            {
              _id: true,
              amount: true,
            },
            {
              session,
            }
          );

          if (!invoiceType) {
            throw {
              code: 404,
              message: "Invoice type does not exist",
            };
          }

          const invoiceData: IInvoiceData = {
            type: invoiceType._id?.toString(),
            amount: invoiceType?.amount,
            description: "Driver Permit Printing Fee",
            customerEmail: (driver as IDriver).email,
            customerName: (driver as IDriver).fullName,
            metaData: {
              driverId: id,
              paymentType: invoiceType._id,
            },
            createdBy: userId as string,
          };

          const invoice = await MonnifyService.createInvoice(
            invoiceData,
            session
          );

          if (!invoice) {
            throw {
              code: 500,
              message: "Error creating invoice",
            };
          }

          return {
            amount: invoice[0]?.amount,
            bankName: invoice[0]?.bankName,
            accountName: invoice[0]?.accountName,
            accountNumber: invoice[0]?.accountNumber,
            expiryDate: invoice[0]?.expiryDate,
          };
        } else if (paymentType === PaymentTypeEnum.DRIVER_PERMIT_RENEWAL) {
          const driver = await DriverModel.findById(id).session(session);

          if (!driver) {
            return res
              .status(404)
              .json({ success: false, message: "Driver not found" });
          }

          const IS_EXPIRED =
            driver.permit && driver.permit.expiryDate <= new Date();

          // confirm if driver's permit has expired
          if (!IS_EXPIRED) {
            throw {
              code: 400,
              message: "Driver's permit has not expired",
            };
          }

          const invoiceType = await PaymentTypeModel.findOne(
            {
              name: PaymentTypeEnum.DRIVER_PERMIT_RENEWAL,
            },
            {
              _id: true,
              amount: true,
            },
            {
              session,
            }
          );

          if (!invoiceType) {
            throw {
              code: 404,
              message: "Invoice type does not exist",
            };
          }

          const invoiceData: IInvoiceData = {
            type: invoiceType._id?.toString(),
            amount: invoiceType?.amount,
            description: "Driver Permit Renewal Fee",
            customerEmail: (driver as IDriver).email,
            customerName: (driver as IDriver).fullName,
            metaData: {
              driverId: id,
              paymentType: invoiceType._id,
            },
            createdBy: userId as string,
          };

          const invoice = await MonnifyService.createInvoice(
            invoiceData,
            session
          );

          if (!invoice) {
            throw {
              code: 500,
              message: "Error creating invoice",
            };
          }

          return {
            amount: invoice[0]?.amount,
            bankName: invoice[0]?.bankName,
            accountName: invoice[0]?.accountName,
            accountNumber: invoice[0]?.accountNumber,
            expiryDate: invoice[0]?.expiryDate,
          };
        } else if (paymentType === PaymentTypeEnum.DRIVER_QR_CODE_PRINTING){
          const driver = await DriverModel.findById(id)
          .session(session);

        if (!driver) {
          return res
            .status(404)
            .json({ success: false, message: "Driver not found" });
        }

        const invoiceType = await PaymentTypeModel.findOne(
          {
            name: PaymentTypeEnum.DRIVER_QR_CODE_PRINTING,
          },
          {
            _id: true,
            amount: true,
          },
          {
            session,
          }
        );

        if (!invoiceType) {
          throw {
            code: 404,
            message: "Invoice type does not exist",
          };
        }

        const invoiceData: IInvoiceData = {
          type: invoiceType._id?.toString(),
          amount: invoiceType?.amount,
          description: "Driver QR Code Printing Fee",
          customerEmail: driver?.email,
          customerName: driver?.fullName,
          metaData: {
            driverId: id,
            paymentType: invoiceType._id,
          },
          createdBy: userId as string,
        };

        const invoice = await MonnifyService.createInvoice(
          invoiceData,
          session
        );

        if (!invoice) {
          throw {
            code: 500,
            message: "Error creating invoice",
          };
        }

        return {
          amount: invoice[0]?.amount,
          bankName: invoice[0]?.bankName,
          accountName: invoice[0]?.accountName,
          accountNumber: invoice[0]?.accountNumber,
          expiryDate: invoice[0]?.expiryDate,
        }; 
        }
        else {
          throw {
            code: 400,
            message: "Invalid payment type",
          };
        }
      });

      return res.status(200).json({
        success: true,
        message: "Invoice generated successfully",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error generating new invoice",
        error: error?.message,
      });
    }
  }
}
