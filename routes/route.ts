import { Request, Response, Router } from "express";
import { UnregisteredVehicles, Vehicles } from "../handlers/vehicle";
import { Vendors } from "../handlers/vendor";
import { User } from "../handlers/users";
import { Auth } from "../handlers/auth";
import { PaymentTypes } from "../handlers/payment-types";
import { Issuables } from "../handlers/issuable";
import { Drivers } from "../handlers/drivers";
import { Associations } from "../handlers/associations";
import Units from "../handlers/unit";
import PaymentCategory from "../handlers/payment-category";
import { SuperVendor } from "../handlers/super-vendor";
import { LGAs } from "../handlers/Lga";
import { LGAHeads } from "../handlers/LgaHead";
import { checkRole } from "../middlewares/roleChecker.middleware";
import { PaymentTypeEnum, RoleName } from "../types";
import { VehicleOwners } from "../handlers/vehicle-owners";
import { BeneficiaryController } from "../handlers/beneficiary";
import { Tax } from "../handlers/tax";
import { WalletController } from "../handlers/wallet";
import { Analytics } from "../handlers/analytics";
import { Webhooks } from "../handlers/webhook";
import { MonnifyService } from "../services/monnify.wallet.service";
import MonnifySupportedBankModel from "../models/MonnifySupportedBank";
import { Monnify } from "../handlers/monnify";
import { upload } from "../utils";
import { Invoices } from "../handlers/invoice";
import { Config } from "../utils/config";
import { DownloadHistory } from "../handlers/download-history";
import { body, validationResult } from "express-validator";
import { PaymentTypeModel } from "../models/PaymentType";
import { Vehicle } from "../models/Vehicle";
import { withMongoTransaction } from "../utils/mongoTransaction";
import { VehicleService } from "../services/vehicle.service";
import mongoose from "mongoose";
import { Transactions } from "../handlers/transaction";
import { SubUnits } from "../handlers/sub-unit";
import { resetPasswordValidator } from "../middlewares/validators/reset-password.validator";
import { handleValidationErrors } from "../middlewares/requestValidator";
import { forgotPasswordLimiter } from "../middlewares/api.limiters";
import { emailValidator } from "../middlewares/validators/email.validator";
import fs from "fs";
import path from "path";

const route = Router();

route.get("/healthcheck", async (_req, res) => {
  res.status(200).json({
    success: true,
    message: "API is running...",
  });
});

// auth
route.post("/auth/login", Auth.login);
route.post("/auth/forgot-password", forgotPasswordLimiter, emailValidator, handleValidationErrors, Auth.forgotPassword);
route.post("/auth/reset-password", resetPasswordValidator, handleValidationErrors, Auth.resetPassword);

//user
route.post("/user", checkRole(), User.create);
route.get("/user/me/:userId", User.getProfile);
route.get("/user", checkRole(), User.singleUser);
route.get("/users", checkRole([RoleName.UserAdmin]), User.getAllUsers);
route.patch("/user", checkRole(), User.updateUser);
route.delete("/user/:id", checkRole(), User.deleteUser);
// update password from default password to a new password
route.put("/users/:userId/password", User.updateDefaultPassword);
// Admin: reset a user's password 
route.put("/users/admin/:userId/reset-password", checkRole(), User.resetUserPassword);

// registered vehicle
route.post(
  "/vehicle",
  checkRole([
    RoleName.GeneralAdmin,
    RoleName.RegistrationAdmin,
    RoleName.VehicleAdmin,
    RoleName.VehicleRegistrationAdmin,
  ]),
  upload.single("image"),
  Vehicles.registerNew
);

