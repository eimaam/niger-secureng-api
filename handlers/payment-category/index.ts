import { Request, Response } from "express";
import { PaymentCategoryModel } from "../../models/PaymentCategory";

export default class PaymentCategory {
  static async create(req: Request, res: Response) {
    const userId = req.headers["userid"];
    const { name, description } = req.body;

    if (!name || !description) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Please provide name and description",
        });
    }

    try {
      const existingPaymentCategory = await PaymentCategoryModel.findOne({
        name,
      });

      if (existingPaymentCategory) {
        return res
          .status(400)
          .json({ success: false, message: "Payment category already exists" });
      }

      const data = { name, description, createdBy: userId };

      const newPaymentCategory = await PaymentCategoryModel.create(data);

      return res.status(201).json({
        success: true,
        message: "Payment category created successfully",
        data: newPaymentCategory,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Error creating payment category",
        error,
      });
    }
  }


  static async getAll(_req: Request, res: Response) {
    try {
      const paymentCategories = await PaymentCategoryModel.find().populate({
        path: "createdBy",
        select: "name email",
      });
      return res.status(200).json({
        success: true,
        message: "Payment categories fetched successfully",
        data: paymentCategories,
      });
    } catch (error:any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching payment categories",
        error: error.message,
      });
    }
  }
}
