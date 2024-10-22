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
import { EarningsWalletModel, IWallet } from "../../models/Wallet";
import { IVehicleOwner } from "../../models/VehicleOwner";
import { PaymentTypeEnum } from "../../types";
import { withMongoTransaction } from "../../utils/mongoTransaction";
import { Vehicle } from "../../models/Vehicle";
import { PaymentTypeModel } from "../../models/PaymentType";
import { DriverModel, IDriver } from "../../models/Driver";
import { VehicleService } from "../../services/vehicle.service";

export class Monnify {
  static async singleTransfer(req: Request, res: Response) {
    const { walletId } = req.params;

    const wallet = await EarningsWalletModel.findById(walletId);

    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: "Wallet not found",
      });
    }

    const paymentDetail = await PaymentDetailsModel.findOne({
      owner: wallet.owner,
    });

    if (!paymentDetail) {
      return res.status(404).json({
        success: false,
        message: "Payment detail not found",
      });
    }

    const amount = wallet.balance;
    const accountNumber = paymentDetail.accountNumber;
    const bankCode = paymentDetail.bankCode;

    if (!amount || !accountNumber || !bankCode) {
      return res.status(400).json({
        success: false,
        message: "Amount, account number and bank code are required",
      });
    }

    if (amount < Number(Config.MIN_WITHDRAWAL_AMOUNT)) {
      return res.status(400).json({
        success: false,
        message: `Amount must be greater than or equal to N${Config.MIN_WITHDRAWAL_AMOUNT}`,
      });
    }

    try {
      const paymentDetail = {
        amount: (Number(amount) - Number(Config.BANK_TRANSFER_FEE)),
        reference: generateUniqueReference(),
        narration: wallet.owner.toString(),
        destinationBankCode: bankCode,
        destinationAccountNumber: accountNumber,
      };

      const transfer = await MonnifyService.initiateSingleTransfer(
        paymentDetail.amount,
        paymentDetail.destinationAccountNumber,
        paymentDetail.destinationBankCode,
        paymentDetail.reference,
        paymentDetail.narration
      );

      if (!transfer) {
        return res.status(500).json({
          success: false,
          message: "Error initiating transfer",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Transfer successful",
        data: transfer,
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

    const MIN_WITHDRAWAL_AMOUNT: number = Number(Config.MIN_WITHDRAWAL_AMOUNT);

    try {
      // Fetch all payment details
      const paymentDetails = await PaymentDetailsModel.find({});
      // Fetch all earnings
      const earningsWallets = (await EarningsWalletModel.find({
        _id: { $in: wallets },
      })) as IWallet[];

      // check if there is a at least a single earning wallet with a balance greater than or equal to the minimum withdrawal amount
      // this saves time where once there is no wallet if a min withdrawal amount we simply return error and terminate
      const hasValidEarnings = earningsWallets.some(
        (earning) => earning.balance >= MIN_WITHDRAWAL_AMOUNT
      );

      if (!hasValidEarnings) {
        return res.status(400).json({
          success: false,
          message: `No Wallet with N${Config.MIN_WITHDRAWAL_AMOUNT} min withdrawal amount found`,
        });
      }

      // Prepare transactions for bulk transfer
      const transactions = earningsWallets
        .map((beneficiaryWallet: IWallet) => {
          const paymentDetail: IPaymentDetail = paymentDetails.find(
            (pd) => pd.owner.toString() === beneficiaryWallet.owner.toString()
          );
          if (
            paymentDetail &&
            beneficiaryWallet.balance >= MIN_WITHDRAWAL_AMOUNT
          ) {
            return {
              // deduct bank transfer fee > will be added to the amount when debiting the beneficiary wallet balance to record trx history when webhook is received
              amount: (beneficiaryWallet.balance - Number(Config.BANK_TRANSFER_FEE)),
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
        .filter(
          (transaction): transaction is IMonnifyTransaction =>
            transaction !== null
        );

      if (transactions.length === 0 && !hasValidEarnings) {
        return res.status(400).json({
          success: false,
          message: "No Wallet with min withdrawal amount found",
        });
      }

      if (transactions.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid transactions found",
        });
      }

      const bulkTransfer = await MonnifyService.initiateBulkTransfer(
        transactions
      );

      if (!bulkTransfer) {
        return res.status(500).json({
          success: false,
          message: "Error initiating bulk transfer",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Bulk transfer successful",
        data: bulkTransfer,
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
          console.log("driver permit renewal");
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
            driver: id,
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
