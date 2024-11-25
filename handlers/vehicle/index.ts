import { Request, Response } from "express";
import { Vehicle, IVehicle, IDownloadQuota } from "../../models/Vehicle";
import {
  VehicleStatusEnum,
  PaymentTypeEnum,
  RoleName,
  VehicleTypeEnum,
} from "../../types";
import { IVehicleOwner, VehicleOwner } from "../../models/VehicleOwner";
import { UserModel } from "../../models/User";
import mongoose, { isValidObjectId } from "mongoose";
import UnitModel from "../../models/Unit";
import { PaymentTypeModel } from "../../models/PaymentType";
import { withMongoTransaction } from "../../utils/mongoTransaction";
import { AssociationModel } from "../../models/Association";
import { VehicleService } from "../../services/vehicle.service";
import { UnregisteredVehicle } from "../../models/UnregisteredVehicle";
import {
  IInvoiceData,
  MonnifyService,
} from "../../services/monnify.wallet.service";
import { DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_PAGE } from "../../utils/constants";
import { DownloadHistoryModel } from "../../models/Transaction";
import {
  convertImageToBase64,
  generateIdentityCode,
  getDaysOwing,
  isOwingTax,
} from "../../utils";
import { uploadImage } from "../../services/googlecloud.service";
import { body, param, validationResult } from "express-validator";
import { BUCKET_STORAGE_LOCATION } from "../../utils/config";
import moment from 'moment-timezone';

interface IVehicleRequest extends IVehicle {
  ownerId: mongoose.Types.ObjectId | string;
}