route.post(
  "/vehicle/existing-owner",
  checkRole([
    RoleName.GeneralAdmin,
    RoleName.VehicleAdmin,
    RoleName.RegistrationAdmin,
    RoleName.VehicleRegistrationAdmin,
  ]),
  Vehicles.registerExistingOwner
);
route.post(
  "/vehicle/transfer/:vehicleId",
  checkRole([RoleName.GeneralAdmin, RoleName.TransferAdmin]),
  upload.single("image"),
  Vehicles.transferOwnership
);
route.get(
  "/vehicle/:id",
  checkRole([
    RoleName.GeneralAdmin,
    RoleName.VehicleAdmin,
    RoleName.RegistrationAdmin,
    RoleName.VehicleRegistrationAdmin,
  ]),
  Vehicles.getById
);
// public data : this was set in the frontend and some vehicle QR already using it,
// so adding a the route here but setting it to navigate to the frontend page with the id for the verification
route.get("/vehicle/qr/public/:vehicleId", (req: Request, res: Response) => {
  res.redirect(
    `${Config.FRONTEND_URL}/vehicle/qr/public/${req.params.vehicleId}`
  );
});
// main vehicle qr route
route.get("/vehicle/qr/:vehicleId", Vehicles.getDataByQRCode);
route.get(
  "/vehicles",
  checkRole([
    RoleName.Government,
    RoleName.GeneralAdmin,
    RoleName.VehicleAdmin,
    RoleName.PrintingAdmin,
    RoleName.RegistrationAdmin,
    RoleName.VehicleRegistrationAdmin,
    RoleName.Association,
  ]),
  Vehicles.getAll
);
route.get(
  "/vehicles/filter",
  checkRole([
    RoleName.Government,
    RoleName.GeneralAdmin,
    RoleName.TransferAdmin,
    RoleName.VehicleAdmin,
    RoleName.RegistrationAdmin,
    RoleName.VehicleRegistrationAdmin,
    RoleName.Vendor,
  ]),
  Vehicles.getVehiclesByFilters
);
route.post(
  "/vehicles/:vehicleId/status",
  checkRole([
    RoleName.GeneralAdmin,
    RoleName.VehicleAdmin,
    RoleName.VehicleUpdateAdmin,
    RoleName.UpdateAdmin,
  ]),
  Vehicles.updateVehicleStatus
);

route.patch(
  "/vehicle/:id",
  checkRole([
    RoleName.GeneralAdmin,
    RoleName.VehicleUpdateAdmin,
    RoleName.UpdateAdmin,
    RoleName.VehicleAdmin,
    RoleName.VehicleRegistrationAdmin,
  ]),
  Vehicles.updateVehicle
);
route.delete("/vehicle/:id", checkRole(), Vehicles.deleteVehicle);
route.post(
  "/vehicles/license/renewal/:id",
  checkRole([
    RoleName.GeneralAdmin,
    RoleName.VehicleAdmin,
    RoleName.VehicleRegistrationAdmin,
  ]),
  Vehicles.renewLicense
);
route.post(
  "/vehicle/download/certificate/:vehicleId",
  checkRole([RoleName.PrintingAdmin, RoleName.GeneralAdmin]),
  Vehicles.printCertificate
);
route.post(
  "/vehicle/download/qr/:vehicleId",
  checkRole([RoleName.PrintingAdmin, RoleName.GeneralAdmin]),
  Vehicles.downloadQrCode
);
// unregistered
// route.post("/vehicle/unregistered", Vehicles.registerUnregisteredVehicle);
route.get(
  "/vehicle/unregistered/",
  checkRole([
    RoleName.Government,
    RoleName.Vendor,
    RoleName.VehicleAdmin,
    RoleName.PrintingAdmin,
    RoleName.RegistrationAdmin,
    RoleName.VehicleRegistrationAdmin,
  ]),
  UnregisteredVehicles.fetchUnregisteredVehicles
);
route.get(
  "/vehicle/unregistered/:chassisNumber",
  checkRole([
    RoleName.Government,
    RoleName.Vendor,
    RoleName.GeneralAdmin,
    RoleName.VehicleAdmin,
    RoleName.PrintingAdmin,
    RoleName.RegistrationAdmin,
    RoleName.VehicleRegistrationAdmin,
  ]),
  UnregisteredVehicles.getUnregisteredVehicleByChasssisNumber
);

