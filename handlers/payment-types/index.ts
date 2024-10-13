import { Request, Response } from "express";
import { UserModel } from "../../models/User";
import { IUser, RoleName } from "../../types";
import { Beneficiary, PaymentTypeModel } from "../../models/PaymentType";
import { withMongoTransaction } from "../../utils/mongoTransaction";
import { DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_PAGE } from "../../utils/constants";
import { body, validationResult } from "express-validator";
import { BeneficiaryService } from "../../services/beneficiary.service";

export class PaymentTypes {
  static async create(req: Request, res: Response) {
    await Promise.all(
      [
        body("name").trim().notEmpty().withMessage("Name is required"),
        body("paymentCycle")
          .trim()
          .notEmpty()
          .withMessage("Payment cycle is required"),
        body("renewalCycle")
          .trim()
          .notEmpty()
          .withMessage("Renewal cycle is required"),
        body("amount").isNumeric().withMessage("Amount must be a number"),
        body("category").trim().notEmpty().withMessage("Category is required"),
        body("beneficiaries")
          .isArray()
          .withMessage("Beneficiaries must be an array"),
        body("beneficiaries.*")
          .isMongoId()
          .withMessage("Invalid beneficiary ID"),
      ].map((validation) => validation.run(req))
    );

    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const {
      name,
      paymentCycle,
      renewalCycle,
      amount,
      category,
      beneficiaries: beneficiaryIds,
    } = req.body;

    // Check if all required fields are present
    if (
      !name ||
      !paymentCycle ||
      !renewalCycle ||
      !amount ||
      !category ||
      !beneficiaryIds ||
      !Array.isArray(beneficiaryIds)
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required, including beneficiaries",
      });
    }

    try {
      const result = await withMongoTransaction(async (session) => {
        // Fetch beneficiaries from the database using their IDs
        const beneficiaries = await Beneficiary.find({
          _id: { $in: beneficiaryIds },
        }).exec();

        if (beneficiaries.length !== beneficiaryIds.length) {
          throw new Error("Some beneficiary IDs are invalid");
        }
        // Validate that the sum of beneficiaries' percentages equals 100%
        const totalPercentage = beneficiaries.reduce(
          (sum, beneficiary) => sum + beneficiary.percentage,
          0
        );

        if (totalPercentage !== 100) {
          throw new Error(
            "Total percentage of beneficiaries must be exactly 100%"
          );
        }
        // Prepare the data for PaymentType creation
        const data = {
          name,
          paymentCycle,
          renewalCycle,
          amount,
          category,
          createdBy: req.headers["userid"],
          beneficiaries: beneficiaries.map((beneficiary) => ({
            beneficiary: beneficiary._id,
            percentage: beneficiary.percentage,
          })),
        };

        // Create the PaymentType with the validated beneficiaries
        const paymentType = await PaymentTypeModel.create([data], { session });

        return paymentType[0];
      });

      return res.status(201).json({
        success: true,
        message: "Payment Type Added Successfully",
        data: result,
      });
    } catch (error) {
      return res
        .status(500)
        .json({ success: false, message: "Error Adding Payment Type", error });
    }
  }

  static async getAll(_req: Request, res: Response) {
    try {
      const paymentTypes = await PaymentTypeModel.find()
        .populate({
          path: "beneficiaries.beneficiary",
          select: "role percentage",
        })
        .populate({
          path: "category",
          select: "name",
        });

      return res.status(200).json({
        success: true,
        message: "Payment Types Fetched Successfully",
        data: paymentTypes,
      });
    } catch (error) {
      return res
        .status(500)
        .json({ success: false, message: "Error Fetching Payment Types", error });
    }
  }

  static async update(req: Request, res: Response) {
    const { id } = req.params;
    const { name, paymentCycle, renewalCycle, amount, beneficiaries } =
      req.body;

    try {
      const result = await withMongoTransaction(async (session) => {
        const dbQuery: any = {};

        if (name) dbQuery.name = name;
        if (paymentCycle) dbQuery.paymentCycle = paymentCycle;
        if (renewalCycle) dbQuery.renewalCycle = renewalCycle;
        if (amount) dbQuery.amount = amount;

        if (beneficiaries) {
          try {
            const validatedBeneficiaries =
              await BeneficiaryService.revalidateBeneficiaries(
                beneficiaries,
                session
              );
            dbQuery.beneficiaries = validatedBeneficiaries;
          } catch (error: any) {
            throw new Error(error.message);
          }
        }

        const paymentType = await PaymentTypeModel.findByIdAndUpdate(
          id,
          dbQuery,
          { new: true, session, runValidators: true }
        );

        if (!paymentType) {
          throw {
            code: 404,
            success: false, 
            message: "Payment Type Not Found"
          }
        }

        return paymentType;
      });

      return res.status(200).json({
        success: true,
        message: "Payment Type Updated Successfully",
        data: result,
      });
    } catch (error: any) {
      return res
        .status(500)
        .json({
          success: false,
          message: "Error Updating Payment Type",
          error: error.message,
        });
    }
  }

  static async delete(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const paymentType = await PaymentTypeModel.findByIdAndDelete(id);

      if (!paymentType) {
        return res
          .status(404)
          .json({ success: false, message: "Payment Type Not Found" });
      }

      return res
        .status(200)
        .json({ success: true, message: "Payment Type Deleted Successfully" });
    } catch (error) {
      return res
        .status(500)
        .json({ success: false, message: "Error Deleting Payment Type" });
    }
  }
}