export class Vehicles {
  static async registerNew(
    req: Request<{}, {}, IVehicleRequest>,
    res: Response
  ) {
    const userId = req.headers["userid"];

    const imageFile = req.file;

    const {
      // points to id of the paymentType model which contains the vehicle type and its taxes
      vehicleType,
      licensePlateNumber,
      chassisNumber,
      lga,
      association,
      unit,
      existingId,
      subUnit,
      owner,
    } = req.body;
    if (
      !vehicleType ||
      !licensePlateNumber ||
      !chassisNumber ||
      !lga ||
      !association ||
      !unit ||
      !existingId ||
      !subUnit ||
      !owner ||
      !imageFile
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const parsedOwnerData = JSON.parse(owner as any);

    let newVehicle: IVehicle[] | null = null as IVehicle[] | null;
    let vehicleOwner: IVehicleOwner | null = null;
    let isNewOwner = false;

    try {
      const result = await withMongoTransaction(async (session) => {
        const existingVehicle = await Vehicle.findOne({
          $or: [{ chassisNumber }, { licensePlateNumber }],
        }).session(session);

        if (existingVehicle) {
          throw {
            code: 400,
            message:
              "Vehicle with same Chassis or Licence Plate already registered",
          };
        }

        const ownerQuery: any = {};
        if (parsedOwnerData.email) ownerQuery.email = parsedOwnerData.email;
        if (parsedOwnerData.nin) ownerQuery.nin = parsedOwnerData.nin;
        if (parsedOwnerData.phoneNumber)
          ownerQuery.phoneNumber = parsedOwnerData.phoneNumber;

        console.log("ownerQuery", ownerQuery);

        const existingVehicleOwner = await VehicleOwner.findOne({
          $or: Object.keys(ownerQuery).map((key) => ({
            [key]: ownerQuery[key],
          })),
        }).session(session);

        // if owner exists, return error. There's a separate endpoint for registering vehicles with existing owners and as well that of transferring ownership
        if (existingVehicleOwner) {
          throw {
            code: 400,
            message: "Owner with same details already exists",
          };
        }

        // Register Vehicle Owner data if not existing
        if (!existingVehicleOwner) {
          const vehicleOwnerData = {
            ...parsedOwnerData,
            // we will add image after successful operations
            image: null,
            createdBy: userId,
          };

          // Create the new owner and store as an object
          vehicleOwner = (
            await VehicleOwner.create([vehicleOwnerData], {
              session,
            })
          )[0];

          if (!vehicleOwner) {
            throw {
              code: 500,
              message: "Error creating vehicle owner",
            };
          }
        }

        const existingAssociation = await AssociationModel.findById(
          association
        ).session(session);

        if (!existingAssociation) {
          throw {
            code: 404,
            message: "Association does not exist",
          };
        }

        const existingUnit = await UnitModel.findById(unit).session(session);

        if (!existingUnit) {
          throw {
            code: 404,
            message: "Unit does not exist",
          };
        }

        const selectedTaxType = await PaymentTypeModel.findById(
          vehicleType
        ).session(session);

        if (
          selectedTaxType?.name &&
          !Object.values(VehicleTypeEnum).includes(
            selectedTaxType.name as VehicleTypeEnum
          )
        ) {
          throw {
            code: 400,
            message: `Invalid Vehicle Type.`,
          };
        }

        if (!selectedTaxType) {
          throw {
            code: 404,
            message: "Tax type does not exist",
          };
        }

        // verify that unit type and selected vehicle type do match
        if (
          existingUnit?.taxType?.toString() !== selectedTaxType._id.toString()
        ) {
          throw {
            code: 400,
            message: "Unit and select Vehicle Tax Type do not match",
          };
        }

        const vehicleData = {
          vehicleType, // taxType,
          licensePlateNumber,
          chassisNumber,
          lga,
          association,
          unit,
          subUnit,
          existingId,
          owner: vehicleOwner?._id,
          status: VehicleStatusEnum.NOT_ACTIVATED,
          createdBy: userId,
        };

        newVehicle = await Vehicle.create([vehicleData], { session });

        if (!newVehicle) {
          throw {
            code: 500,
            message: "Error creating vehicle",
          };
        }

        const addVehicleToOwnersList = await VehicleOwner.findByIdAndUpdate(
          vehicleOwner?._id,
          {
            $push: {
              vehicles: newVehicle[0]._id,
            },
          },
          { new: true, runValidators: true, session }
        );

        if (!addVehicleToOwnersList) {
          throw {
            code: 500,
            message: "Failed to update Vehicle Owner",
          };
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
          customerEmail: (parsedOwnerData as IVehicleOwner).email,
          customerName: (parsedOwnerData as IVehicleOwner).fullName,
          metaData: {
            vehicleId: newVehicle[0]._id,
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
          vehicle: newVehicle[0],
          invoice: {
            amount: invoice[0]?.amount,
            bankName: invoice[0]?.bankName,
            accountName: invoice[0]?.accountName,
            accountNumber: invoice[0]?.accountNumber,
            expiryDate: invoice[0]?.expiryDate,
            invoiceReference: invoice[0]?.invoiceReference,
          },
        };
      });

      if (vehicleOwner) {
        try {
          const location = `${BUCKET_STORAGE_LOCATION.VEHICLE_OWNERS_IMAGE}/${
            (vehicleOwner as IVehicleOwner)?._id
          }`;
          const imageUrl = await uploadImage(imageFile, location);

          if (!imageUrl) {
            throw new Error("Error uploading vehicle owner's image");
          }

          // Update owner with image URL
          await VehicleOwner.findByIdAndUpdate(
            (vehicleOwner as IVehicleOwner)?._id,
            {
              image: imageUrl,
            }
          );
        } catch (error) {
          // Rollback vehicle creation if image upload fails
          await withMongoTransaction(async (session) => {
            await Vehicle.findByIdAndDelete(newVehicle?.[0]?._id).session(
              session
            );
            await MonnifyService.cancelInvoice(
              result?.invoice?.invoiceReference,
              session
            );
            // Delete the newly created owner only if they were just created in this transaction
            if (isNewOwner) {
              await VehicleOwner.findByIdAndDelete(
                (vehicleOwner as IVehicleOwner)?._id
              ),
                {
                  session,
                };
            } else {
              // undo add vehicle to owner's list
              await VehicleOwner.findByIdAndUpdate(
                (vehicleOwner as IVehicleOwner)?._id,
                {
                  $pull: {
                    vehicles: newVehicle?.[0]?._id,
                  },
                },
                { session }
              );
            }
          });

          throw {
            code: 500,
            message: "Image upload failed, rolling back changes",
          };
        }
      }

      return res.status(201).json({
        success: true,
        message: "Vehicle registered successfully",
        data: result,
      });
    } catch (error: any) {
      console.log("Error registering vehicle", error);

      if (error instanceof mongoose.Error.ValidationError) {
        return res.status(400).json({
          success: false,
          message: "Validation error",
          errors: error.errors,
        });
      }

      if (error.owner) {
        return res.status(error.code || 500).json({
          success: false,
          message: error.message || "Error registering vehicle",
          owner: error.owner,
        });
      }

      return res.status(error.code || 500).json({
        success: false,
        message: error.message || "Error registering vehicle",
        error: error?.message,
      });
    }
  }

  static async registerExistingOwner(
    req: Request<{}, {}, IVehicleRequest>,
    res: Response
  ) {
    const userId = req.headers["userid"];

    const {
      // points to id of the paymentType model which contains the vehicle type and its taxes
      vehicleType,
      licensePlateNumber,
      chassisNumber,
      lga,
      association,
      unit,
      existingId,
      subUnit,
      ownerId, // if owner already exists, simply pass the owner's ID and we have the data in db
    } = req.body;

    if (
      !vehicleType ||
      !licensePlateNumber ||
      !chassisNumber ||
      !lga ||
      !association ||
      !unit ||
      !subUnit ||
      !existingId
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (!ownerId || !isValidObjectId(ownerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid owner ID",
      });
    }

    let newVehicle: IVehicle[] | null = null as IVehicle[] | null;

    try {
      const result = await withMongoTransaction(async (session) => {
        const existingVehicle = await Vehicle.findOne({
          $or: [{ chassisNumber }, { licensePlateNumber }],
        }).session(session);

        if (existingVehicle) {
          throw {
            code: 400,
            message:
              "Vehicle with same Chassis or Licence Plate already registered",
          };
        }

        const vehicleOwner = await VehicleOwner.findById(ownerId).session(
          session
        );

        if (!vehicleOwner) {
          throw {
            code: 404,
            message: "Owner not found",
          };
        }

        const existingAssociation = await AssociationModel.findById(
          association
        ).session(session);

        if (!existingAssociation) {
          throw {
            code: 404,
            message: "Association does not exist",
          };
        }

        const existingUnit = await UnitModel.findById(unit).session(session);

        if (!existingUnit) {
          throw {
            code: 404,
            message: "Unit does not exist",
          };
        }

        const selectedTaxType = await PaymentTypeModel.findById(
          vehicleType
        ).session(session);

        if (
          selectedTaxType?.name &&
          !Object.values(VehicleTypeEnum).includes(
            selectedTaxType.name as VehicleTypeEnum
          )
        ) {
          throw {
            code: 400,
            message: `Invalid Vehicle Type.`,
          };
        }

        if (!selectedTaxType) {
          throw {
            code: 404,
            message: "Tax type does not exist",
          };
        }

        // confirm that unit type values are same as the selected tax type
        if (
          existingUnit?.taxType?.toString() !== selectedTaxType._id.toString()
        ) {
          throw {
            code: 400,
            message: "Unit and select Vehicle Tax Type do not match",
          };
        }

        const vehicleData = {
          existingId,
          vehicleType, // taxType,
          licensePlateNumber,
          chassisNumber,
          lga,
          association,
          unit,
          subUnit,
          owner: ownerId,
          status: VehicleStatusEnum.NOT_ACTIVATED,
          createdBy: userId,
        };

        newVehicle = await Vehicle.create([vehicleData], { session });

        if (!newVehicle) {
          throw {
            code: 500,
            message: "Error creating vehicle",
          };
        }

        const updateOwnerVehicleList =
          await VehicleService.addVehicleToOwnersVehicleList(
            newVehicle[0]._id as mongoose.Types.ObjectId,
            ownerId,
            session
          );

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
          customerEmail: vehicleOwner?.email,
          customerName: vehicleOwner?.fullName,
          metaData: {
            vehicleId: newVehicle[0]._id,
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
          vehicle: newVehicle[0],
          invoice: {
            amount: invoice[0]?.amount,
            bankName: invoice[0]?.bankName,
            accountName: invoice[0]?.accountName,
            accountNumber: invoice[0]?.accountNumber,
            expiryDate: invoice[0]?.expiryDate,
            invoiceReference: invoice[0]?.invoiceReference,
          },
        };
      });

      return res.status(201).json({
        success: true,
        message: "Vehicle registered successfully",
        data: result,
      });
    } catch (error: any) {
      console.log("Error registering vehicle", error);
      if (error instanceof mongoose.Error.ValidationError) {
        return res.status(400).json({
          success: false,
          message: "Validation error",
          errors: error.errors,
        });
      }

      if (error.owner) {
        return res.status(error.code || 500).json({
          success: false,
          message: error.message || "Error registering vehicle",
          owner: error.owner,
        });
      }

      return res.status(error.code || 500).json({
        success: false,
        message: error.message || "Error registering vehicle",
        error: error?.message,
      });
    }
  }

  static async transferOwnership(req: Request, res: Response) {
    const userId = req.headers["userid"] as string;
    const { vehicleId } = req.params;

    const imageFile = req.file;

    // const newOwnerData: IVehicleOwner = req.body;
    const {
      licensePlateNumber,
      chassisNumber,
      newOwnerData,
      newOwnerId, // if new owner already exists, simply pass the new owner's ID and we have the data in db
    }: {
      licensePlateNumber: string;
      chassisNumber: string;
      newOwnerData: IVehicleOwner;
      newOwnerId: mongoose.Types.ObjectId | string | null;
    } = req.body;

    if (!newOwnerData && !newOwnerId) {
      return res.status(400).json({
        success: false,
        message: "New owner details are required",
      });
    }

    if (!newOwnerId && !imageFile) {
      return res.status(400).json({
        success: false,
        message: "Image of the new owner is required",
      });
    }

    const parsedOwnerData = newOwnerData
      ? JSON.parse(newOwnerData as any)
      : null;

    let isUnregisteredOwner: boolean = false;

    // validate requests
    await param("vehicleId").notEmpty().isMongoId().run(req);
    await body("licensePlateNumber").optional().isString().run(req);
    await body("chassisNumber").optional().isString().run(req);
    await body("newOwnerId").optional().isMongoId().run(req);
    await body("newOwnerData").optional().isJSON().run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()?.[0]?.msg,
        errors: errors.array(),
      });
    }