// vehicle owners
// check if owner exists
route.post(
  "/vehicle/owners/check",
  checkRole([
    RoleName.VehicleAdmin,
    RoleName.GeneralAdmin,
    RoleName.RegistrationAdmin,
    RoleName.UpdateAdmin,
  ]),
  VehicleOwners.checkOwnerExists
);
route.get(
  "/vehicles/owners",
  checkRole([RoleName.VehicleAdmin, RoleName.Government, RoleName.UpdateAdmin]),
  upload.single("image"),
  VehicleOwners.getAll
);
route.get(
  "/vehicles/owners/:id",
  checkRole([RoleName.VehicleAdmin, RoleName.Government, RoleName.UpdateAdmin]),
  VehicleOwners.getById
);
route.get(
  "/vehicles/owners/filter",
  checkRole([RoleName.VehicleAdmin, RoleName.Government, RoleName.UpdateAdmin]),
  VehicleOwners.getByFilters
);
// TODO: move handler to vehicle owners
route.post(
  "/vehicles/owners/:id",
  checkRole([RoleName.VehicleAdmin, RoleName.UpdateAdmin]),
  Vehicles.updateOwner
);

// drivers
route.post(
  "/driver",
  checkRole([
    RoleName.GeneralAdmin,
    RoleName.VehicleAdmin,
    RoleName.RegistrationAdmin,
    RoleName.VehicleRegistrationAdmin,
  ]),
  upload.single("image"),
  Drivers.registerDriver
);
route.get("/drivers/qr/:driverId", Drivers.getDataByQRCode);

// download
route.get("/downloads", checkRole([RoleName.GeneralAdmin, RoleName.PrintingAdmin, RoleName.RegistrationAdmin]), DownloadHistory.getAll);
route.post(
  "/vehicles/quota",
  checkRole(),
  async (req: Request, res: Response) => {
    const { identityCode, quota, type } = req.body;

    // validate via express valdator
    const validations = [
      body("identityCode")
        .notEmpty()
        .withMessage("Identity code is required")
        .isString()
        .withMessage("Identity code must be a string"),
      body("quota").isInt().withMessage("Quota must be a number"),
      body("type")
        .isIn(Object.values(PaymentTypeEnum))
        .withMessage("Invalid payment type"),
    ];

    await Promise.all(validations.map((validation) => validation.run(req)));

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()?.[0]?.msg,
        errors: errors.array(),
      });
    }

    try {
      let targetItem: mongoose.Types.ObjectId | string;
      const result = await withMongoTransaction(async (session) => {
        const quotaType = await PaymentTypeModel.findOne({
          name: type,
        }).session(session);

        if (!quotaType) {
          throw { code: 400, message: "Payment type does not exist" };
        }

        if (identityCode) {
          const vehicle = await Vehicle.findOne({ identityCode }).session(
            session
          );

          if (!vehicle) {
            throw { code: 404, message: "Vehicle not found" };
          }

          targetItem = vehicle._id;
        }

        const update = VehicleService.updateVehicleQuota({
          vehicleId: targetItem,
          paymentTypeId: quotaType._id,
          numberOfQuotas: quota,
          session,
        });

        return update;
      });

      return res.status(200).json({
        success: true,
        message: "Quota updated successfully",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "There was a problem creating association",
        error: error?.message,
      });
    }
  }
);

