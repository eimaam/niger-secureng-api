import { Request, Response } from "express";
import { DriverModel, IDriver } from "../../models/Driver";
import { withMongoTransaction } from "../../utils/mongoTransaction";
import { PaymentTypeModel } from "../../models/PaymentType";
import { PaymentTypeEnum, RoleName } from "../../types";
import {
  IInvoiceData,
  MonnifyService,
} from "../../services/monnify.wallet.service";
import { DownloadHistoryModel } from "../../models/Transaction";
import { DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_PAGE } from "../../utils/constants";
import { body, validationResult } from "express-validator";
import { uploadImage } from "../../services/googlecloud.service";
import { UserModel } from "../../models/User";
import { AssociationModel } from "../../models/Association";
import { convertImageToBase64, hasExpired } from "../../utils";
import { BUCKET_STORAGE_LOCATION } from "../../utils/config";
import { isValidObjectId } from "mongoose";
import { IDownloadQuota } from "../../models/Vehicle";

export class Drivers {
  static async registerDriver(req: Request, res: Response) {
    const userId = req.headers["userid"];
    // grabing the image file from the request via multer
    const imageFile = req.file;

    if (!imageFile) {
      return res.status(400).json({
        success: false,
        message: "Image file is required",
      });
    }

    const {
      nin,
      fullName,
      email,
      phoneNumber,
      dob,
      complexion,
      gender,
      religion,
      tribe,
      stateOfOrigin,
      lga,
      address,
      // guarantor object > reference GuranatorSchema
      guarantor,
      association,
      associationNumber,
      vehicleType,
    } = req.body;
    // validate vehicleType
    const paymentType = await PaymentTypeModel.findById(vehicleType);
    if (!paymentType) {
      throw new Error(`Invalid vehicle type: ${vehicleType}`);
    }

    // Validate request body using express-validator
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: errors.array(),
      });
    }

    try {
      const formattedDateOfBirth = new Date(dob);
      const parsedGuarantor = JSON.parse(guarantor);

      const result = await withMongoTransaction(async (session) => {
        //  check if driver with the same NIN or phoneNumber already exists
        const existingDriver = await DriverModel.findOne({
          $or: [{ nin }, { phoneNumber }, { email }],
        }).session(session);

        if (existingDriver) {
          throw new Error(
            "Driver with this NIN, Phone Number or Email already registered"
          );
        }

        // verify driver with the same association number
        const existingAssociationNumber = await DriverModel.findOne({
          associationNumber: {
            $regex: new RegExp(`^${associationNumber}$`, "i"),
          },
        }).session(session);

        if (existingAssociationNumber) {
          throw new Error(
            "Driver with this Association Number already registered"
          );
        }

        const newDriverData = {
          nin,
          fullName,
          // Image processing will be done later after successful processing of driver creation and invoice generation
          image: null,
          email,
          phoneNumber,
          dob: formattedDateOfBirth,
          complexion,
          gender,
          religion,
          tribe,
          stateOfOrigin,
          lga,
          address,
          guarantor: parsedGuarantor,
          association,
          associationNumber: associationNumber?.toUpperCase(),
          vehicleType,
          createdBy: req.headers["userid"],
        };

        const newDriver: IDriver[] = await DriverModel.create([newDriverData], {
          session,
        });

        const invoiceType = await PaymentTypeModel.findOne({
          name: PaymentTypeEnum.DRIVER_REGISTRATION,
        });

        if (!invoiceType) {
          throw new Error("Invoice type not found");
        }

        const invoiceData: IInvoiceData = {
          type: invoiceType._id.toString(),
          amount: invoiceType.amount,
          description: "Driver Registration Fee",
          customerEmail: newDriver[0].email,
          customerName: newDriver[0].fullName,
          metaData: {
            driverId: newDriver[0]._id,
            paymentType: invoiceType._id,
          },
          createdBy: userId as string,
        };

        const invoice = await MonnifyService.createInvoice(
          invoiceData,
          session
        );

        if (!invoice) {
          throw new Error("Error creating invoice");
        }

        return {
          driver: newDriver[0],
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

      if (result.invoice) {
        try {
          const imageUrl = await uploadImage(
            imageFile,
            `${BUCKET_STORAGE_LOCATION.DRIVERS_IMAGE}/${result.driver._id}.png`
          );

          if (!imageUrl) {
            throw new Error("Error uploading image");
          }
          // Update driver image
          const updatedDriver = await DriverModel.findByIdAndUpdate(
            result.driver._id,
            {
              image: imageUrl,
            }
          );
          if (!updatedDriver) {
            throw new Error("Failed to update driver with image URL");
          }
        } catch (error) {
          // Rollback driver creation and delete invoice
          await withMongoTransaction(async (session) => {
            await DriverModel.findByIdAndDelete(result.driver._id).session(
              session
            );
            await MonnifyService.cancelInvoice(
              result.invoice?.invoiceReference,
              session
            );
          });
          throw {
            code: 500,
            message: "Registration Failed. There was an error uploading image",
          };
        }
      }

      return res.status(201).json({
        success: true,
        message: "Driver registered successfully",
        data: result,
      });
    } catch (error: any) {
      if (error?.keyPattern?.email) {
        return res.status(400).json({
          success: false,
          message: "Email already exists",
        });
      }
      return res.status(500).json({
        success: false,
        message: "Error registering driver",
        error: error?.message,
      });
    }
  }

  static async getDriverById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const driver = await DriverModel.findById(id)
        .populate({
          path: "downloadQuota.type",
          select: "name",
        })
        .populate({
          path: "createdBy",
          select: "-password -isDefaultPassword",
        })
        .populate({
          path: "association",
          select: "name code",
          populate: {
            path: "type",
            select: "name",
          },
        });
      if (!driver) {
        return res.status(404).json({
          success: false,
          message: "Driver not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Driver data fetched successfully",
        data: driver,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving driver",
      });
    }
  }

  static async getByQRCode(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const driver = await DriverModel.findById(id)
        .select("permit.expiryDate permit.issueDate")
        .populate({
          path: "association",
          select: "name code",
          populate: {
            path: "type",
            select: "name",
          },
        });

      if (!driver) {
        return res.status(404).json({
          success: false,
          message: "Driver not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Driver data fetched successfully",
        data: driver,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving driver",
        error: error.message,
      });
    }
  }

  static async getDataByQRCode(req: Request, res: Response) {
    const { driverId } = req.params;

    body("driverId")
      .notEmpty()
      .withMessage("Driver ID is required")
      .isString()
      .withMessage("Invalid Driver ID")
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
      let driver;

      if (!isValidObjectId(driverId)) {
        driver = await DriverModel.findOne({ qrCodeId: driverId })
          .populate({
            path: "association",
            select: "name code",
          })
          .populate({
            path: "vehicleType",
            select: "name",
          });
      } else {
        driver = await DriverModel.findById(driverId)
          .populate({
            path: "association",
            select: "name code",
          })
          .populate({
            path: "vehicleType",
            select: "name",
          });
      }

      if (!driver) {
        return res.status(404).json({
          success: false,
          message: "Driver not found",
        });
      }

      const PERMIT_EXPIRED = hasExpired(driver.permit.expiryDate);
      const PERMIT_EXPIRY_DATE = driver.permit.expiryDate;

      return res.status(200).json({
        success: true,
        message: "Driver data fetched successfully",
        data: {
          driver,
          permitExpired: PERMIT_EXPIRED,
          permitExpiryDate: PERMIT_EXPIRY_DATE,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching Driver data",
        error: error.message,
      });
    }
  }

  static async getAllDrivers(req: Request, res: Response) {
    const page = parseInt(req.query.page as string) || DEFAULT_QUERY_PAGE;
    const limit = parseInt(req.query.limit as string) || DEFAULT_QUERY_LIMIT;
    const skip = Number((page - 1) * limit);

    // filters
    const { fullName, nin, phoneNumber, email, associationNumber } = req.query;

    const query: any = {};

    if (fullName) {
      query.fullName = { $regex: fullName as string, $options: "i" };
    }

    if (nin) {
      query.nin = { $regex: nin as string, $options: "i" };
    }

    if (phoneNumber) {
      query.phoneNumber = { $regex: phoneNumber as string, $options: "i" };
    }

    if (email) {
      query.email = { $regex: email as string, $options: "i" };
    }

    if (associationNumber) {
      query.association = associationNumber as string;
    }

    const userId = req.headers["userid"] as string;

    const user = await UserModel.findById(userId);

    try {
      let drivers: IDriver[] = [];
      let totalDrivers: number;

      if (user?.role === RoleName.Association) {
        const association = await AssociationModel.findOne({ userId: userId });

        if (!association) {
          return res.status(404).json({
            success: false,
            message: "Invalid User. Association not found",
          });
        }

        drivers = await DriverModel.find({
          ...query,
          association: association._id,
        })
          .populate("association")
          .populate({
            path: "vehicleType",
            select: "name",
          })
          .select("-downloadQuota")
          .skip(skip)
          .limit(limit);

        totalDrivers = await DriverModel.countDocuments({
          ...query,
          association: association._id,
        });
      } else {
        drivers = await DriverModel.find({
          ...query,
        })
          .populate("association")
          .populate({
            path: "vehicleType",
            select: "name",
          })
          .populate({
            path: "downloadQuota.type",
            select: "name",
          })
          .populate("createdBy")
          .skip(skip)
          .limit(limit);

        // convert the driver images to base64
        async function convertDriverImagesToBase64() {
          return await Promise.all(
            drivers.map(async (driver) => {
              if (driver.image) {
                const imageUrl = driver.image;
                try {
                  const base64Image = await convertImageToBase64(imageUrl);
                  driver.image = base64Image;
                } catch (error) {
                  console.error(
                    `Error converting image to base64 for driver with ID: ${driver._id}`
                  );
                }
              }
              return driver;
            })
          );
        }

        drivers = await convertDriverImagesToBase64();

        totalDrivers = await DriverModel.countDocuments(query);
      }

      return res.status(200).json({
        success: true,
        message: "Drivers List fetched successfully",
        data: drivers,
        total: totalDrivers,
        totalPages: Math.ceil(totalDrivers / limit),
        page,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving drivers",
        error: error,
      });
    }
  }

  static async deleteDriver(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const driver = await DriverModel.findByIdAndDelete(id);

      if (!driver) {
        return res.status(404).json({
          success: false,
          message: "Driver not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Driver deleted successfully",
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error deleting driver",
      });
    }
  }

  static async updateDriver(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const {
        nin,
        fullName,
        image,
        email,
        phoneNumber,
        dob,
        complexion,
        gender,
        religion,
        tribe,
        stateOfOrigin,
        lga,
        address,
        guarantor,
        vehicleType,
        association,
        associationNumber,
      } = req.body;

      const formattedDateOfBirth = dob ? new Date(dob) : undefined;

      const updateData: Partial<IDriver> = {
        nin,
        fullName,
        image,
        email,
        phoneNumber,
        dob: formattedDateOfBirth,
        complexion,
        gender,
        religion,
        tribe,
        stateOfOrigin,
        lga,
        address,
        guarantor,
        association,
        associationNumber,
        vehicleType,
      };

      const result = await withMongoTransaction(async (session) => {
        const existingDriver = await DriverModel.findOne({
          $or: [{ nin }, { phoneNumber }, { email }],
          _id: { $ne: id },
        }).session(session);

        if (existingDriver) {
          throw new Error(
            "Another driver with this NIN or phone number already exists"
          );
        }

        const existingAssociationNumber = await DriverModel.findOne({
          associationNumber,
          _id: { $ne: id },
        }).session(session);

        if (existingAssociationNumber) {
          throw new Error(
            "Another driver with this Association Number already exists"
          );
        }

        const driver = await DriverModel.findByIdAndUpdate(id, updateData, {
          new: true,
          runValidators: true,
          session,
        });

        if (!driver) {
          throw new Error("Driver not found");
        }

        return driver;
      });

      return res.status(200).json({
        success: true,
        message: "Driver updated successfully",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error updating driver",
        error: error.message,
      });
    }
  }

  static async downloadPermit(req: Request, res: Response) {
    const { id } = req.params;
    const userId = req.headers["userid"];
    try {
      const result = await withMongoTransaction(async (session) => {
        const driver = await DriverModel.findById(id).session(session);

        if (!driver) {
          throw new Error("Driver not found");
        }

        const invoiceType = await PaymentTypeModel.findOne({
          name: PaymentTypeEnum.DRIVER_PERMIT_PRINTING,
        });

        if (!invoiceType) {
          throw new Error("Invoice type not found");
        }

        const targetDownloadQuota =
          driver.downloadQuota &&
          driver.downloadQuota.find(
            (quota) => quota.type.toString() === invoiceType._id.toString()
          );

        if (!targetDownloadQuota) {
          throw new Error("Download quota not found");
        }

        if (targetDownloadQuota.quota <= 0) {
          throw new Error("No quota available");
        }

        const updatedDownloadQuota = await DriverModel.findOneAndUpdate(
          { _id: driver._id, "downloadQuota.type": invoiceType._id },
          { $inc: { "downloadQuota.$.quota": -1 } },
          { new: true, session }
        );

        if (!updatedDownloadQuota) {
          throw new Error("Failed to update download quota");
        }

        const downloadHistoryData = {
          driver: driver._id,
          type: invoiceType._id,
          processedBy: userId,
        };

        const downloadHistory = await DownloadHistoryModel.create(
          [downloadHistoryData],
          { session }
        );

        return downloadHistory;
      });

      return res.status(200).json({
        success: true,
        message: "Driver ID downloaded successfully",
        data: result,
      });
    } catch (error: any) {}
  }

  static async downloadQrCode(req: Request, res: Response) {
    const { driverId } = req.params;

    const { type } = req.body;

    await body("type")
      .notEmpty()
      .withMessage("Invoice type is required")
      .equals(PaymentTypeEnum.DRIVER_QR_CODE_PRINTING)
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

    if (!isValidObjectId(driverId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid driver id",
      });
    }

    try {
      const result = await withMongoTransaction(async (session) => {
        const userId = req.headers["userid"];

        const driver = await DriverModel.findById(driverId).session(session);
        if (!driver) {
          throw {
            code: 404,
            message: "Driver not found",
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

        const targetQuota = driver?.downloadQuota?.find(
          (quota: IDownloadQuota) =>
            quota.type.toString() === invoiceType._id.toString()
        );

        if (!targetQuota || targetQuota.quota < 1) {
          throw {
            code: 400,
            message: "No available quota for QR code download",
          };
        }

        const updatedDriver = await DriverModel.findOneAndUpdate(
          {
            _id: driverId,
            "downloadQuota.type": invoiceType._id,
          },
          { $inc: { "downloadQuota.$.quota": -1 } },
          { new: true, runValidators: true, session }
        );

        if (!updatedDriver) {
          throw {
            code: 500,
            message: "Failed to update download quota",
          };
        }

        const downloadHistoryData = {
          driver: driverId,
          type: invoiceType._id,
          processedBy: userId,
        };

        const downloadHistory = await DownloadHistoryModel.create(
          [downloadHistoryData],
          { session }
        );

        return updatedDriver;
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
}
