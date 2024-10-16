import { Request, Response } from "express";
import { body, validationResult } from "express-validator";
import SubUnitModel from "../../models/SubUnit";
import { DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_PAGE } from "../../utils/constants";

export class SubUnits {
  validate(method: string) {
    switch (method) {
      case "createSubUnit": {
        return [
          body("name").notEmpty().withMessage("Name is required"),
          body("unit").notEmpty().withMessage("Unit is required"),
          body("createdBy").notEmpty().withMessage("CreatedBy is required"),
        ];
      }
    }
  }

  static async create(req: Request, res: Response) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Validation errors",
          data: errors.array(),
        });
    }

    try {
      const { name, unit } = req.body;
      const subUnit = await SubUnitModel.create({ name, unit, createdBy: req.headers["userid"] });
      res.status(201).json({
        success: true,
        message: "SubUnit created successfully",
        data: subUnit,
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, message: error.message, data: null });
    }
  }

  static async getAll(req: Request, res: Response) {
    const page = req.query.page || DEFAULT_QUERY_PAGE;
    const limit = req.query.limit || DEFAULT_QUERY_LIMIT;
    const skip = (Number(page) - 1) * Number(limit);

    try {
      const subUnits = await SubUnitModel.find()
        .populate("unit")
        .skip(skip)
        .limit(Number(limit));

        const totalSubUnits = await SubUnitModel.countDocuments();

      res.status(200).json({
        success: true,
        message: "SubUnits retrieved successfully",
        data: subUnits,
        total: totalSubUnits,
        page,
        totalPages: Math.ceil(totalSubUnits / Number(limit)),
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, message: error.message, data: null });
    }
  }

  static async getOne(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const subUnit = await SubUnitModel.findById(id).populate("unit");
      if (!subUnit) {
        return res
          .status(404)
          .json({ success: false, message: "SubUnit not found", data: null });
      }
      res.status(200).json({
        success: true,
        message: "SubUnit retrieved successfully",
        data: subUnit,
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, message: error.message, data: null });
    }
  }

  static async updateOne(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const updateFields = req.body;
      const subUnit = await SubUnitModel.findByIdAndUpdate(id, updateFields, {
        new: true,
      });
      if (!subUnit) {
        return res
          .status(404)
          .json({ success: false, message: "SubUnit not found", data: null });
      }
      res.status(200).json({
        success: true,
        message: "SubUnit updated successfully",
        data: subUnit,
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, message: error.message, data: null });
    }
  }

  static async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const subUnit = await SubUnitModel.findByIdAndDelete(id);
      if (!subUnit) {
        return res
          .status(404)
          .json({ success: false, message: "SubUnit not found", data: null });
      }
      res.status(200).json({
        success: true,
        message: "SubUnit deleted successfully",
        data: null,
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, message: error.message, data: null });
    }
  }
}