// driver
route.post(
  "/driver",
  checkRole([
    RoleName.GeneralAdmin,
    RoleName.RegistrationAdmin,
    RoleName.VehicleRegistrationAdmin,
  ]),
  upload.single("image"),
  Drivers.registerDriver
);
route.get(
  "/drivers",
  checkRole([
    RoleName.Government,
    RoleName.GeneralAdmin,
    RoleName.VehicleAdmin,
    RoleName.RegistrationAdmin,
    RoleName.VehicleRegistrationAdmin,
    RoleName.SuperAdmin,
    RoleName.Association,
    RoleName.PrintingAdmin,
  ]),
  Drivers.getAllDrivers
);
route.get(
  "/drivers/:id",
  checkRole([
    RoleName.Government,
    RoleName.GeneralAdmin,
    RoleName.TransferAdmin,
    RoleName.VehicleAdmin,
    RoleName.RegistrationAdmin,
    RoleName.DriverRegistrationAdmin,
  ]),
  Drivers.getDriverById
);
route.get("/driver/qr/:id", Drivers.getByQRCode);
route.patch(
  "/drivers/:id",
  checkRole([
    RoleName.DriverUpdateAdmin,
    RoleName.GeneralAdmin,
    RoleName.UpdateAdmin,
    RoleName.RegistrationAdmin,
    RoleName.DriverRegistrationAdmin,
  ]),
  Drivers.updateDriver
);
route.delete("/drivers/:id", checkRole(), Drivers.deleteDriver);
route.post(
  "/driver/download/permit/:id",
  checkRole([RoleName.PrintingAdmin, RoleName.RegistrationAdmin, RoleName.GeneralAdmin]),
  Drivers.downloadPermit
);
route.post(
  "/driver/download/qr/:driverId",
  checkRole([RoleName.PrintingAdmin, RoleName.GeneralAdmin]),
  Drivers.downloadQrCode
);

// supervendor
route.post(
  "/supervendor",
  checkRole([RoleName.SuperVendorAdmin]),
  SuperVendor.create
);

route.post(
  "/supervendor/vendor/deposit-wallet/transfer/:vendorId",
  checkRole([RoleName.SuperVendor, RoleName.SuperVendorAdmin]),
  SuperVendor.transferVendorDepositBalance
);

route.get(
  "/supervendors",
  checkRole([RoleName.Government, RoleName.SuperVendorAdmin]),
  SuperVendor.getAll
);
route.get(
  "/supervendors/:superVendorId/vendors",
  checkRole([
    RoleName.SuperVendorAdmin,
    RoleName.SuperVendor,
    RoleName.Government,
  ]),
  SuperVendor.getVendors
);
route.get(
  "/supervendor/:id",
  checkRole([RoleName.SuperVendorAdmin]),
  SuperVendor.getOne
);
route.patch(
  "/supervendor/:id",
  checkRole([RoleName.SuperVendorAdmin]),
  SuperVendor.update
);
route.delete(
  "/supervendor/:id",
  checkRole([RoleName.SuperVendorAdmin]),
  SuperVendor.delete
);

// Vendors
route.post(
  "/vendor",
  checkRole([RoleName.SuperVendor, RoleName.VendorAdmin]),
  Vendors.create
);
route.get(
  "/vendors",
  checkRole([RoleName.Government, RoleName.SuperVendor]),
  Vendors.getAll
);
route.get(
  "/vendor/:id",
  checkRole([RoleName.VendorAdmin, RoleName.Government]),
  Vendors.getById
);
route.patch("/vendor/:id", checkRole([RoleName.VendorAdmin]), Vendors.update);
route.delete("/vendor/:id", checkRole([RoleName.VendorAdmin]), Vendors.delete);

// WALLETS
route.get("/wallets", checkRole(), WalletController.getAll);
route.get("/wallets/type/:type", WalletController.getByType);
route.get(
  "/wallet/transactions",
  checkRole([
    RoleName.Association,
    RoleName.Government,
    RoleName.WalletAdmin,
    RoleName.Vendor,
    RoleName.SuperVendor,
  ]),
  WalletController.transactionHistory
);
route.get(
  "/wallet/transactions/disbursement",
  WalletController.getDisbursementTransactionHistory
);
route.get(
  "/wallet/:walletId",
  checkRole([RoleName.WalletAdmin]),
  WalletController.getById
);
route.get(
  "/wallet/:userId",
  checkRole([RoleName.WalletAdmin]),
  WalletController.getByUserId
);
route.post(
  "/wallets/deposit/balance/reset",
  checkRole(),
  WalletController.resetAllDepositBalances
);
route.post(
  "/wallets/earnings/balance/reset/:walletId",
  checkRole(),
  WalletController.resetEarningWalletHeldBalances
);

