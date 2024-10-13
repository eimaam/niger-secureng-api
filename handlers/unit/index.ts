import { Request, Response } from "express";
import UnitModel from "../../models/Unit";
import { PaymentTypeModel } from "../../models/PaymentType";
import { DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_PAGE } from "../../utils/constants";

export default class Units {
  static async create(req: Request, res: Response) {
    try {
      const { name, code, lga, taxType } = req.body;

      const existingUnit = await UnitModel.findOne({ code });

      if (existingUnit) {
        return res
          .status(400)
          .json({ success: false, message: "Unit already registered" });
      }

      const existingTaxType = await PaymentTypeModel.findOne({ _id: taxType });

      if (!existingTaxType) {
        return res
          .status(400)
          .json({ success: false, message: "Tax type does not exist" });
      }

      const data = {
        name,
        code,
        lga,
        taxType,
        createdBy: req.headers["userid"],
      };

      const newUnit = await UnitModel.create(data);

      return res.status(201).json({
        success: true,
        message: "Unit created successfully",
        data: newUnit,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Error creating unit",
        error,
      });
    }
  }

  static async getAll(req: Request, res: Response) {
    const page = parseInt(req.query.page as string) || DEFAULT_QUERY_PAGE;
    const limit = parseInt(req.query.limit as string) || DEFAULT_QUERY_LIMIT;
    const skip = (page - 1) * limit;

    try {
      const units = await UnitModel.find({})
        .populate({
          path: "taxType",
          select: "name",
        })
        .skip(skip)
        .limit(limit);

      return res.status(200).json({
        success: true,
        message: "Units fetched successfully",
        data: units,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Error fetching units",
        error,
      });
    }
  }

  static async updateOne(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const { name, code, lga, taxType } = req.body;

      const dbQuery: any = { _id: id };

      if (name) {
        dbQuery["name"] = name;
      }

      if (code) {
        dbQuery["code"] = code;
      }

      if (lga) {
        dbQuery["lga"] = lga;
      }

      if (taxType) {
        dbQuery["taxType"] = taxType;
      }

      const existingTaxType = await PaymentTypeModel.findOne({ _id: taxType });

      if (!existingTaxType) {
        return res
          .status(400)
          .json({ success: false, message: "Tax type does not exist" });
      }

      const unit = await UnitModel.findOneAndUpdate({ _id: id }, dbQuery, {
        new: true,
      });

      if (!unit) {
        return res
          .status(404)
          .json({ success: false, message: "Unit not found" });
      }

      return res.status(200).json({
        success: true,
        message: "Unit updated successfully",
        data: unit,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Error updating unit",
        error,
      });
    }
  }

  static async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const unit = await UnitModel.findByIdAndDelete(id);

      if (!unit) {
        return res
          .status(404)
          .json({ success: false, message: "Unit not found" });
      }

      return res.status(200).json({
        success: true,
        message: "Unit deleted successfully",
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Error deleting unit",
        error,
      });
    }
  }
}
