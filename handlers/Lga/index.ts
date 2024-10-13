import { Request, Response } from "express";
import { LGA } from "../../models/Lga";



export class LGAs {
  static async create(req: Request, res: Response) {
    const { name } = req.body;

    try {
      const newLGA = await LGA.create({ name });

      return res.status(201).json({
        success: true,
        message: "LGA created successfully",
        data: newLGA,
      });

    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error creating LGA",
        error: error.message,
      });
    }
  }

  static async getAll(_req: Request, res: Response) {
    try {
      const allLGAs = await LGA.find({});

      return res.status(200).json({
        success: true,
        message: "All LGAs fetched successfully",
        total: allLGAs.length,
        data: allLGAs,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving LGAs",
        error: error.message,
      });
    }
  }

  static async getById(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const lga = await LGA.findById(id);

      if (!lga) {
        return res.status(404).json({
          success: false,
          message: "LGA not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "LGA fetched successfully",
        lga,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving LGA",
        error: error.message,
      });
    }
  }

  static async update(req: Request, res: Response) {
    const { id } = req.params;
    const { name } = req.body;

    try {
      const updatedLGA = await LGA.findByIdAndUpdate(
        id,
        { name },
        { new: true, runValidators: true },
      );

      if (!updatedLGA) {
        return res.status(404).json({
          success: false,
          message: "LGA not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "LGA updated successfully",
        data: updatedLGA,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error updating LGA",
        error: error.message,
      });
    }
  }

  static async delete(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const deletedLGA = await LGA.findByIdAndDelete(id);

      if (!deletedLGA) {
        return res.status(404).json({
          success: false,
          message: "LGA not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "LGA deleted successfully",
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error deleting LGA",
        error: error.message,
      });
    }
  }
}