// wallet funding
route.post(
  "/wallet/fund/vendor",
  checkRole([
    RoleName.SuperVendor,
    RoleName.WalletAdmin,
    RoleName.SuperVendorAdmin,
  ]),
  WalletController.fundVendorWallet
);

// monnify
route.get(
  "/monnify/banks",
  checkRole([
    RoleName.VehicleRegistrationAdmin,
    RoleName.SuperVendor,
    RoleName.SuperVendorAdmin,
  ]),
  async (_req: Request, res: Response) => {
    const banks = await MonnifySupportedBankModel.find({});

    return res.status(200).json({
      success: true,
      message: "Supported banks fetched successfully",
      data: banks,
    });
  }
);
// monnify webhooks
route.post("/webhook/funding", Webhooks.paymentReceived);
route.post("/webhook/disbursement", Webhooks.disbursementCompleted);
// Monnify > Strictly Super Admin
route.post(
  "/monnify/transfer/single/:walletId",
  checkRole(),
  Monnify.singleTransfer
);
route.post("/monnify/transfer/bulk", checkRole(), Monnify.bulkTransfer);
route.post(
  "/monnify/otp/single/validate",
  checkRole(),
  Monnify.authorizeSingleTransfer
);
route.post(
  "/monnify/otp/bulk/validate",
  checkRole(),
  Monnify.authorizeBulkTransfer
);
route.post("/monnify/otp/resend", checkRole(), Monnify.resendOtp);
route.post("/monnify/banks/update", MonnifyService.getAndUpdateSupportedBanks);

// invoice
// get all invoices from database
route.get(
  "/invoices",
  checkRole([
    RoleName.GeneralAdmin,
    RoleName.InvoiceAdmin,
    RoleName.VehicleAdmin,
    RoleName.RegistrationAdmin,
    RoleName.PrintingAdmin,
  ]),
  Invoices.getAll
);
route.patch(
  "/invoice/cancel/:invoiceId",
  checkRole([
    RoleName.GeneralAdmin,
    RoleName.InvoiceAdmin,
    RoleName.VehicleAdmin,
    RoleName.RegistrationAdmin,
    RoleName.PrintingAdmin,
  ]),
  Invoices.cancel
);

// generate new invoice via monnify api and save to database
route.post(
  "/invoice/create/:id",
  checkRole([
    RoleName.GeneralAdmin,
    RoleName.InvoiceAdmin,
    RoleName.VehicleAdmin,
    RoleName.PrintingAdmin,
    RoleName.RegistrationAdmin,
    RoleName.VehicleRegistrationAdmin,
  ]),
  Monnify.generateNewInvoice
);
// get the invoices via monnify api
route.get("/monnify/invoices", checkRole(), Monnify.getAllInvoices);

route.post("/lga/head", checkRole(), LGAHeads.create);
route.get("/lga/heads", checkRole([RoleName.Government]), LGAHeads.getAll);
route.get("/lga/head/:id", checkRole(), LGAHeads.getById);
route.patch("/lga/heads/:id", checkRole(), LGAHeads.update);
route.delete("/lga/heads/:id", checkRole(), LGAHeads.delete);

