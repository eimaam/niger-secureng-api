import { Request, Response } from "express";
import { VehicleOwner } from "../../models/VehicleOwner";
import { DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_PAGE } from "../../utils/constants";
import { PaymentTypeModel } from "../../models/PaymentType";
import { PaymentTypeEnum } from "../../types";
import { convertImageToBase64 } from "../../utils";

export class VehicleOwners {
  static async checkOwnerExists(req: Request, res: Response) {
    const { nin, phoneNumber, email } = req.body;

    if (!nin && !phoneNumber && !email) {
      return res.status(400).json({
        success: false,
        message: "At least one of NIN, phone number or email is required",
      });
    }

    try {
      const vehicleOwner = await VehicleOwner.findOne({
        $or: [
          { nin: nin as string },
          { phoneNumber: phoneNumber as string },
          { email: email as string },
        ],
      });

      if (vehicleOwner) {
        return res.status(200).json({
          success: true,
          message: "Vehicle owner exists",
          data: vehicleOwner,
        });
      }

      return res.status(200).json({
        success: true,
        message: "Vehicle owner does not exist",
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error checking if vehicle owner exists",
      });
    }
  }

  static async getAll(req: Request, res: Response) {
    const page = parseInt(req.query.page as string) || DEFAULT_QUERY_PAGE;
    const limit = parseInt(req.query.limit as string) || DEFAULT_QUERY_LIMIT;
    const skip = Number(page - 1) * Number(limit);

    const query: any = {};

    if (req.query.createdBy) {
      query.createdBy = req.query.createdBy;
    }

    if (req.query.type) {
      const paymentType = await PaymentTypeModel.findOne({
        name: req.query.type as PaymentTypeEnum,
      });
      query.type = paymentType?._id;
    }

    if (req.query.nin) {
      query.nin = req.query.nin;
    }

    if (req.query.phoneNumber) {
      query.phoneNumber = req.query.phoneNumber;
    }

    if (req.query.email) {
      query.email = new RegExp(`^${req.query.email}$`, "i");
    }

    if (req.query.fullName) {
      query.fullName = new RegExp(`^${req.query.fullName}$`, "i");
    }

    try {
      const vehicleOwners = await VehicleOwner.find(query)
        .populate({
          path: "createdBy",
          select: "fullName email",
        })
        .skip(skip)
        .limit(limit);
      // convert owners images to base64
      async function convertDriverImagesToBase64() {
        return await Promise.all(
          vehicleOwners.map(async (owner) => {
            if (owner.image) {
              const imageUrl = owner.image;
              try {
                const base64Image = await convertImageToBase64(imageUrl);
                owner.image = base64Image;
              } catch (error) {
                console.error(
                  `Error converting image to base64 for owner with ID: ${owner._id}`,
                  error
                );
              }
            }
            return owner;
          })
        );
      }
      const updatedOwners = await convertDriverImagesToBase64();
      const total = await VehicleOwner.countDocuments(query);

      return res.status(200).json({
        success: true,
        message: "Vehicle owners fetched successfully",
        data: updatedOwners,
        page,
        total,
        totalPages: Math.ceil(total / limit),
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching vehicle owners",
      });
    }
  }

  static async getById(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const vehicleOwner = await VehicleOwner.findById(id);

      if (!vehicleOwner) {
        return res.status(404).json({
          success: false,
          message: "Vehicle owner not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Vehicle owner fetched successfully",
        data: vehicleOwner,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching vehicle owner",
      });
    }
  }

  static async getByFilters(req: Request, res: Response) {
    const { nin, phoneNumber, email, bvn } = req.query;

    try {
      const vehicleOwners = await VehicleOwner.find({
        $or: [
          { nin: nin as string },
          { phoneNumber: phoneNumber as string },
          { email: email as string },
          { bvn: bvn as string },
        ],
      });

      if (vehicleOwners.length === 0) {
        return res.status(200).json({
          success: true,
          message: "No vehicle owner found",
          data: vehicleOwners,
        });
      }

      return res.status(200).json({
        success: true,
        message: "Vehicle owners fetched successfully",
        data: vehicleOwners,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching vehicle owners",
      });
    }
  }
}
