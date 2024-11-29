import mongoose, { ClientSession } from "mongoose";
import { IDownloadQuota, IVehicle, Vehicle } from "../models/Vehicle";
import { generateYearDateRange, hasExpired } from "../utils";
import { PaymentTypeEnum, VehicleStatusEnum } from "../types";
import moment from "moment";
import { PaymentTypeModel } from "../models/PaymentType";
import { VehicleOwner } from "../models/VehicleOwner";
import { VehicleStatusLog } from "../models/VehicleStatusLog";
import { withMongoTransaction } from "../utils/mongoTransaction";
import UnitModel from "../models/Unit";

interface UpdateVehicleQuotaParams {
  vehicleId: mongoose.Types.ObjectId | string;
  paymentTypeId: mongoose.Types.ObjectId | string;
  numberOfQuotas?: number;
  session?: mongoose.ClientSession;
}
export class VehicleService {
  static async licenceUpdate(vehicleId: string, session?: ClientSession) {
    if (!mongoose.isValidObjectId(vehicleId)) {
      throw new Error("Invalid vehicle ID");
    }

    try {
      const mongoSession = session ?? null;

      const existingVehicle: IVehicle | null = await Vehicle.findById(
        vehicleId
      ).session(mongoSession);

      if (!existingVehicle || existingVehicle === null) {
        throw {
          message: "Vehicle not found",
          status: 404,
        };
      }

      // verify the vehicle status is not BLACKLISTED
      const isVehicleBlacklisted = await VehicleService.isVehicleBlacklisted(
        vehicleId,
        mongoSession as any
      );

      if (isVehicleBlacklisted) {
        throw {
          message: "Vehicle is blacklisted and cannot be renewed",
          status: 400,
        };
      }

      const { license } = existingVehicle;

      if (!license) {
        throw {
          message: "Vehicle license not found",
          status: 404,
        };
      }

      if (!hasExpired(license.expiryDate)) {
        throw {
          message: "Vehicle license has not expired yet",
          status: 400,
        };
      }

      // Set the expiry date to the same date next year
      const currentDate = new Date();
      const newExpiryDate = new Date(currentDate);
      newExpiryDate.setFullYear(currentDate.getFullYear() + 1);

      // For license renewal > add 1 quota for certificate download
      const certificatePrintingPaymentType = await PaymentTypeModel.findOne(
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
          $set: {
            "license.expiryDate": newExpiryDate,
            downloadQuota: [
              {
                type: certificatePrintingPaymentType._id,
                quota: 1,
              },
            ],
          },
        },
        { new: true, runValidators: true, session: mongoSession }
      );

      return updatedVehicle;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  static async updateVehicleStatus(
    vehicleId: string,
    status: VehicleStatusEnum,
    updatedBy: mongoose.Types.ObjectId | string,
  ) {
    if (!mongoose.isValidObjectId(vehicleId)) {
      throw new Error("Invalid vehicle ID");
    }

    try {
      const result = await withMongoTransaction(async (session) => {

        const vehicle: IVehicle | null = await Vehicle.findById(vehicleId);
        
        if (!vehicle) {
          throw {
            message: "Vehicle not found",
            status: 404,
          };
        }

        if (vehicle.status === status) {
          throw {
            message: `Vehicle is already ${status.toLowerCase()}`,
            status: 400,
          };
        }

        // to handle cases for vehicles that the date set inactive is missing
        if (vehicle.status === VehicleStatusEnum.INACTIVE && !vehicle.dateSetInactive){
          throw {
            message: "Vehicle Date Set Inactive missing. Please contact support",
            status: 400,
          }
        }
  
        if (status === VehicleStatusEnum.INACTIVE) {
          // TODO: uncomment this if plan changes to vehicle can not be set to inactive without having to cear debts
          // commenting it out for now as NIGER requested it shouldn't work as such
          // Check if the vehicle has any unpaid tax
          // if (vehicle.taxPaidUntil && vehicle.taxPaidUntil < new Date()) {
          //   throw {
          //     message: "Cannot set vehicle to inactive. There is unpaid tax.",
          //     status: 400,
          //   };
          // }
          vehicle.dateSetInactive = moment().tz("Africa/Lagos").toDate();
        } else if (status === VehicleStatusEnum.ACTIVATED) {
          // If the vehicle was inactive, adjust the taxPaidUntil date
          if (vehicle.dateSetInactive && vehicle.taxPaidUntil) {
            const inactiveDays = moment()
              .tz("Africa/Lagos")
              .diff(moment(vehicle.dateSetInactive), "days");
            vehicle.taxPaidUntil = moment(vehicle.taxPaidUntil)
              .tz("Africa/Lagos")
              .add(inactiveDays, "days")
              .toDate();
          }
  
          // Clear the dateSetInactive as the vehicle is now active
          vehicle.dateSetInactive = undefined;
  
          // If the taxPaidUntil date is in the past, set it to today
          if (!vehicle.taxPaidUntil) {
            vehicle.taxPaidUntil = moment()
              .tz("Africa/Lagos")
              .startOf("day")
              .toDate();
          }
        }
  
        
        // Log the status change
        await VehicleService.logVehicleStatusChange(
          vehicleId,
          vehicle.status,
          status,
          vehicle.taxPaidUntil as Date,
          updatedBy as string,
          session
        );
        
        vehicle.status = status;
        await vehicle.save({ session });

        return vehicle;

      });




      return result;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  private static async logVehicleStatusChange(
    vehicleId: string,
    previousStatus: VehicleStatusEnum,
    newStatus: VehicleStatusEnum,
    taxPaidUntil: Date,
    updatedBy: string,
    session: ClientSession
  ) {
    const log = {
      vehicle: vehicleId,
      previousStatus,
      newStatus,
      taxPaidUntil,
      updatedBy,
    }

    await VehicleStatusLog.create([log], { session });
  }

  /**
   * Update the download quota for a vehicle
   * @param vehicleId The ID of the vehicle
   * @param paymentTypeId The ID of the payment type
   * @param numberOfQuotas The number of quotas to add or subtract
   * @param session The Mongoose session
   * @returns The updated vehicle
   * @throws Error if the vehicle is not found or if there is an error updating the vehicle
   */
  static async updateVehicleQuota({
    vehicleId,
    paymentTypeId,
    numberOfQuotas = 1,
    session,
  }: UpdateVehicleQuotaParams) {
    const mongoSession = session ?? null;

    if (!mongoose.isValidObjectId(vehicleId)) {
      throw new Error("Invalid vehicle ID");
    }

    if (!mongoose.isValidObjectId(paymentTypeId)) {
      throw new Error("Invalid payment type ID");
    }

    try {
      // Check if the quota entry already exists
      const vehicle = await Vehicle.findById(vehicleId).session(mongoSession);
      if (!vehicle) {
        throw new Error("Vehicle not found");
      }

      const quotaEntry = vehicle.downloadQuota.find(
        (entry: IDownloadQuota) =>
          entry.type.toString() === paymentTypeId.toString()
      );

      if (!quotaEntry) {
        // Add new quota entry if it doesn't exist
        await Vehicle.findByIdAndUpdate(
          vehicleId,
          {
            $addToSet: {
              downloadQuota: { type: paymentTypeId, quota: 0 },
            },
          },
          { new: true, session: mongoSession }
        );
      }

      // Increment or decrement the quota
      const updatedVehicle = await Vehicle.findByIdAndUpdate(
        vehicleId,
        {
          $inc: { "downloadQuota.$[elem].quota": numberOfQuotas },
        },
        {
          arrayFilters: [{ "elem.type": paymentTypeId }],
          new: true,
          runValidators: true,
          session: mongoSession,
        }
      );

      if (!updatedVehicle) {
        throw {
          code: 500,
          message: "Error updating vehicle quota",
        };
      }

      return updatedVehicle;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  /**
   * Get the total number of vehicles in the same unit as the specified vehicle
   * @param unitId The ID of the unit
   * @param session The Mongoose session
   * @returns The total number of vehicles in the same unit
   * @throws Error if the unit ID is invalid or if there is an error getting the total number of vehicles
   */

  static async getTotalNumberOfVehiclesInSameUnit(
    unitId: mongoose.Types.ObjectId | string,
    session?: ClientSession
  ) {
    if (!mongoose.isValidObjectId(unitId)) {
      throw new Error("Invalid unit ID");
    }

    try {
      const mongoSession = session ?? null;

      const totalVehiclesInSameUnit = await Vehicle.find({
        unit: unitId,
        identityCode: { $exists: true, $ne: null },
      })
        .countDocuments()
        .session(mongoSession);

      const unit = await UnitModel.findById(unitId).select("code").session(mongoSession);

      // for MAK unit code, its lagging by 1, so we add 1 to the total count
      if (unit?.code === "MAK") {
        return totalVehiclesInSameUnit + 6;
      }

      return totalVehiclesInSameUnit;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  /**
   * Check if a vehicle has download quota
   * @param vehicleId The ID of the vehicle
   * @param paymentTypeId The ID of the payment type
   * @param session The Mongoose session
   * @returns True if the vehicle has download quota, false otherwise
   * @throws Error if the vehicle is not found or if there is an error checking the download quota
   * @throws Error if the vehicle ID or payment type ID is invalid
   * @throws Error if there is an error checking the download quota
   */
  static async checkDownloadQuota(
    vehicleId: mongoose.Types.ObjectId | string,
    paymentTypeId: mongoose.Types.ObjectId | string,
    session?: ClientSession
  ) {
    if (!mongoose.isValidObjectId(vehicleId)) {
      throw new Error("Invalid vehicle ID");
    }

    if (!mongoose.isValidObjectId(paymentTypeId)) {
      throw new Error("Invalid payment type ID");
    }

    const mongoSession = session ?? null;

    try {
      const vehicle = await Vehicle.findById(vehicleId).session(mongoSession);

      const targetQuota = vehicle.downloadQuota.find(
        (quota: IDownloadQuota) =>
          quota.type.toString() === paymentTypeId.toString()
      );

      if (targetQuota && targetQuota.quota > 0) {
        return true;
      }

      return false;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  static async addVehicleToOwnersVehicleList(
    vehicleId: mongoose.Types.ObjectId | string,
    ownerId: mongoose.Types.ObjectId | string,
    session?: ClientSession
  ) {
    if (!mongoose.isValidObjectId(vehicleId)) {
      throw new Error("Invalid vehicle ID");
    }

    if (!mongoose.isValidObjectId(ownerId)) {
      throw new Error("Invalid owner ID");
    }

    try {
      const mongoSession = session ?? null;

      const updatedOwner = await VehicleOwner.findByIdAndUpdate(
        ownerId,
        {
          $addToSet: {
            vehicles: vehicleId,
          },
        },
        { new: true, session: mongoSession, runValidators: true }
      );

      if (!updatedOwner) {
        throw {
          code: 500,
          message: "Error updating vehicle owner",
        };
      }

      return updatedOwner;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // check for if vehicle status is BLACKLISTED
  static async isVehicleBlacklisted(
    vehicleId: mongoose.Types.ObjectId | string,
    session?: ClientSession
  ) {
    if (!mongoose.isValidObjectId(vehicleId)) {
      throw new Error("Invalid vehicle ID");
    }
    const mongoSession = session ?? null;
    try {
      const vehicle = await Vehicle.findById(vehicleId).session(mongoSession);

      if (!vehicle) {
        throw {
          message: "Vehicle not found",
          status: 404,
        };
      }

      if (vehicle.status === VehicleStatusEnum.BLACKLISTED) {
        return true;
      }

      return false;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }
}