//lgas route
route.post("/lga", checkRole(), LGAs.create);
route.get(
  "/lgas",
  checkRole([
    RoleName.VehicleAdmin,
    RoleName.GeneralAdmin,
    RoleName.Government,
    RoleName.VehicleRegistrationAdmin,
    RoleName.DriverRegistrationAdmin,
    RoleName.DriverUpdateAdmin,
    RoleName.RegistrationAdmin,
  ]),
  LGAs.getAll
);
route.get(
  "/lga/:id",
  checkRole([RoleName.Government, RoleName.GeneralAdmin]),
  LGAs.getById
);
route.patch("/lga/:id", checkRole(), LGAs.update);
route.delete("/lga/:id", checkRole(), LGAs.delete);

//issuables
route.post("/issuable", checkRole(), Issuables.create);
route.get("/issuables", checkRole([RoleName.Government]), Issuables.getAll);
route.get("/issuable/:id", checkRole([RoleName.Government]), Issuables.getById);
route.patch("/issuables/:id", checkRole(), Issuables.update);
route.delete("/issuable/:id", checkRole(), Issuables.delete);

// payment types/payment fare
route.post("/payment-type", checkRole(), PaymentTypes.create);
route.get(
  "/payment-types",
  checkRole([
    RoleName.Government,
    RoleName.GeneralAdmin,
    RoleName.RegistrationAdmin,
  ]),
  PaymentTypes.getAll
);
route.patch("/payment-type/:id", checkRole(), PaymentTypes.update);
// route.delete("/payment-type/:id", PaymentTypes.delete);

// beneficiaries
route.post(
  "/beneficiary",
  checkRole(),
  BeneficiaryController.createBeneficiary
);
route.get(
  "/beneficiaries",
  checkRole([RoleName.Government]),
  BeneficiaryController.getAllBeneficiaries
);
// remove beneficiary from payment type
route.post(
  "/beneficiaries/remove/:id",
  checkRole(),
  BeneficiaryController.removeBeneficiaryFromPaymentType
);
route.delete(
  "/beneficiaries/:id",
  checkRole(),
  BeneficiaryController.deleteBeneficiary
);

// payment category
route.post("/payment-category", checkRole(), PaymentCategory.create);
route.get(
  "/payment-categories",
  checkRole([
    RoleName.Government,
    RoleName.GeneralAdmin,

    RoleName.RegistrationAdmin,
  ]),
  PaymentCategory.getAll
);

// association
route.post(
  "/association",
  checkRole([RoleName.AssociationAdmin]),
  Associations.create
);
route.get(
  "/associations",
  checkRole([
    RoleName.GeneralAdmin,
    RoleName.AssociationAdmin,
    RoleName.Government,
    RoleName.VehicleRegistrationAdmin,
    RoleName.DriverRegistrationAdmin,
    RoleName.RegistrationAdmin,
    RoleName.UpdateAdmin,
    RoleName.VehicleUpdateAdmin,
    RoleName.DriverUpdateAdmin,
  ]),
  Associations.getAllAssociations
);
route.get(
  "/associations/:id",
  checkRole([
    RoleName.AssociationAdmin,
    RoleName.GeneralAdmin,
    RoleName.Government,
    RoleName.VehicleRegistrationAdmin,
    RoleName.DriverRegistrationAdmin,
    RoleName.RegistrationAdmin,
    RoleName.UpdateAdmin,
    RoleName.VehicleUpdateAdmin,
    RoleName.DriverUpdateAdmin,
  ]),
  Associations.getById
);
route.patch(
  "/associations/:id",
  checkRole([RoleName.AssociationAdmin]),
  Associations.updateAssociation
);
route.delete("/association/:id", checkRole(), Associations.deleteAssociation);

// units
route.post("/unit", checkRole([RoleName.UnitAdmin]), Units.create);
route.get(
  "/units",
  checkRole([
    RoleName.GeneralAdmin,
    RoleName.UnitAdmin,
    RoleName.Government,
    RoleName.RegistrationAdmin,
    RoleName.VehicleRegistrationAdmin,
    RoleName.UpdateAdmin,
    RoleName.VehicleUpdateAdmin,
  ]),
  Units.getAll
);
route.patch("/units/:id", checkRole([RoleName.UnitAdmin]), Units.updateOne);
route.delete("/units/:id", checkRole(), Units.delete);

