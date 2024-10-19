import { Request, Response } from "express";
import { UserModel } from "../../models/User";
import { IUser, RoleName } from "../../types";
import { BeneficiaryModel, PaymentTypeModel } from "../../models/PaymentType";
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
      ].map((validation) => validation.run(req))
    );

    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { name, paymentCycle, renewalCycle, amount } = req.body;

    try {
      const result = await withMongoTransaction(async (session) => {
        // Prepare the data for PaymentType creation
        const data = {
          name,
          paymentCycle,
          renewalCycle,
          amount,
          createdBy: req.headers["userid"],
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
      const paymentTypes = await PaymentTypeModel.find();

      // fetch beneficiaries for each of the payment types and attach to the response
      // returning only one instance of vendor and super vendor such that we do not have to return all the vendors and super vendors - all their percentages are same
      for (const paymentType of paymentTypes) {
        const beneficiaries = await BeneficiaryModel.find({
          paymentType: paymentType._id,
        })
          .select("role percentage")
          .populate({
            path: "user",
            select: "fullName email role",
          });

        const vendor = beneficiaries.find(
          (beneficiary) => beneficiary.role === RoleName.Vendor
        );

        const superVendor = beneficiaries.find(
          (beneficiary) => beneficiary.role === RoleName.SuperVendor
        );

        paymentType.set(
          "beneficiaries",
          [...(vendor ? [vendor] : []), ...(superVendor ? [superVendor] : [])],
          { strict: false }
        );

        paymentType.set("beneficiaries", beneficiaries, { strict: false });
      }

      return res.status(200).json({
        success: true,
        message: "Payment Types Fetched Successfully",
        data: paymentTypes,
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          success: false,
          message: "Error Fetching Payment Types",
          error,
        });
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

        const paymentType = await PaymentTypeModel.findByIdAndUpdate(
          id,
          dbQuery,
          { new: true, session, runValidators: true }
        );

        if (!paymentType) {
          throw {
            code: 404,
            success: false,
            message: "Payment Type Not Found",
          };
        }

        return paymentType;
      });

      return res.status(200).json({
        success: true,
        message: "Payment Type Updated Successfully",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
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
