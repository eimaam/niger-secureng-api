import { Request, Response } from "express";
import { BeneficiaryModel, PaymentTypeModel } from "../../models/PaymentType";
import { withMongoTransaction } from "../../utils/mongoTransaction";
import { body, header, validationResult } from "express-validator";
import { DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_PAGE } from "../../utils/constants";
import { RoleName } from "../../types";
import { UserModel } from "../../models/User";

export class BeneficiaryController {
  // Create a new beneficiary
  static async createBeneficiary(req: Request, res: Response) {
    // Validation middleware
    const validateBeneficiary = [
      body("userId").isMongoId().withMessage("Invalid user ID"),
      body("percentage")
        .isFloat({ min: 0, max: 100 })
        .withMessage("Percentage must be between 0 and 100"),
      body("paymentTypeId").isMongoId().withMessage("Invalid payment type ID"),
    ];

    // Run validation
    await Promise.all(
      validateBeneficiary.map((validation) => validation.run(req))
    );
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { userId, percentage, paymentTypeId } = req.body;
    const createdBy = req.headers["userid"] as string;

    try {
      const result = await withMongoTransaction(async (session) => {
        // verify the user ID and the role of the user passed in the request body are valid as in db
        const user = await UserModel.findById(userId).session(session);
        if (!user) {
          throw new Error("User not found");
        }

        // Fetch the payment type
        const paymentType = await PaymentTypeModel.findById(
          paymentTypeId
        ).session(session);
        
        if (!paymentType) {
          throw new Error("Payment type not found");
        }

        // Check if the same beneficiary with the same percentage and user ID already exists
        const existingBeneficiaryWithSamePercentage =
          await BeneficiaryModel.findOne({
            user: userId,
            percentage,
            paymentType: paymentTypeId,
          }).session(session);

        if (existingBeneficiaryWithSamePercentage) {
          throw new Error(
            "Beneficiary with the same user ID and percentage already exists for this Payment Type"
          );
        }

        // Check if the same user ID exists with a different percentage for the same payment type
        const existingBeneficiaryWithDifferentPercentage =
          await BeneficiaryModel.findOne({
            user: userId,
            paymentType: paymentTypeId,
          }).session(session);

        if (existingBeneficiaryWithDifferentPercentage) {
          throw new Error(
            "Beneficiary with the same user ID already exists for this payment type with a different percentage"
          );
        }

        // Fetch existing beneficiaries for the payment type
        const existingBeneficiaries = await BeneficiaryModel.find({
          paymentType: paymentTypeId,
        }).session(session);

        // Calculate the total percentage including the new beneficiary
        // if the new beneficiary is a vendor or super vendor, calculate the total percentage without the new beneficiary percentage
        // this is cause we have several vendors and super vendors and they benefit from a payment they process which means they are not constant
        // lets implement the logic
        let totalPercentage = 0;
        if (user.role === RoleName.Vendor || user.role === RoleName.SuperVendor) {
          totalPercentage = existingBeneficiaries.reduce((sum, beneficiary) => {
            return sum + beneficiary.percentage;
          }, 0);
        } else {
          totalPercentage = existingBeneficiaries.reduce((sum, beneficiary) => {
            return sum + beneficiary.percentage;
          }, percentage);
        }


        if (totalPercentage > 100) {
          throw new Error(
            "Total percentage of beneficiaries cannot exceed 100%"
          );
        }

        // Create the new beneficiary
        const newBeneficiary = new BeneficiaryModel({
          user: userId,
          percentage,
          role: user.role,
          paymentType: paymentTypeId,
          createdBy,
        });

        await newBeneficiary.save({ session });

        return newBeneficiary;
      });

      return res.status(201).json({
        success: true,
        message: "Beneficiary created successfully",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  // Get all beneficiaries
  // Get all beneficiaries
  static async getAllBeneficiaries(req: Request, res: Response) {
    const { userId, percentage, paymentTypeId } = req.query;

    try {
      const page = parseInt(req.query.page as string) || DEFAULT_QUERY_PAGE;
      const limit = parseInt(req.query.limit as string) || DEFAULT_QUERY_LIMIT;
      const skip = (page - 1) * limit;

      let query = BeneficiaryModel.find();
      let totalBeneficiaries = 0;
      let result;

      // Apply filters if provided
      if (userId) {
        query = query.where("userId").equals(userId);
      }
      if (percentage) {
        query = query
          .where("percentage")
          .equals(parseFloat(percentage as string));
      }
      if (paymentTypeId) {
        query = query.where("paymentType").equals(paymentTypeId);
      }

      totalBeneficiaries = await BeneficiaryModel.countDocuments(query);
      result = await query
        .populate({
          path: "user",
          select: "fullName email role",
        })
        .populate({
          path: "createdBy",
          select: "fullName email",
        })
        .populate("paymentType")
        .skip(skip)
        .limit(limit)
        .exec();


        // filter & return one instance only for each beneficiary based on _id field
        const filteredBeneficiaryList = result.reduce((acc: any, current: any) => {
          const x = acc.find((item: any) => item.user._id === current.user._id);
          if (!x) {
            return acc.concat([current]);
          } else {
            return acc;
          }
        }
        , []);

      const totalPages = Math.ceil(totalBeneficiaries / limit);

      return res.status(200).json({
        success: true,
        data: filteredBeneficiaryList,
        pagination: {
          totalBeneficiaries,
          totalPages,
          currentPage: page,
          limit,
        },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  // Get beneficiary by ID
  static async getById(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const beneficiary = await BeneficiaryModel.findById(id);
      if (!beneficiary) {
        return res
          .status(404)
          .json({ success: false, message: "Beneficiary not found" });
      }

      return res.status(200).json({
        success: true,
        data: beneficiary,
      });
    } catch (error: any) {
      console.log("Get beneficiary by ID error: ", error);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }

  // Update a beneficiary
  // Update a beneficiary
  static async updateBeneficiary(req: Request, res: Response) {
    // Validation middleware
    const validateBeneficiary = [
      body("userId").optional().isMongoId().withMessage("Invalid user ID"),
      body("percentage")
        .optional()
        .isFloat({ min: 0, max: 100 })
        .withMessage("Percentage must be between 0 and 100"),
      body("paymentTypeId")
        .optional()
        .isMongoId()
        .withMessage("Invalid payment type ID"),
      body("role")
        .optional()
        .isIn(Object.values(RoleName))
        .withMessage("Invalid role"),
    ];

    // Run validation
    await Promise.all(
      validateBeneficiary.map((validation) => validation.run(req))
    );
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { userId, percentage, paymentTypeId, role } = req.body;

    try {
      const result = await withMongoTransaction(async (session) => {
        // Fetch the existing beneficiary
        const existingBeneficiary = await BeneficiaryModel.findById(id).session(
          session
        );
        if (!existingBeneficiary) {
          throw new Error("Beneficiary not found");
        }

        // Check if the same beneficiary with the same percentage and user ID already exists
        if (userId && percentage && paymentTypeId) {
          const duplicateBeneficiary = await BeneficiaryModel.findOne({
            user: userId,
            percentage,
            paymentType: paymentTypeId,
            _id: { $ne: id },
          }).session(session);

          if (duplicateBeneficiary) {
            throw new Error(
              "Beneficiary with the same percentage and user ID already exists under this payment type"
            );
          }
        }

        // Update the beneficiary fields
        if (userId) existingBeneficiary.user = userId;
        if (percentage) existingBeneficiary.percentage = percentage;
        if (paymentTypeId) existingBeneficiary.paymentType = paymentTypeId;
        if (role) existingBeneficiary.role = role;

        // Fetch existing beneficiaries for the payment type
        const existingBeneficiaries = await BeneficiaryModel.find({
          paymentType: existingBeneficiary.paymentType,
        }).session(session);

        // Calculate the total percentage including the updated beneficiary
        const totalPercentage = existingBeneficiaries.reduce(
          (sum, beneficiary) => {
            if (beneficiary._id.toString() === id) {
              return sum + (percentage || beneficiary.percentage);
            }
            return sum + beneficiary.percentage;
          },
          0
        );

        if (totalPercentage > 100) {
          throw new Error(
            "Total percentage of beneficiaries cannot exceed 100%"
          );
        }

        await existingBeneficiary.save({ session });

        return existingBeneficiary;
      });

      return res.status(200).json({
        success: true,
        message: "Beneficiary updated successfully",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  // Delete a beneficiary
  static async deleteBeneficiary(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const result = await withMongoTransaction(async (session) => {
        const existingPaymentType = await PaymentTypeModel.findOne({
          beneficiaries: id,
        }).session(session);

        if (existingPaymentType) {
          throw new Error(
            "Beneficiary cannot be deleted as it is associated with a payment type. Remove the beneficiary from the payment type first."
          );
        }

        // Find and delete the beneficiary
        const deletedBeneficiary = await BeneficiaryModel.findByIdAndDelete(
          id
        ).session(session);
        if (!deletedBeneficiary) {
          throw new Error("The beneficiary could not be deleted");
        }

        return deletedBeneficiary;
      });

      return res.status(200).json({
        success: true,
        message: "Beneficiary deleted successfully",
        data: result,
      });
    } catch (error: any) {
      console.log("Delete beneficiary error: ", error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }
}