// sub-units
route.post("/sub-unit", checkRole([RoleName.UnitAdmin]), SubUnits.create);
route.get(
  "/sub-units",
  checkRole([
    RoleName.GeneralAdmin,
    RoleName.UnitAdmin,
    RoleName.Government,
    RoleName.RegistrationAdmin,
    RoleName.VehicleRegistrationAdmin,
    RoleName.UpdateAdmin,
    RoleName.VehicleUpdateAdmin,
  ]),
  SubUnits.getAll
);
route.patch(
  "/sub-units/:id",
  checkRole([RoleName.UnitAdmin]),
  SubUnits.updateOne
);
route.delete("/sub-units/:id", checkRole(), SubUnits.delete);

// stakeholders
// route.post("/stakeholder", Stakeholder.create);
// route.get("/stakeholder/:id", Stakeholder.getOne);
// route.get("/stakeholders", Stakeholder.getAll);
// route.patch("/stakeholder/:id", Stakeholder.updateOne);
// route.delete("/stakeholder/:id", Stakeholder.delete);

// tax
route.get(
  "/tax/history",
  checkRole([
    RoleName.SuperAdmin,
    RoleName.Vendor,
    RoleName.SuperVendor,
    RoleName.Association,
  ]),
  Tax.getAllTaxPaymentHistory
);
// tax payment
route.post(
  "/tax/vehicle/pay/:vehicleId",
  checkRole([RoleName.Vendor]),
  Tax.payTax
);
route.post(
  "/tax/vehicle/unregistered/pay/:chassisNumber",
  checkRole([RoleName.Vendor]),
  Tax.payUnregisteredTax
);
route.post("/tax/vehicle/waive", checkRole(), Tax.waiveTaxGeneral);
route.post(
  "/tax/vehicle/waive/:vehicleCode",
  checkRole(),
  Tax.waiveTaxForSingleVehicle
);
route.get("/tax/vehicle/waivelogs", checkRole(), Tax.getAllTaxWaiveLogs);

// transactions
route.get(
  "/vehicle/qr/transactions/:transactionId",
  Transactions.getTransactionByQRCode
);

// Analytics
// transactions analytics
route.get("/analytics", checkRole(), Analytics.Main);
route.get(
  "/analytics/super_vendor",
  checkRole([RoleName.SuperVendor]),
  Analytics.superVendor
);
route.get("/analytics/vendor", checkRole([RoleName.Vendor]), Analytics.vendor);
route.get(
  "/analytics/government",
  checkRole([RoleName.Government]),
  Analytics.government
);
route.get(
  "/analytics/association",
  checkRole([RoleName.Association]),
  Analytics.association
);
route.get(
  "/analytics/stakeholder",
  checkRole([RoleName.Stakeholder]),
  Analytics.stakeholder
);
// vehicle analytics
route.get(
  "/analytics/vehicle",
  checkRole([
    RoleName.Government,
    RoleName.GeneralAdmin,
    RoleName.RegistrationAdmin,
  ]),
  Analytics.vehicles
);
route.get(
  "/analytics/driver",
  checkRole([
    RoleName.Government,
    RoleName.GeneralAdmin,
    RoleName.RegistrationAdmin,
  ]),
  Analytics.drivers
)
route.get(
  "/analytics/invoice",
  checkRole([
    RoleName.GeneralAdmin,
    RoleName.PrintingAdmin,
    RoleName.RegistrationAdmin,
  ]),
  Analytics.invoices
);
route.get(
  "/analytics/download",
  checkRole([RoleName.GeneralAdmin, RoleName.PrintingAdmin]),
  Analytics.printAndDownloads
);

export default route;