    try {
      const result = await withMongoTransaction(async (session) => {
        const vehicle = (await Vehicle.findById(vehicleId).session(
          session
        )) as IVehicle;

        if (!vehicle) {
          throw {
            code: 404,
            message: "Vehicle not found",
          };
        }

        // ensure vehicle has VEHICLE_UPDATE_QUOTA
        const vehicleUpdateQuotaPaymentType = await PaymentTypeModel.findOne({
          name: PaymentTypeEnum.VEHICLE_UPDATE,
        }).session(session);

        if (!vehicleUpdateQuotaPaymentType) {
          throw {
            code: 404,
            message: "Vehicle Update Payment Type not found",
          };
        }

        const VEHICLE_UPDATE_QUOTA = vehicle.downloadQuota?.find(
          (quota) =>
            quota.type.toString() ===
            vehicleUpdateQuotaPaymentType._id.toString()
        );

        if (!VEHICLE_UPDATE_QUOTA) {
          throw {
            code: 400,
            message:
              "Vehicle does not have update quota. Kindly generate an Invoice and pay for update quota",
          };
        }

        // if license plate number and chassis number are to be changed, ensure they do not already exist
        let existingVehicle: IVehicle | null = null;
        if (licensePlateNumber || chassisNumber) {
          const query: any = {};
          if (licensePlateNumber) query.licensePlateNumber = licensePlateNumber;
          if (chassisNumber) query.chassisNumber = chassisNumber;

          existingVehicle = await Vehicle.findOne({
            $or: Object.keys(query).map((key) => ({
              [key]: query[key],
              _id: { $ne: vehicleId },
            })),
          }).session(session);
        }

        if (existingVehicle) {
          throw {
            code: 400,
            message:
              "Vehicle with same Chassis or Licence Plate already registered",
          };
        }

        let newVehicleOwnerId: mongoose.Types.ObjectId | string | null =
          newOwnerId;

          if (newOwnerId && !newOwnerData) {
          // verify the owner Id > check if the owner exists
          const existingOwner = await VehicleOwner.findById(newOwnerId).session(
            session
          );
          if (!existingOwner) {
            throw {
              code: 404,
              message: "Owner with supplied ID not found",
            };
          }
          isUnregisteredOwner = false;
        } else {
          // check if the owner with the new owner data exists
          const ownerQuery: any = {};
          if (parsedOwnerData.email) ownerQuery.email = parsedOwnerData.email;
          if (parsedOwnerData.nin) ownerQuery.nin = parsedOwnerData.nin;
          if (parsedOwnerData.phoneNumber)
            ownerQuery.phoneNumber = parsedOwnerData.phoneNumber;

          const existingOwner = await VehicleOwner.findOne({
            $or: Object.keys(ownerQuery).map((key) => ({
              [key]: ownerQuery[key],
            })),
          }).session(session);

          if (existingOwner) {
            throw {
              code: 400,
              message: "Owner with same details already exists",
            };
          }

          isUnregisteredOwner = true;

          // create the new owner if no data is found
          const ownerData = {
            ...parsedOwnerData,
            image: null, // we will add image after successful operations to avoid image upload then rollback
            createdBy: userId,
          };

          const newVehicleOwner = await VehicleOwner.create([ownerData], {
            session,
          });

          if (!newVehicleOwner) {
            throw {
              code: 500,
              message: "Error creating new owner",
            };
          }

          newVehicleOwnerId = newVehicleOwner[0]._id as mongoose.Types.ObjectId;
        }

        // if chassis number is changed, register a new vehicle, keep the old one as it is and only remove the vehicle identity code from the old vehicle
        // as the new vehicle will now have the old's identity code
        // keeping the old for audit purposes and to avoid any issues with the old vehicle's data (might get referenced in other places or try registering later)
        let targetVehicle: IVehicle | null = null;
        if (chassisNumber && vehicle.chassisNumber !== chassisNumber) {
          const originalIdentityCode = vehicle.identityCode;
          const originalLicensePlateNumber = vehicle.licensePlateNumber;
          const { _id, ...vehicleDataWithoutId } = vehicle.toObject();

          // remove identity code from old vehicle
          const updatedVehicle = await Vehicle.findByIdAndUpdate(
            vehicleId,
            {
              $unset: { 
                identityCode: "",
                existingId: "",
                ...(licensePlateNumber ? {} : { licensePlateNumber: "" }),
              }
            },
            { session, new: true }
          );


// Throw if update failed
if (updatedVehicle.identityCode) {
  throw new Error('Failed to remove identityCode from vehicle');
}
          // register a new vehicle
          const newVehicleData = {
            ...vehicleDataWithoutId,
            identityCode: originalIdentityCode,
            // If new licensePlate provided, use it
  // If no new licensePlate, use the original one
            licensePlateNumber: licensePlateNumber || originalLicensePlateNumber,
            chassisNumber,
            downloadQuota: [],
            owner: newVehicleOwnerId,
            createdBy: userId,
            _id: new mongoose.Types.ObjectId(),
          };

          if (!newVehicleData.owner) {
            throw {
              code: 400,
              message: "New Owner ID is required",
            };
          }

          const newVehicle = (
            await Vehicle.create([newVehicleData], {
              session,
            })
          )[0];

          if (!newVehicle) {
            throw {
              code: 500,
              message: "Error creating new vehicle",
            };
          }

          targetVehicle = newVehicle;

          // transfer vehicle to new owner
          const addVehicleToOwnersList = await VehicleOwner.findByIdAndUpdate(
            newVehicleOwnerId,
            {
              $push: {
                vehicles: newVehicle._id,
              },
            },
            { new: true, runValidators: true, session }
          );

          if (!addVehicleToOwnersList) {
            throw {
              code: 500,
              message: "Failed to update Vehicle Owner",
            };
          }


        } else {
          // update vehicle
          const updatedVehicle = await Vehicle.findByIdAndUpdate(
            vehicleId,
            {
              licensePlateNumber:
                licensePlateNumber || vehicle.licensePlateNumber,
              owner: newVehicleOwnerId,
            },
            { new: true, runValidators: true, session }
          );

          if (!updatedVehicle) {
            throw {
              code: 500,
              message: "Failed to update Vehicle",
            };
          }

          targetVehicle = updatedVehicle;

          // remove vehicle from old owner's list
          const removeVehicleFromOwnersList =
            await VehicleOwner.findByIdAndUpdate(
              vehicle.owner,
              {
                $pull: {
                  vehicles: vehicle?._id,
                },
              },
              { new: true, runValidators: true, session }
            );

          if (!removeVehicleFromOwnersList) {
            throw {
              code: 500,
              message: "Failed to update Vehicle Owner",
            };
          }

          // transfer vehicle to new owner
          const addVehicleToOwnersList = await VehicleOwner.findByIdAndUpdate(
            newVehicleOwnerId,
            {
              $push: {
                vehicles: vehicle?._id,
              },
            },
            { new: true, runValidators: true, session }
          );

          if (!addVehicleToOwnersList) {
            throw {
              code: 500,
              message: "Failed to update Vehicle Owner",
            };
          }

        }

        // process the image upload if new owner is unregistered
        try {
          // update the vehicle's update quota
          const updateQuota = await VehicleService.updateVehicleQuota({
            vehicleId: vehicleId,
            paymentTypeId: vehicleUpdateQuotaPaymentType._id,
            numberOfQuotas: -1,
            session,
          });

          if (!updateQuota) {
            throw {
              code: 500,
              message: "Failed to update Vehicle's update quota",
            };
          }

          if (isUnregisteredOwner && imageFile) {
            const location = `${BUCKET_STORAGE_LOCATION.VEHICLE_OWNERS_IMAGE}/${newVehicleOwnerId}`;
            const imageUrl = await uploadImage(
              imageFile,
              location
            );
            // Update owner with image URL
            const imageUpdate = await VehicleOwner.findByIdAndUpdate(
              newVehicleOwnerId,
              {
                image: imageUrl,
              },
              {
                new: true,
                runValidators: true,
                session,
              }
            );

            if (!imageUpdate) {
              throw {
                code: 500,
                message: "Failed to update Vehicle Owner image",
              };
            }
          }
        } catch (error) {
          // Rollback vehicle update if image upload fails
          await withMongoTransaction(async (session) => {
            await Vehicle.findByIdAndUpdate(vehicleId, {
              owner: vehicle.owner,
              licensePlateNumber: vehicle.licensePlateNumber,
            }).session(session);

            // Delete the newly created owner only if they were just created in this transaction
            if (newOwnerId) {
              await VehicleOwner.findByIdAndDelete(newVehicleOwnerId),
                {
                  session,
                };

              // undo add vehicle to owner's list
              await VehicleOwner.findByIdAndUpdate(
                newVehicleOwnerId,
                {
                  $pull: {
                    vehicles: vehicle?._id,
                  },
                },
                { session }
              );
            }
          });

          throw {
            code: 500,
            message: "Image upload failed, rolling back changes",
          };
        }

        return targetVehicle;
      });

      return res.status(200).json({
        success: true,
        message: "Vehicle Owner Transfer Successful",
        data: result,
      });
    } catch (error: any) {
      console.log("Error transferring vehicle ownership", error);
      return res.status(500).json({
        success: false,
        message: "Error transferring vehicle ownership",
        error: error.message,
      });
    }
  }

  static async getById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const vehicle = await Vehicle.findById(id)
        .populate("owner")
        .populate("association");

      if (!vehicle) {
        return res
          .status(404)
          .json({ success: false, message: "Vehicle not found" });
      }

      return res.status(200).json({
        success: true,
        message: "Vehicle data fetched successfully",
        data: vehicle,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving vehicle",
        error: error.message,
      });
    }
  }

  static async getAll(req: Request, res: Response) {
    const page = parseInt(req.query.page as string) || DEFAULT_QUERY_PAGE;
    const limit = parseInt(req.query.limit as string) || DEFAULT_QUERY_LIMIT;
    const skip = Number((page - 1) * limit);

    const userId = req.headers["userid"] as string;

    // Filters
    const identityCode = req.query.identityCode
      ? req.query.identityCode.toString()
      : "";
    const licensePlateNumber = req.query.licensePlateNumber
      ? req.query.licensePlateNumber.toString()
      : "";
    const vehicleOwner = req.query.vehicleOwner
      ? req.query.vehicleOwner.toString()
      : "";
    const chassisNo = req.query.chassisNo ? req.query.chassisNo.toString() : "";
    const status = req.query.status ? req.query.status.toString() : "";

    try {
      const result = await withMongoTransaction(async (session) => {
        const query: any = {};
        // Add filtering conditions
        if (identityCode) {
          query.identityCode = new RegExp(`^${req.query.identityCode}$`, "i");
        }
        if (licensePlateNumber) {
          query.licensePlateNumber = {
            $regex: `^${licensePlateNumber}$`,
            $options: "i",
          };
        }
        if (chassisNo) {
          query.chassisNumber = {
            $regex: `^${chassisNo}$`,
            $options: "i",
          };
        }
        if (vehicleOwner) {
          query["owner.fullName"] = {
            $regex: `^${vehicleOwner}$`,
            $options: "i",
          };
        }
        if (status) {
          query.status = status;
        }

        let vehicles: IVehicle[] = [];
        let totalVehicles: number = 0;

        const user = await UserModel.findById(userId).session(session);

        if (user.role === RoleName.Association) {
          const association = await AssociationModel.findOne({
            userId: userId,
          }).session(session);

          if (!association) {
            throw {
              code: 404,
              message: "Association not found",
            };
          }

          // Fetch only vehicles associated with the association
          const vehicleIds = await Vehicle.find({
            association: association._id,
          })
            .distinct("_id")
            .session(session);
          query._id = { $in: vehicleIds };

          vehicles = (await Vehicle.find(query)
            .populate("lga")
            .populate({
              path: "association",
              select: "-wallet -phoneNumber -userId",
            })
            .populate({
              path: "owner",
              select: "-vehicles",
            })
            .populate({
              path: "vehicleType",
              select: "-beneficiaries",
            })
            .populate({
              path: "unit",
              select: "name code",
            })
            .populate({
              path: "subUnit",
              select: "name",
            })
            .populate({
              path: "createdBy",
              select: "-password -isDefaultPassword",
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean()
            .session(session)) as IVehicle[];

          totalVehicles = await Vehicle.countDocuments(query).session(session);
        } else {
          vehicles = (await Vehicle.find(query)
            .populate("lga")
            .populate({
              path: "association",
              select: "-wallet -phoneNumber -userId",
            })
            .populate({
              path: "owner",
              select: "-vehicles",
            })
            .populate({
              path: "vehicleType",
              select: "-beneficiaries",
            })
            .populate({
              path: "unit",
              select: "name code",
            })
            .populate({
              path: "subUnit",
              select: "name",
            })
            .populate({
              path: "downloadQuota.type",
              select: "name",
            })
            .populate({
              path: "createdBy",
              select: "-password -isDefaultPassword",
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean()
            .session(session)) as IVehicle[];

          // vehicle owner image is a url, convert it to base64 before sending to the client
          // to avoid CORS issues rendering images via SVG
          async function processVehicles(vehicles: any[]): Promise<any[]> {
            return Promise.all(
              vehicles.map(async (vehicle) => {
                if ((vehicle.owner as IVehicleOwner)?.image) {
                  const imageUrl = (vehicle.owner as IVehicleOwner).image;
                  try {
                    const base64Image = await convertImageToBase64(imageUrl);
                    (vehicle.owner as IVehicleOwner).image = base64Image;
                  } catch (error) {
                    console.error(
                      `Failed to convert image for vehicle ${vehicle.id}:`,
                      error
                    );
                  }
                }
                return vehicle;
              })
            );
          }
          vehicles = await processVehicles(vehicles);

          totalVehicles = await Vehicle.countDocuments(query).session(session);
        }

        return {
          vehicles,
          totalVehicles,
          page,
          limit,
          totalPages: Math.ceil(totalVehicles / limit),
        };
      });

      return res.status(200).json({
        success: true,
        message: "Vehicles list fetched successfully",
        total: result.totalVehicles,
        data: result.vehicles,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } catch (error: any) {
      console.log("Error retrieving vehicles", error);
      return res.status(500).json({
        success: false,
        message: "Error retrieving vehicles",
        error: error.message,
      });
    }
  }

  // update vehicle status
  static async updateVehicleStatus(req: Request, res: Response) {
    const { vehicleId } = req.params;
    const { status } = req.body;

    if (!vehicleId) {
      return res
        .status(400)
        .json({ success: false, message: "Vehicle ID is required" });
    }

    if (!status || !Object.values(VehicleStatusEnum).includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or missing status" });
    }

    try {
      const updatedVehicle = await VehicleService.updateVehicleStatus(
        vehicleId,
        status
      );

      return res.status(200).json({
        success: true,
        message: `Vehicle status updated to ${status.toLowerCase()}`,
        data: {
          id: updatedVehicle._id,
          status: updatedVehicle.status,
          taxPaidUntil: updatedVehicle.taxPaidUntil,
          dateSetInactive: updatedVehicle.dateSetInactive,
        },
      });
    } catch (error: any) {
      const statusCode = error.status || 500;
      const errorMessage =
        error.message || "An error occurred while updating vehicle status";

      return res.status(statusCode).json({
        success: false,
        message: errorMessage,
      });
    }
  }

  //   get by filters
  static async getVehiclesByFilters(req: Request, res: Response) {
    const userId = req.headers["userid"] as string;

    const user = await UserModel.findById(userId);

    try {
      // Extract filters from query parameters
      const {
        identityCode,
        status,
        vehicleType,
        ownerId,
        licensePlateNumber,
        chassisNumber,
        associationId,
        ...ownerFilters
      } = req.query;

      // Construct filter object based on provided filters
      const filters: Partial<IVehicle> = {};

      if (identityCode) {
        filters.identityCode = (identityCode as string).toUpperCase();
      }
      if (licensePlateNumber) {
        filters.licensePlateNumber = licensePlateNumber as string;
      }
      if (chassisNumber) {
        filters.chassisNumber = chassisNumber as string;
      }
      if (status) {
        filters.status = status as VehicleStatusEnum;
      }
      // if (vehicleType) {
      //   filters.vehicleType = vehicleType as VehicleType;
      // }
      if (associationId) {
        filters.association = new mongoose.Types.ObjectId(
          associationId as string
        );
      }

      let vehicles: IVehicle[] = [];

      if (user?.role === RoleName.Vendor) {
        vehicles = await Vehicle.find(filters as any)
          .select("-downloadQuota -license")
          .populate({
            path: "owner",
            select: "fullName",
          })
          .populate({
            path: "vehicleType",
            select: "name amount",
          })
          .populate({
            path: "unit",
            select: "name code",
          })
          .populate({
            path: "association",
            select: "name code",
          });
      } else {
        // Find vehicles based on the constructed filters
        vehicles = await Vehicle.find(filters as any)
          .populate("owner")
          .populate({
            path: "vehicleType",
            select: "name amount",
          })
          .populate({
            path: "unit",
            select: "name code",
          })
          .populate({
            path: "association",
            select: "name code",
          });
      }

      if (vehicles.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No vehicle found",
        });
      }

      vehicles = vehicles.map((vehicle) => {
        const startOfToday = moment().startOf('day').toDate();
        let { taxPaidUntil, dateSetInactive } = vehicle;
        
        // If the vehicle was inactive, adjust the taxPaidUntil date
        if (dateSetInactive && taxPaidUntil) {
          const inactiveDays = moment().diff(moment(dateSetInactive), 'days');
          taxPaidUntil = moment(taxPaidUntil).add(inactiveDays, 'days').toDate();
        }
        
        const daysOwing = taxPaidUntil && taxPaidUntil < startOfToday
          ? Math.ceil(moment(startOfToday).diff(moment(taxPaidUntil), 'days', true))
          : 0;
        const hasPaidForToday = taxPaidUntil && taxPaidUntil >= startOfToday;
    
        return {
          ...vehicle.toObject(),
          daysOwing,
          hasPaidForToday,
        };
      });

      return res.status(200).json({
        success: true,
        message: "Vehicles fetched successfully",
        data: vehicles,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching vehicles",
        error: error.message,
      });
    }
  }

  static async updateVehicle(req: Request, res: Response) {
    const { id } = req.params;
    const updateData: Partial<IVehicle> = req.body;

    const { vehicleType, licensePlateNumber, chassisNumber, lga, owner } =
      updateData;

    const formattedData = {
      vehicleType,
      licensePlateNumber,
      chassisNumber,
      lga,
      owner,
    };

    // field validation
    const validateVehicleData = [
      body("licensePlateNumber")
        .optional()
        .isAlphanumeric()
        .withMessage(
          "License Plate Number must contain only alphabets and numbers"
        ),
      body("chassisNumber")
        .optional()
        .isAlphanumeric()
        .withMessage("Chassis Number must contain only alphabets and numbers"),
    ];
    // Run validation
    await Promise.all(
      validateVehicleData.map((validation) => validation.run(req))
    );

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors?.array()?.[0]?.msg,
        errors: errors.array(),
      });
    }

    try {
      const result = await withMongoTransaction(async (session) => {
        // get the payment type associated with this action
        const PAYMENT_TYPE = await PaymentTypeModel.findOne({
          name: PaymentTypeEnum.VEHICLE_UPDATE,
        }).session(session);

        if (!PAYMENT_TYPE) {
          throw {
            code: 404,
            message: "Payment Type does not exist",
          };
        }

        // verify if vehicle has quota for this action
        const quotaAvailable = await VehicleService.checkDownloadQuota(
          id,
          PAYMENT_TYPE._id,
          session
        );

        if (!quotaAvailable) {
          throw {
            code: 400,
            message: "Insufficient quota to perform this action",
          };
        }

        let data: Partial<IVehicle>;

        const targetVehicle = await Vehicle.findById(id).session(session);

        if (!targetVehicle) {
          throw {
            code: 404,
            message: "Vehicle not found",
          };
        }

        // check that vehicle is not BLACKLISTED
        const isVehicleBlacklisted = await VehicleService.isVehicleBlacklisted(
          targetVehicle?._id,
          session
        );

        if (isVehicleBlacklisted) {
          throw {
            code: 400,
            message: "Vehicle is blacklisted and cannot be updated",
          };
        }

        // Ensure no other vehicle has the same license plate number or chassis number
        const query: any = { _id: { $ne: id } };
        if (licensePlateNumber) {
          query.licensePlateNumber = licensePlateNumber;
        }
        if (chassisNumber) {
          query.chassisNumber = chassisNumber;
        }

        const existingVehicle = await Vehicle.findOne({
          $or: [
            { licensePlateNumber: query.licensePlateNumber },
            { chassisNumber: query.chassisNumber },
          ],
          _id: query._id,
        }).session(session);

        if (existingVehicle) {
          throw {
            code: 400,
            message:
              "Vehicle with same Chassis or Licence Plate already registered. To do a Transfer of Ownership, please use the Transfer Ownership page",
          };
        }

        const targetVehicleAssociation = await AssociationModel.findById(
          targetVehicle.association
        ).session(session);

        if (!targetVehicleAssociation) {
          throw {
            code: 400,
            message: "Invalid Association in Vehicle data",
          };
        }

        let EXISTING_VEHICLE_TYPE = targetVehicle.vehicleType;

        // validate vehicle type
        if (vehicleType) {
          const existingVehicleType = await PaymentTypeModel.findById(
            vehicleType
          ).session(session);

          if (!existingVehicleType) {
            throw {
              code: 404,
              message: "Vehicle Type does not exist",
            };
          }

          EXISTING_VEHICLE_TYPE = existingVehicleType._id;
        }
        let SELECTED_ASSOCIATION_TYPE = targetVehicleAssociation.type;

        const targetVehicleUnit = await UnitModel.findById(
          targetVehicle.unit
        ).session(session);

        if (!targetVehicleUnit) {
          throw {
            code: 400,
            message: "Invalid Unit in Vehicle data",
          };
        }

        let SELECTED_UNIT_TYPE = targetVehicleUnit.taxType;

        // generate new identity code if unit is changed
        const currentUnit = new mongoose.Types.ObjectId(targetVehicle.unit);

        data = formattedData;

        // Validate/Check for existing owner and update if owner data is provided
        if (owner) {
          if (owner instanceof mongoose.Types.ObjectId) {
            // Owner is an ObjectId
            data.owner = owner;
          } else {
            const existingOwner = await VehicleOwner.findById(
              targetVehicle.owner
            ).session(session);

            if (!existingOwner) {
              throw {
                code: 404,
                message: "Vehicle Owner does not exist",
              };
            }

            const checkDuplicateEmail = owner.email
              ? await VehicleOwner.findOne({
                  email: owner.email,
                  _id: { $ne: existingOwner._id },
                }).session(session)
              : null;

            if (checkDuplicateEmail) {
              throw {
                code: 400,
                message: "Vehicle Owner with same Email already registered",
              };
            }

            const checkDuplicateNIN = owner.nin
              ? await VehicleOwner.findOne({
                  nin: owner.nin,
                  _id: { $ne: existingOwner._id },
                }).session(session)
              : null;

            if (checkDuplicateNIN) {
              throw {
                code: 400,
                message:
                  "Vehicle Owner with same NIN already registered. Use the Transfer Ownership page if this is a vehicle transfer",
              };
            }

            const checkDuplicatePhone = owner.phoneNumber
              ? await VehicleOwner.findOne({
                  phoneNumber: owner.phoneNumber,
                  _id: { $ne: existingOwner._id },
                }).session(session)
              : null;

            if (checkDuplicatePhone) {
              throw {
                code: 400,
                message:
                  "Vehicle Owner with same Phone Number already registered. Use the Transfer Ownership page if this is a vehicle transfer",
              };
            }

            const updatedOwner = await VehicleOwner.findByIdAndUpdate(
              existingOwner._id,
              { $set: owner },
              { new: true, runValidators: true, session }
            );

            if (!updatedOwner) {
              throw {
                code: 500,
                message: "Error updating vehicle owner",
              };
            }
            data = {
              ...data,
              owner,
            };
          }
        }

        const updatedVehicle = await Vehicle.findByIdAndUpdate(
          id,
          { ...data, owner: targetVehicle?.owner },
          {
            new: true,
            runValidators: true,
            session,
          }
        );

        if (!updatedVehicle) {
          throw {
            code: 500,
            message: "Error updating vehicle",
          };
        }

        // decrement the update quota after updating the vehicle

        if (!PAYMENT_TYPE) {
          throw {
            code: 404,
            message: "Vehicle Update Payment Type does not exist",
          };
        }

        const updateQuota = await VehicleService.updateVehicleQuota({
          vehicleId: id,
          paymentTypeId: PAYMENT_TYPE._id,
          numberOfQuotas: -1,
          session,
        });

        return data;
      });

      return res.status(200).json({
        success: true,
        message: "Vehicle updated successfully",
        data: result,
      });
    } catch (error: any) {
      console.error("Error updating vehicle:", error);
      return res.status(error.code || 500).json({
        success: false,
        message: error.message || "Error updating vehicle",
      });
    }
  }

  static async deleteVehicle(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const vehicle = await Vehicle.findByIdAndDelete(id);

      if (!vehicle) {
        return res
          .status(404)
          .json({ success: false, message: "Vehicle not found" });
      }

      return res
        .status(200)
        .json({ success: true, message: "Vehicle deleted successfully" });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error deleting vehicle",
        error: error.message,
      });
    }
  }

  static async renewLicense(req: Request, res: Response) {
    const { id } = req.params;
    try {
      const updatedVehicle = await VehicleService.licenceUpdate(id);

      if (!updatedVehicle) {
        return res.status(404).json({
          success: false,
          message: "Vehicle not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Vehicle license renewed successfully",
        data: updatedVehicle,
      });
    } catch (error: any) {
      console.log("Error renewing vehicle license", error);
      return res.status(500).json({
        success: false,
        message: "Error renewing vehicle license",
        error: error.message,
      });
    }
  }

  static async updateOwner(req: Request, res: Response) {
    const userId = req.headers["userid"];
    const { id } = req.params;
    const updateData: IVehicleOwner = req.body;

    try {
      const result = await withMongoTransaction(async (session) => {
        const existingVehicle = await Vehicle.findById(id).session(session);

        if (!existingVehicle) {
          throw {
            code: 404,
            message: "Vehicle Not Found",
          };
        }

        // verify vehicle status not blacklisted
        const isVehicleBlacklisted = await VehicleService.isVehicleBlacklisted(
          existingVehicle._id,
          session
        );

        if (isVehicleBlacklisted) {
          throw {
            code: 400,
            message: "Vehicle is blacklisted and cannot be updated",
          };
        }

        const existingOwner = await VehicleOwner.findOne({
          $or: [{ email: updateData.email }, { nin: updateData.nin }],
        }).session(session);

        if (existingOwner) {
          throw {
            code: 400,
            message:
              "Vehicle Owner with this Email, NIN or Phone already registered",
          };
        }

        if (existingVehicle.owner) {
          await VehicleOwner.findByIdAndUpdate(
            existingVehicle.owner,
            { $pull: { vehicles: id } },
            { session }
          );
        }

        const vehicleOwnerData = {
          ...updateData,
          vehicles: [id], // Add the vehicle to the new owner's vehicles array
          createdBy: userId,
        };

        const newVehicleOwner = await VehicleOwner.create([vehicleOwnerData], {
          session,
        });

        if (!newVehicleOwner) {
          throw {
            code: 500,
            message: "Error creating vehicle new vehicle owner",
          };
        }

        const updatedVehicle = await Vehicle.findByIdAndUpdate(
          id,
          { owner: newVehicleOwner[0]._id },
          { new: true, runValidators: true, session }
        );

        if (!updatedVehicle) {
          throw {
            code: 500,
            message: "Error updating vehicle owner",
          };
        }

        return updatedVehicle;
      });

      return res.status(200).json({
        success: true,
        message: "Vehicle Owner Update Successfully",
        data: result,
      });
    } catch (error: any) {
      console.log("Error updating vehicle owner", error);
      return res.status(500).json({
        success: false,
        message:
          "Internal Server Err: There was a problem updating vehicle owner",
        error: error?.message,
      });
    }
  }

  static async printCertificate(req: Request, res: Response) {
    const { vehicleId } = req.params;
    const { type } = req.body;

    if (!type || type === "" || type !== PaymentTypeEnum.CERTIFICATE_PRINTING) {
      return res.status(400).json({
        success: false,
        message: "Invalid invoice type",
      });
    }

    if (!isValidObjectId(vehicleId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid vehicle id",
      });
    }

    try {
      const result = await withMongoTransaction(async (session) => {
        const userId = req.headers["userid"];

        const vehicle = await Vehicle.findById(vehicleId).session(session);
        if (!vehicle) {
          throw {
            code: 404,
            message: "Vehicle not found",
          };
        }

        const invoiceType = await PaymentTypeModel.findOne({
          name: PaymentTypeEnum.CERTIFICATE_PRINTING,
        }).session(session);

        if (!invoiceType) {
          throw {
            code: 404,
            message: "Invoice type does not exist",
          };
        }

        const targetQuota = vehicle.downloadQuota.find(
          (quota: IDownloadQuota) =>
            quota.type.toString() === invoiceType._id.toString()
        );

        if (!targetQuota || targetQuota.quota < 1) {
          throw {
            code: 400,
            message: "No available quota for certificate printing",
          };
        }

        const updatedVehicle = await Vehicle.findOneAndUpdate(
          {
            _id: vehicleId,
            "downloadQuota.type": invoiceType._id,
          },
          { $inc: { "downloadQuota.$.quota": -1 } },
          { new: true, runValidators: true, session }
        );

        if (!updatedVehicle) {
          throw {
            code: 500,
            message: "Failed to update download quota",
          };
        }

        const downloadHistoryData = {
          vehicle: vehicleId,
          type: invoiceType._id,
          processedBy: userId,
        };

        const downloadHistory = await DownloadHistoryModel.create(
          [downloadHistoryData],
          { session }
        );

        return updatedVehicle;
      });

      return res.status(200).json({
        success: true,
        message: "Certificate printed successfully",
        data: result,
      });
    } catch (error: any) {
      console.log("Error printing certificate", error);
      return res.status(500).json({
        success: false,
        message: "Error printing certificate",
        error:
          error.message ||
          "Internal Server Error: Error updating certificate download quota",
      });
    }
  }

  static async downloadQrCode(req: Request, res: Response) {
    const { vehicleId } = req.params;

    const { type } = req.body;

    await body("type")
      .notEmpty()
      .withMessage("Invoice type is required")
      .equals(PaymentTypeEnum.VEHICLE_QR_CODE_PRINTING)
      .withMessage("Invalid invoice type")
      .run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg,
        errors: errors.array(),
      });
    }

    if (!isValidObjectId(vehicleId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid vehicle id",
      });
    }

    try {
      const result = await withMongoTransaction(async (session) => {
        const userId = req.headers["userid"];

        const vehicle = await Vehicle.findById(vehicleId).session(session);
        if (!vehicle) {
          throw {
            code: 404,
            message: "Vehicle not found",
          };
        }

        const invoiceType = await PaymentTypeModel.findOne({
          name: type as PaymentTypeEnum,
        }).session(session);

        if (!invoiceType) {
          throw {
            code: 404,
            message: "Invoice type does not exist",
          };
        }

        const targetQuota = vehicle.downloadQuota.find(
          (quota: IDownloadQuota) =>
            quota.type.toString() === invoiceType._id.toString()
        );

        if (!targetQuota || targetQuota.quota < 1) {
          throw {
            code: 400,
            message: "No available quota for QR code download",
          };
        }

        const updatedVehicle = await Vehicle.findOneAndUpdate(
          {
            _id: vehicleId,
            "downloadQuota.type": invoiceType._id,
          },
          { $inc: { "downloadQuota.$.quota": -1 } },
          { new: true, runValidators: true, session }
        );

        if (!updatedVehicle) {
          throw {
            code: 500,
            message: "Failed to update download quota",
          };
        }

        const downloadHistoryData = {
          vehicle: vehicleId,
          type: invoiceType._id,
          processedBy: userId,
        };

        const downloadHistory = await DownloadHistoryModel.create(
          [downloadHistoryData],
          { session }
        );

        return updatedVehicle;
      });

      return res.status(200).json({
        success: true,
        message: "QR code downloaded successfully",
        data: result,
      });
    } catch (error: any) {
      console.log("Error downloading QR code", error);
      return res.status(500).json({
        success: false,
        message: "Error downloading QR code",
        error:
          error.message ||
          "Internal Server Error: Error updating QR code download quota",
      });
    }
  }

  static async getDataByQRCode(req: Request, res: Response) {
    const { vehicleId } = req.params;

    body("vehicleId")
      .notEmpty()
      .withMessage("Vehicle ID is required")
      .isString()
      .withMessage("Invalid Vehicle ID")
      .run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg,
        errors: errors.array(),
      });
    }

    try {
      let vehicle;

      if (!isValidObjectId(vehicleId)) {
        vehicle = await Vehicle.findOne({ qrCodeId: vehicleId })
          .populate({
            path: "owner",
            select: "phoneNumber",
          })
          .populate({
            path: "unit",
            select: "name code",
          })
          .populate({
            path: "vehicleType",
            select: "name",
          });
      } else {
        vehicle = await Vehicle.findById(vehicleId)
          .populate({
            path: "owner",
            select: "phoneNumber",
          })
          .populate({
            path: "unit",
            select: "name code",
          })
          .populate({
            path: "vehicleType",
            select: "name",
          });
      }
      

      if (!vehicle) {
        return res.status(404).json({
          success: false,
          message: "Vehicle not found",
        });
      }

      const IS_OWING = isOwingTax(vehicle?.taxPaidUntil);
      const DAYS_OWING = getDaysOwing(vehicle?.taxPaidUntil, vehicle?.dateSetInactive);

      return res.status(200).json({
        success: true,
        message: "Vehicle data fetched successfully",
        data: {
          vehicle,
          isOwing: IS_OWING,
          daysOwing: DAYS_OWING,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching vehicle data",
        error: error.message,
      });
    }
  }
}

