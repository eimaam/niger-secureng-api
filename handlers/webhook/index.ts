import { sha512 } from "js-sha512";
import { Config } from "../../utils/config";
import { Request, Response } from "express";
import {
  WalletTransactionModel,
  WalletTransactionType,
} from "../../models/WalletTransaction";
import { UserModel } from "../../models/User";
import { withMongoTransaction } from "../../utils/mongoTransaction";
import {
  AccountStatusEnum,
  VehicleStatusEnum,
  PaymentStatusEnum,
  PaymentTypeEnum,
  RoleName,
} from "../../types";
import { WalletService } from "../../services/wallet.service";
import { MonnifyService } from "../../services/monnify.wallet.service";
import {
  extractIdFromReference,
  generateIdentityCode,
  generateUniqueReference,
  generateYearDateRange,
} from "../../utils";
import { IVehicle, Vehicle } from "../../models/Vehicle";
import InvoiceModel, { InvoiceStatusEnum } from "../../models/Invoice";
import UnitModel from "../../models/Unit";
import { PaymentTypeModel } from "../../models/PaymentType";
import mongoose, { isValidObjectId } from "mongoose";
import { BeneficiaryService } from "../../services/beneficiary.service";
import { TransactionModel } from "../../models/Transaction";
import { DriverModel } from "../../models/Driver";
import { InvoiceService } from "../../services/invoice.service";
import { VehicleService } from "../../services/vehicle.service";

const formatBeneficiariesForTransaction = (
  beneficiaries: {
    user: mongoose.Types.ObjectId;
    percentage: number;
    paymentType: mongoose.Types.ObjectId;
  }[]
) => {
  const formatted = beneficiaries.map((b) => ({
    ...b,
    userId: b.user,
  }));

  return formatted;
};

// transaction status values from Monnify
enum MonnifyTransactionStatusEnum {
  PAID = "PAID",
  OVERPAID = "OVERPAID",
  PARTIALLY_PAID = "PARTIALLY_PAID",
  PENDING = "PENDING",
  ABANDONED = "ABANDONED",
  CANCELLED = "CANCELLED",
  FAILED = "FAILED",
  REVERSED = "REVERSED",
  EXPIRED = "EXPIRED",
}

enum MonnifyDisbursementTransferStatus {
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  OTP_EMAIL_DISPATCH_FAILED = "OTP_EMAIL_DISPATCH_FAILED",
  PENDING_AUTHORIZATION = "PENDING_AUTHORIZATION",
}

const clientSecret = Config.MONNIFY_SECRET_KEY as string;

// Function to compute hash
const computeHash = (requestBody: object) => {
  return sha512.hmac(clientSecret, JSON.stringify(requestBody));
};

export class Webhooks {
  static async paymentReceived(req: Request, res: Response) {
    const {
      product,
      transactionReference,
      amountPaid,
      totalPayable,
      metaData,
    } = req.body.eventData;
    console.log("Webhook triggered ====> ");
    // reference here is the user's ID in db
    // the account creation was set to create account with the reference being the user's ID to allow for easy identification
    const reference = product.reference;

    // signature verification logic
    // Get the monnify-signature from headers
    const monnifySignature = req.headers["monnify-signature"];

    // Compute hash using the request body
    const computedHash = computeHash(req.body);

    // Check if the computed hash matches the monnifySignature
    if (computedHash !== monnifySignature) {
      return res.status(400).send("Invalid signature");
    }

    // Verify transaction status
    const paymentStatus = await MonnifyService.verifyTransactionStatus(
      transactionReference
    );

    if (paymentStatus !== MonnifyTransactionStatusEnum.PAID) {
      return res.status(400).send("Invalid transaction status");
    }

    if (amountPaid !== totalPayable) {
      return res.status(400).send("Invalid transaction amount");
    }

    // Check for duplicate transactions using the transaction reference
    const existingTransaction = await WalletTransactionModel.findOne({
      reference: transactionReference,
    });
    // return status 200 to Monnify if transaction already exists
    // this is required to prevent Monnify from retrying the transaction multiple times
    if (existingTransaction) {
      return res.status(200).json({
        success: true,
        message: "Duplicate transaction. Transaction already exists",
      });
    }

    // check if the transaction is invoice related and if the invoice is already paid
    const invoice = await InvoiceModel.findOne({
      invoiceReference: reference,
    });

    if (invoice && invoice.invoiceStatus === InvoiceStatusEnum.PAID) {
      return res.status(200).json({
        success: true,
        message: "Duplicate transaction. Invoice already paid",
      });
    }

    try {
      const result = await withMongoTransaction(async (session) => {
        const superAdmin = await UserModel.findOne({
          role: RoleName.SuperAdmin,
        }).session(session);

        if (!superAdmin) {
          throw {
            code: 404,
            message: "Super Admin not found",
          };
        }

        // handle reserved account funding webhook request
        if (product.type === "RESERVED_ACCOUNT") {
          const userAccount = await UserModel.findById(reference).session(
            session
          );

          if (!userAccount) {
            throw {
              code: 404,
              message: "User not found",
            };
          }

          const data = {
            type: WalletTransactionType.Funding,
            from: superAdmin._id,
            to: userAccount._id,
            amount: Number(amountPaid),
            reference: transactionReference,
            description: `Super Vendor Wallet Funding via Monnify with ${amountPaid}`,
            status: PaymentStatusEnum.SUCCESSFUL,
            processedBy: superAdmin._id,
          };

          const creditTransaction = await WalletService.creditDepositWallet(
            userAccount._id,
            data.amount as number,
            data.type,
            data.from,
            data.to,
            transactionReference,
            data.description as string,
            data.status,
            data.processedBy,
            session
          );

          if (!creditTransaction) {
            throw {
              code: 500,
              message: "Error updating wallet balance",
            };
          }

          return creditTransaction.transaction[0];
        } else if (product.type === "INVOICE") {
          const paymentTypeId = metaData?.paymentType;

          const paymentType = await PaymentTypeModel.findById(
            paymentTypeId
          ).session(session);

          if (!paymentType) {
            throw {
              code: 404,
              message: "Payment Type Not Found",
            };
          }
          const beneficiariesWithPercentages =
            await BeneficiaryService.getBeneficiariesByPaymentType(
              paymentTypeId,
              session
            );

          console.log("Beneficiaries ====> ", beneficiariesWithPercentages);
          // vehicle registration payment type processing
          if (paymentType.name === PaymentTypeEnum.VEHICLE_REGISTRATION) {
            const invoice = await InvoiceModel.findOne({
              invoiceReference: reference,
            }).session(session);

            if (!invoice) {
              throw {
                code: 404,
                message: "Invoice not found",
              };
            }

            // return status 200 to Monnify if invoice already paid
            // this is required to prevent Monnify from retrying the transaction multiple times
            if (invoice.invoiceStatus === InvoiceStatusEnum.PAID) {
              return {
                status: 200,
                message: "Duplicate transaction. Invoice already paid",
              };
            }

            const processedBy = invoice.createdBy;
            const vehicleId = metaData?.vehicleId;

            if (!vehicleId) {
              throw {
                code: 404,
                message: "Vehicle Id Not Found",
              };
            }

            if (!isValidObjectId(vehicleId)) {
              throw {
                code: 400,
                message: "Invalid Vehicle Id",
              };
            }

            const vehicle: IVehicle | null = await Vehicle.findById(
              vehicleId
            ).session(session);

            if (!vehicle) {
              throw {
                code: 404,
                message: "Vehicle Not Found",
              };
            }

            const updateInvoice = await InvoiceModel.findOneAndUpdate(
              {
                invoiceReference: reference,
              },
              {
                $set: {
                  invoiceStatus: InvoiceStatusEnum.PAID,
                },
              },
              {
                new: true,
                runValidators: true,
                session,
              }
            ).session(session);

            if (!updateInvoice) {
              throw {
                code: 404,
                message: "Invoice Not Found or Problem Updating Invoice",
              };
            }

            // generate identity code for the vehicle
            const existingUnit = await UnitModel.findById(vehicle.unit).session(
              session
            );

            if (!existingUnit) {
              throw {
                code: 404,
                message: "Unit Not Found",
              };
            }
            // getting this to calculate the number to assign to the vehicle alongside the unit code
            // only fetch vehicles with identity code
            const totalVehiclesInSameUnit =
              await VehicleService.getTotalNumberOfVehiclesInSameUnit(
                existingUnit._id,
                session
              );
            // Vehicle.find({
            //   unit: existingUnit._id,
            //   identityCode: { $exists: true, $ne: null },
            // })
            //   .countDocuments()
            //   .session(session);

            //  Auto Generate identity code based on unit code and number of vehicles in the unit
            const identityCode = generateIdentityCode(
              existingUnit.code,
              totalVehiclesInSameUnit
            );
            // generate licence registration and expiry date - 1 year from the current date
            const licenceRegistrationDate = generateYearDateRange().startDate;
            const licenceExpiryDate = generateYearDateRange().endDate;

            // for first time registration, we add one quota for vehicle certificate printing and qr code printing
            const certificatePrintingPaymentType =
              await PaymentTypeModel.findOne(
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

            if (!certificatePrintingPaymentType) {
              throw {
                code: 404,
                message: "Certificate printing payment type does not exist",
              };
            }

            const qrCodePrintingPaymentType = await PaymentTypeModel.findOne(
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

            if (!qrCodePrintingPaymentType) {
              throw {
                code: 404,
                message: "QR code printing payment type does not exist",
              };
            }

            // update vehicle with identity code, license details and a quota for certificate printing after verifying payment
            // this marks the full registration and activation of the vehicle
            const updatedVehicle = await Vehicle.findByIdAndUpdate(
              vehicleId,
              {
                $set: {
                  identityCode,
                  license: {
                    issueDate: licenceRegistrationDate,
                    expiryDate: licenceExpiryDate,
                  },
                  status: VehicleStatusEnum.ACTIVATED,
                  downloadQuota: [
                    { type: certificatePrintingPaymentType._id, quota: 1 },
                    { type: qrCodePrintingPaymentType._id, quota: 1 },
                  ],
                },
              },
              {
                new: true,
                runValidators: true,
              }
            ).session(session);

            if (!updatedVehicle) {
              throw {
                code: 404,
                message: "Vehicle Not Found or Problem Updating Vehicle",
              };
            }

            // fund beneficiaries

            for (const beneficiary of beneficiariesWithPercentages) {
              const beneficiaryAccount = await UserModel.findById(
                beneficiary.user
              ).session(session);

              if (!beneficiaryAccount) {
                throw {
                  code: 404,
                  message: "Beneficiary Account Not Found",
                };
              }

              const beneficiaryWalletUpdate =
                await WalletService.creditEarningsWallet(
                  beneficiaryAccount._id,
                  (Number(amountPaid) * beneficiary.percentage) / 100,
                  WalletTransactionType.Commision,
                  superAdmin._id,
                  beneficiaryAccount._id,
                  generateUniqueReference(),
                  "Vehicle Registration Benefit",
                  PaymentStatusEnum.SUCCESSFUL,
                  superAdmin._id,
                  session
                );

              if (!beneficiaryWalletUpdate) {
                throw {
                  code: 500,
                  message: "Error updating beneficiary wallet balance",
                };
              }
            }

            // create transaction record for the vehicle registration
            const transaction = await TransactionModel.create(
              [
                {
                  amount: Number(amountPaid),
                  status: PaymentStatusEnum.SUCCESSFUL,
                  vehicle: vehicleId,
                  processedBy,
                  type: paymentType._id,
                  // spread the beneficiary with percentages and for each make the user field userId
                  beneficiaries: formatBeneficiariesForTransaction(
                    beneficiariesWithPercentages
                  ),
                },
              ],
              { session }
            );

            if (!transaction) {
              throw {
                code: 500,
                message: "Error creating transaction",
              };
            }

            return updatedVehicle;
          } else if (
            paymentType.name === PaymentTypeEnum.VEHICLE_LICENSE_RENEWAL
          ) {
            const vehicleId = metaData?.vehicleId;

            if (!vehicleId || !isValidObjectId(vehicleId)) {
              throw {
                code: 404,
                message: "Invalid Vehicle Id",
              };
            }

            const vehicle = await Vehicle.findById(vehicleId).session(session);

            if (!vehicle) {
              throw {
                code: 404,
                message: "Vehicle Not Found",
              };
            }

            const license = vehicle.license;

            if (!license) {
              throw {
                code: 404,
                message: "Vehicle License Not Found",
              };
            }

            if (!license.expiryDate) {
              throw {
                code: 404,
                message: "Vehicle License Expiry Date Not Found",
              };
            }

            const updatedVehicle = await VehicleService.licenceUpdate(
              vehicleId,
              session
            );

            if (!updatedVehicle) {
              throw {
                code: 500,
                message: "Error updating vehicle license expiry date",
              };
            }

            const updatedInvoice = await InvoiceModel.findOneAndUpdate(
              { invoiceReference: reference },
              { $set: { invoiceStatus: InvoiceStatusEnum.PAID } },
              { new: true, runValidators: true, session }
            );

            if (!updatedInvoice) {
              throw {
                code: 500,
                message: "Error updating invoice status",
              };
            }

            // fund beneficiaries
            await Webhooks.distributeFundsToBeneficiaries(
              beneficiariesWithPercentages,
              Number(amountPaid),
              "Vehicle License Renewal Benefit",
              session
            );

            // create transaction record for the vehicle registration
            const transaction = await TransactionModel.create(
              [
                {
                  amount: Number(amountPaid),
                  status: PaymentStatusEnum.SUCCESSFUL,
                  vehicle: vehicleId,
                  processedBy: updatedInvoice?.createdBy,
                  type: paymentType._id,

                  beneficiaries: formatBeneficiariesForTransaction(
                    beneficiariesWithPercentages
                  ),
                },
              ],
              { session }
            );

            if (!transaction) {
              throw {
                code: 500,
                message: "Error creating transaction",
              };
            }

            return updatedVehicle;
          } else if (
            paymentType.name === PaymentTypeEnum.VEHICLE_QR_CODE_PRINTING
          ) {
            const vehicleId = metaData?.vehicleId;

            if (!vehicleId || !isValidObjectId(vehicleId)) {
              throw {
                code: 404,
                message: "Invalid Vehicle Id",
              };
            }

            const vehicle = await Vehicle.findById(vehicleId).session(session);

            if (!vehicle) {
              throw {
                code: 404,
                message: "Vehicle Not Found",
              };
            }

            // Update the vehicle's QR code printing quota
            const updatedVehicle = await Vehicle.findByIdAndUpdate(
              vehicleId,
              {
                $addToSet: {
                  downloadQuota: { type: paymentTypeId, quota: 0 },
                },
              },
              { new: true, session }
            );

            if (updatedVehicle) {
              await Vehicle.findByIdAndUpdate(
                vehicleId,
                {
                  $inc: { "downloadQuota.$[elem].quota": 1 },
                },
                {
                  arrayFilters: [{ "elem.type": paymentTypeId }],
                  new: true,
                  session,
                }
              );
            }

            if (!updatedVehicle) {
              throw {
                code: 500,
                message: "Error updating vehicle quota",
              };
            }

            const updatedInvoice = await InvoiceModel.findOneAndUpdate(
              { invoiceReference: reference },
              { $set: { invoiceStatus: InvoiceStatusEnum.PAID } },
              { new: true, session }
            );

            if (!updatedInvoice) {
              throw {
                code: 500,
                message: "Error updating invoice status",
              };
            }

            // fund beneficiaries
            await Webhooks.distributeFundsToBeneficiaries(
              beneficiariesWithPercentages,
              Number(amountPaid),
              "Vehicle QR Code Printing Benefit",
              session
            );

            // create transaction record for the vehicle registration
            const transaction = await TransactionModel.create(
              [
                {
                  amount: Number(amountPaid),
                  status: PaymentStatusEnum.SUCCESSFUL,
                  vehicle: vehicleId,
                  processedBy: updatedInvoice?.createdBy,
                  type: paymentType._id,

                  beneficiaries: formatBeneficiariesForTransaction(
                    beneficiariesWithPercentages
                  ),
                },
              ],
              { session }
            );

            if (!transaction) {
              throw {
                code: 500,
                message: "Error creating transaction",
              };
            }

            return updatedVehicle;
          }

          // certificate printing payment type processing
          else if (paymentType.name === PaymentTypeEnum.CERTIFICATE_PRINTING) {
            const vehicleId = metaData?.vehicleId;

            if (!vehicleId) {
              throw {
                code: 404,
                message: "Vehicle Id Not Found",
              };
            }

            if (!isValidObjectId(vehicleId)) {
              throw {
                code: 400,
                message: "Invalid Vehicle Id",
              };
            }

            const vehicle: IVehicle | null = await Vehicle.findById(
              vehicleId
            ).session(session);

            if (!vehicle) {
              throw {
                code: 404,
                message: "Vehicle Not Found",
              };
            }

            // Update the vehicle's download quota
            // With this updated block:
            const updatedVehicle = await Vehicle.findByIdAndUpdate(
              vehicleId,
              {
                $addToSet: {
                  downloadQuota: { type: paymentTypeId, quota: 0 },
                },
              },
              { new: true, session }
            );

            if (updatedVehicle) {
              await Vehicle.findByIdAndUpdate(
                vehicleId,
                {
                  $inc: { "downloadQuota.$[elem].quota": 1 },
                },
                {
                  arrayFilters: [{ "elem.type": paymentTypeId }],
                  new: true,
                  session,
                }
              );
            }

            if (!updatedVehicle) {
              throw {
                code: 500,
                message: "Error updating vehicle quota",
              };
            }

            const updatedInvoice = await InvoiceModel.findOneAndUpdate(
              { invoiceReference: reference },
              { $set: { invoiceStatus: InvoiceStatusEnum.PAID } },
              { new: true, session }
            );

            if (!updatedInvoice) {
              throw {
                code: 500,
                message: "Error updating invoice status",
              };
            }

            // fund beneficiaries
            await Webhooks.distributeFundsToBeneficiaries(
              beneficiariesWithPercentages,
              Number(amountPaid),
              "Certificate Printing Benefit",
              session
            );

            // create transaction record for the vehicle registration
            const transaction = await TransactionModel.create(
              [
                {
                  amount: Number(amountPaid),
                  status: PaymentStatusEnum.SUCCESSFUL,
                  vehicle: vehicleId,
                  processedBy: updatedInvoice?.createdBy,
                  type: paymentType._id,

                  beneficiaries: formatBeneficiariesForTransaction(
                    beneficiariesWithPercentages
                  ),
                },
              ],
              { session }
            );

            if (!transaction) {
              throw {
                code: 500,
                message: "Error creating transaction",
              };
            }

            return updatedVehicle;
          } else if (paymentType.name === PaymentTypeEnum.VEHICLE_UPDATE) {
            const vehicleId = metaData?.vehicleId;

            if (!vehicleId || !isValidObjectId(vehicleId)) {
              throw {
                code: 404,
                message: "Invalid Vehicle Id",
              };
            }

            const vehicle = await Vehicle.findById(vehicleId).session(session);

            if (!vehicle) {
              throw {
                code: 404,
                message: "Vehicle Not Found",
              };
            }

            // Update the vehicle's edit or update quota
            // also add a quota for certificate printing

            const certificatePrintingPaymentType =
              await PaymentTypeModel.findOne(
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

            if (!certificatePrintingPaymentType) {
              throw {
                code: 404,
                message: "Certificate printing payment type does not exist",
              };
            }

            const updatedVehicle = await Vehicle.findByIdAndUpdate(
              vehicleId,
              {
                $addToSet: {
                  downloadQuota: {
                    $each: [
                      { type: paymentTypeId, quota: 0 },
                      { type: certificatePrintingPaymentType._id, quota: 0 },
                    ],
                  },
                },
              },
              { new: true, session }
            );

            if (updatedVehicle) {
              await Vehicle.findByIdAndUpdate(
                vehicleId,
                {
                  $inc: {
                    "downloadQuota.$[elem1].quota": 1,
                    "downloadQuota.$[elem2].quota": 1,
                  },
                },
                {
                  arrayFilters: [
                    { "elem1.type": paymentTypeId },
                    { "elem2.type": certificatePrintingPaymentType._id },
                  ],
                  new: true,
                  session,
                }
              );
            }

            if (!updatedVehicle) {
              throw {
                code: 500,
                message: "Error updating vehicle quota",
              };
            }

            const updatedInvoice = await InvoiceModel.findOneAndUpdate(
              { invoiceReference: reference },
              { $set: { invoiceStatus: InvoiceStatusEnum.PAID } },
              { new: true, runValidators: true, session }
            );

            if (!updatedInvoice) {
              throw {
                code: 500,
                message: "Error updating invoice status",
              };
            }

            // fund beneficiaries
            await Webhooks.distributeFundsToBeneficiaries(
              beneficiariesWithPercentages,
              Number(amountPaid),
              "Vehicle Update Benefit",
              session
            );

            // create transaction record for the vehicle registration
            const transaction = await TransactionModel.create(
              [
                {
                  amount: Number(amountPaid),
                  status: PaymentStatusEnum.SUCCESSFUL,
                  vehicle: vehicleId,
                  processedBy: updatedInvoice?.createdBy,
                  type: paymentType._id,

                  beneficiaries: formatBeneficiariesForTransaction(
                    beneficiariesWithPercentages
                  ),
                },
              ],
              { session }
            );

            if (!transaction) {
              throw {
                code: 500,
                message: "Error creating transaction",
              };
            }

            return updatedVehicle;
          } else if (paymentType.name === PaymentTypeEnum.DRIVER_REGISTRATION) {

            const driverId = metaData?.driverId;

            if (!driverId || !isValidObjectId(driverId)) {
              throw {
                code: 404,
                message: "Invalid Driver Id",
              };
            }

            const driver = await DriverModel.findById(driverId).session(
              session
            );

            if (!driver) {
              throw {
                code: 404,
                message: "Driver Not Found",
              };
            }

            const updatedInvoice = await InvoiceService.updateInvoiceStatus(
              reference,
              InvoiceStatusEnum.PAID,
              session
            );

            // for first time registration, we add one quota for driver permit printing, qr code printing
            const permitPrintingPaymentType = await PaymentTypeModel.findOne({
              name: PaymentTypeEnum.DRIVER_PERMIT_PRINTING,
            },
            {
              _id: true,
              amount: true,
            },
            {
              session,
            }
          )

            if (!permitPrintingPaymentType) {
              throw {
                code: 404,
                message: "Driver Permit Printing Payment Type Not Found",
              };
            }

            const qrCodePrinting = await PaymentTypeModel.findOne({
              name: PaymentTypeEnum.DRIVER_QR_CODE_PRINTING,
            }, 
          {
            _id: true,
            amount: true,
          },
          {
            session,
          }
          )

          if (!qrCodePrinting) {
            throw {
              code: 404,
              message: "Driver QR Code Printing Payment Type Not Found",
            };
          }

          // ensuring date data are free from manipulation by handling in the server
            // and not from the client side > this is to prevent date manipulation by changing device date
            const permitIssueDate = generateYearDateRange().startDate;
            const permitExpiryDate = generateYearDateRange().endDate;

            // create permit data and activate driver
            const updatedDriver = await DriverModel.findByIdAndUpdate(
              driverId,
              {
                $set: {
                  permit: {
                    issueDate: permitIssueDate,
                    expiryDate: permitExpiryDate,
                  },
                  downloadQuota: [
                    { type: permitPrintingPaymentType._id, quota: 1 },
                    { type: qrCodePrinting._id, quota: 1 },
                  ],
                  status: AccountStatusEnum.ACTIVE,
                },
              },
              {
                new: true,
                runValidators: true,
                session,
              }
            );

            if (!updatedDriver) {
              throw {
                code: 500,
                message: "Error updating driver permit",
              };
            }

            // fund beneficiaries
            await Webhooks.distributeFundsToBeneficiaries(
              beneficiariesWithPercentages,
              Number(amountPaid),
              "Driver Registration Benefit",
              session
            );

            // create transaction record for the driver registration
            const transaction = await TransactionModel.create(
              [
                {
                  amount: Number(amountPaid),
                  status: PaymentStatusEnum.SUCCESSFUL,
                  driver: driverId,
                  processedBy: updatedInvoice?.createdBy,
                  type: paymentType._id,
                  beneficiaries: formatBeneficiariesForTransaction(
                    beneficiariesWithPercentages
                  ),
                },
              ],
              { session }
            );

            if (!transaction) {
              throw {
                code: 500,
                message: "Error creating transaction",
              };
            }

            return updatedDriver;
          } else if (
            paymentType.name === PaymentTypeEnum.DRIVER_PERMIT_PRINTING
          ) {
            const driverId = metaData?.driverId;

            if (!driverId || !isValidObjectId(driverId)) {
              throw {
                code: 404,
                message: "Invalid Driver Id",
              };
            }

            const driver = await DriverModel.findById(driverId).session(
              session
            );

            if (!driver) {
              throw {
                code: 404,
                message: "Driver Not Found",
              };
            }

            const updatedInvoice = await InvoiceService.updateInvoiceStatus(
              reference,
              InvoiceStatusEnum.PAID,
              session
            );

            // First, check if the downloadQuota for this payment type exists
            let updatedDriver;

            if (
              driver.downloadQuota &&
              driver.downloadQuota.some(
                (q) => q.type.toString() === paymentTypeId.toString()
              )
            ) {
              // If it exists, just increment the quota
              updatedDriver = await DriverModel.findByIdAndUpdate(
                driverId,
                {
                  $inc: {
                    "downloadQuota.$[elem].quota": 1,
                  },
                },
                {
                  arrayFilters: [{ "elem.type": paymentTypeId }],
                  new: true,
                  session,
                }
              );
            } else {
              // If it doesn't exist, add a new entry
              updatedDriver = await DriverModel.findByIdAndUpdate(
                driverId,
                {
                  $push: {
                    downloadQuota: { type: paymentTypeId, quota: 1 },
                  },
                },
                {
                  new: true,
                  session,
                }
              );
            }

            if (!updatedDriver) {
              console.error(`Failed to update driver ${driverId}`);
              throw {
                code: 500,
                message: "Failed to update driver",
              };
            }

            // fund beneficiaries
            await Webhooks.distributeFundsToBeneficiaries(
              beneficiariesWithPercentages,
              Number(amountPaid),
              "Driver Permit Printing Benefit",
              session
            );

            // create transaction record for the driver permit printing
            const transaction = await TransactionModel.create(
              [
                {
                  amount: Number(amountPaid),
                  status: PaymentStatusEnum.SUCCESSFUL,
                  driver: driverId,
                  processedBy: updatedInvoice?.createdBy,
                  type: paymentType._id,

                  beneficiaries: formatBeneficiariesForTransaction(
                    beneficiariesWithPercentages
                  ),
                },
              ],
              { session }
            );

            if (!transaction) {
              throw {
                code: 500,
                message: "Error creating transaction",
              };
            }

            return updatedDriver;
          } else if (
            paymentType.name === PaymentTypeEnum.DRIVER_PERMIT_RENEWAL
          ) {
            const driverId = metaData?.driverId;

            if (!driverId || !isValidObjectId(driverId)) {
              throw {
                code: 404,
                message: "Invalid Driver Id",
              };
            }

            const driver = await DriverModel.findById(driverId).session(
              session
            );

            if (!driver) {
              throw {
                code: 404,
                message: "Driver Not Found",
              };
            }

            const updatedInvoice = await InvoiceService.updateInvoiceStatus(
              reference,
              InvoiceStatusEnum.PAID,
              session
            );

            // get driver's permit issue and expiry date
            const permitExpiryDate = driver.permit?.expiryDate;

            // renew permit by adding 1 year to the expiry date
            const newExpiryDate = new Date(permitExpiryDate);
            newExpiryDate.setFullYear(newExpiryDate.getFullYear() + 1);

            const PERMIT_PRINTING = await PaymentTypeModel.findOne({
              name: PaymentTypeEnum.DRIVER_PERMIT_PRINTING,
            }).session(session);

            // First, check if the downloadQuota for permit printing exists
            let updatedDriver;

            if (
              driver.downloadQuota &&
              driver.downloadQuota.some(
                (q) => q.type.toString() === PERMIT_PRINTING?._id.toString()
              )
            ) {
              // If it exists, just increment the quota
              // and update the permit expiry date
              updatedDriver = await DriverModel.findByIdAndUpdate(
                driverId,
                {
                  $set: {
                    "permit.expiryDate": newExpiryDate,
                  },
                  $inc: {
                    "downloadQuota.$[elem].quota": 1,
                  },
                },
                {
                  arrayFilters: [{ "elem.type": PERMIT_PRINTING?._id }],
                  new: true,
                  session,
                }
              );
            } else {
              // If it doesn't exist, add a new entry
              // and update the permit expiry date
              updatedDriver = await DriverModel.findByIdAndUpdate(
                driverId,
                {
                  $set: {
                    "permit.expiryDate": newExpiryDate,
                  },
                  $push: {
                    downloadQuota: { type: PERMIT_PRINTING?._id, quota: 1 },
                  },
                },
                {
                  new: true,
                  session,
                }
              );
            }

            if (!updatedDriver) {
              console.error(`Failed to update driver ${driverId}`);
              throw {
                code: 500,
                message: "Failed to update driver",
              };
            }

            // fund beneficiaries
            await Webhooks.distributeFundsToBeneficiaries(
              beneficiariesWithPercentages,
              Number(amountPaid),
              "Driver Permit Renewal Benefit",
              session
            );

            // create transaction record for the driver permit renewal
            const transaction = await TransactionModel.create(
              [
                {
                  amount: Number(amountPaid),
                  status: PaymentStatusEnum.SUCCESSFUL,
                  driver: driverId,
                  processedBy: updatedInvoice?.createdBy,
                  type: paymentType._id,

                  beneficiaries: formatBeneficiariesForTransaction(
                    beneficiariesWithPercentages
                  ),
                },
              ],
              { session }
            );

            if (!transaction) {
              throw {
                code: 500,
                message: "Error creating transaction",
              };
            }

            return updatedDriver;
          } else {
            throw {
              code: 400,
              message: "Invalid Payment Type",
            };
          }
        }
      });

      return res.status(200).json({
        success: true,
        message: "Data Processed and Transaction Completed",
        data: result,
      });
    } catch (error: any) {
      console.log(JSON.stringify(error, null, 2));
      console.error("Error in paymentReceived webhook:", error);
      console.error("Error stack:", error.stack);
      console.error("Request body:", JSON.stringify(req.body, null, 2));

      // Handle specific errors
      if (error.code) {
        return res.status(error.code).json({
          success: false,
          message: error.message,
        });
      }
      return res.status(500).json({
        success: false,
        message: "Error funding wallet",
        error: error.message,
      });
    }
  }

  static async disbursementCompleted(req: Request, res: Response) {
    // in sending the transfer request, user's id is used as narration therefore the narration value from the webhook will be the user's id
    // using the narration to get the User's earnings and process wallet operations
    const { amount, reference, status, narration, transactionDescription } =
      req.body.eventData;

    const superAdmin = await UserModel.findOne({
      role: RoleName.SuperAdmin,
    });

    if (!superAdmin) {
      throw {
        code: 404,
        message: "Super Admin not found",
      };
    }

    const beneficiaryId: string = narration;

    // signature verification logic
    // Get the monnify-signature from headers
    const monnifySignature = req.headers["monnify-signature"];

    // Compute hash using the request body
    const computedHash = computeHash(req.body);

    // Check if the computed hash matches the monnifySignature
    if (computedHash !== monnifySignature) {
      return res.status(400).send("Invalid signature");
    }

    // Verify transaction was successful
    if (status === MonnifyDisbursementTransferStatus.FAILED) {
      const data = {
        type: WalletTransactionType.Commision,
        from: superAdmin._id,
        to: beneficiaryId,
        amount,
        reference,
        description: `Earnings Distribution - ${transactionDescription}`,
        status: PaymentStatusEnum.FAILED,
        processedBy: superAdmin._id,
      };

      const transaction = await WalletTransactionModel.create([data]);

      if (!transaction) {
        throw {
          code: 500,
          message: "Error creating transaction",
        };
      }

      return res.status(400).send("Transfer Failed");
    }

    if (status !== MonnifyDisbursementTransferStatus.SUCCESS) {
      return res.status(400).send("Invalid transaction status");
    }

    try {
      const result = await withMongoTransaction(async (session) => {
        // Check for duplicate transactions using the transaction reference
        const existingTransaction = await WalletTransactionModel.findOne({
          reference,
        }).session(session);
        // returning status 200 to Monnify if transaction already exists
        // this is required to prevent Monnify from retrying the transaction multiple times
        if (existingTransaction) {
          throw {
            code: 200,
            message: "Duplicate transaction",
          };
        }

        const superAdmin = await UserModel.findOne({
          role: RoleName.SuperAdmin,
        }).session(session);

        if (!superAdmin) {
          throw {
            code: 404,
            message: "Super Admin not found",
          };
        }

        const userAccount = await UserModel.findById(beneficiaryId).session(
          session
        );

        if (!userAccount) {
          throw {
            code: 404,
            message: "User not found",
          };
        }

        const data = {
          type: WalletTransactionType.Commision,
          from: userAccount._id,
          to: userAccount._id,
          amount: Number(amount),
          reference,
          description: `Earnings Distribution - ${transactionDescription}`,
          status: PaymentStatusEnum.SUCCESSFUL,
          processedBy: superAdmin._id,
        };

        const creditTransaction = await WalletService.debitEarningsWallet(
          userAccount._id,
          data.amount as number,
          data.type,
          data.from,
          data.to,
          data.reference,
          data.description as string,
          data.status,
          data.processedBy,
          session
        );

        if (!creditTransaction) {
          throw {
            code: 500,
            message: "Error updating wallet balance",
          };
        }

        return creditTransaction.transaction[0];
      });

      return res.status(200).json({
        success: true,
        message: "Wallet Funded Successfully",
        data: result,
      });
    } catch (error: any) {
      console.error(error);

      // Handle specific errors
      if (error.code) {
        return res.status(error.code).json({
          success: false,
          message: error.message,
        });
      }
      return res.status(500).json({
        success: false,
        message: "Error funding wallet",
        error: error.message,
      });
    }
  }

  private static async distributeFundsToBeneficiaries(
    beneficiariesWithPercentages: {
      user: mongoose.Types.ObjectId;
      percentage: number;
    }[],
    amountPaid: number,
    description: string,
    session: any
  ) {
    for (const beneficiary of beneficiariesWithPercentages) {
      const superAdmin = await UserModel.findOne({
        role: RoleName.SuperAdmin,
      }).session(session);

      if (!superAdmin) {
        throw {
          code: 404,
          message: "Super Admin not found",
        };
      }
      const beneficiaryAccount = await UserModel.findById(
        beneficiary.user
      ).session(session);

      if (!beneficiaryAccount) {
        throw {
          code: 404,
          message: "Beneficiary Account Not Found",
        };
      }

      const beneficiaryWalletUpdate = await WalletService.creditEarningsWallet(
        beneficiaryAccount._id,
        (Number(amountPaid) * beneficiary.percentage) / 100,
        WalletTransactionType.Commision,
        superAdmin._id,
        beneficiaryAccount._id,
        generateUniqueReference(),
        description,
        PaymentStatusEnum.SUCCESSFUL,
        superAdmin._id,
        session
      );

      if (!beneficiaryWalletUpdate) {
        throw {
          code: 500,
          message: "Error updating beneficiary wallet balance",
        };
      }
    }
  }
}