export class UnregisteredVehicles {
  static async fetchUnregisteredVehicles(_req: Request, res: Response) {
    try {
      const unregisteredVehicles = await UnregisteredVehicle.find({})
        .populate("association")
        .populate({
          path: "vehicleType",
          select: "-beneficiaries",
        });

      return res.status(200).json({
        success: true,
        message: "Unregistered vehicles fetched successfully",
        data: unregisteredVehicles,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching unregistered vehicles",
        error: error.message,
      });
    }
  }

  static async getUnregisteredVehicleByChasssisNumber(
    req: Request,
    res: Response
  ) {
    const { chassisNumber } = req.params;

    try {
      const result = await withMongoTransaction(async (session) => {
        // check registered vehicles list for existing vehicle with the same chassis number
        const registeredVehicle = await Vehicle.findOne({
          chassisNumber,
        }).session(session);

        if (registeredVehicle)
          throw new Error("Vehicle with same Chassis found as registered.");

        const unregisteredVehicle = await UnregisteredVehicle.findOne({
          chassisNumber,
        })
          .populate("association")
          .populate("vehicleType")
          .session(session);

        if (!unregisteredVehicle) throw new Error("Vehicle data not found");

        return unregisteredVehicle;
      });

      return res.status(200).json({
        success: true,
        message: "Unregistered vehicle fetched successfully",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching unregistered vehicle",
        error: error.message,
      });
    }
  }
}
