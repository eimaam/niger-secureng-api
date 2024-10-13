import { Request, Response } from "express";
import LgaHead from "../../models/LgaHeads";
import { LGA } from "../../models/Lga";
import { isValidObjectId } from "mongoose";
import { withMongoTransaction } from "../../utils/mongoTransaction";

export class LGAHeads {
  static async create(req: Request, res: Response) {
    const { fullName, phoneNumber, lga } = req.body;

    const userId = req.headers["userid"] as string;

    if (!isValidObjectId(lga))
      return res.status(400).json({
        success: false,
        message: "Invalid LGA ID",
      });

    if (!fullName || !phoneNumber || !lga) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    try {
      const result = await withMongoTransaction(async (session) => {
        // Check if the LGA head already exists
        const existingLGAHead = await LgaHead.findOne({ phoneNumber }).session(
          session
        );

        if (existingLGAHead)
          return res.status(400).json({
            success: false,
            message: "LGA Head with the provided details already exists",
          });

        const existingLGA = await LGA.findById(lga).session(session);

        if (!existingLGA) {
          return res.status(404).json({
            success: false,
            message: "LGA not found",
          });
        }

        const data = {
          fullName,
          phoneNumber,
          lga,
          createdBy: userId,
        };

        // If not, create a new LGA head
        const newLGAHead = await LgaHead.create([data], { session });

        return newLGAHead[0];
      });

      return res.status(201).json({
        success: true,
        message: "LGA Head created successfully",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error creating LGA Head",
        error: error.message,
      });
    }
  }

  static async getAll(_req: Request, res: Response) {
    try {
      const allLGAHeads = await LgaHead.find({}).populate("lga");

      return res.status(200).json({
        success: true,
        message: "All LGA Heads fetched successfully",
        total: allLGAHeads.length,
        data: allLGAHeads,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving LGA Heads",
        error: error,
      });
    }
  }

  static async getById(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const lgaHead = await LgaHead.findById(id);

      if (!lgaHead) {
        return res.status(404).json({
          success: false,
          message: "LGA Head not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "LGA Head fetched successfully",
        data: lgaHead,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving LGA Head",
        error: error.message,
      });
    }
  }

  static async update(req: Request, res: Response) {
    const { id } = req.params;
    const { fullName, lga, phoneNumber } = req.body;

    try {
      const updatedLGAHead = await LgaHead.findByIdAndUpdate(
        id,
        { ...req.body },
        { new: true, runValidators: true }
      );

      if (!updatedLGAHead) {
        return res.status(404).json({
          success: false,
          message: "LGA Head not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "LGA Head updated successfully",
        data: updatedLGAHead,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error updating LGA Head",
        error: error.message,
      });
    }
  }

  static async delete(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const deletedLGAHead = await LgaHead.findByIdAndDelete(id);

      if (!deletedLGAHead) {
        return res.status(404).json({
          success: false,
          message: "LGA Head not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "LGA Head deleted successfully",
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error deleting LGA Head",
        error: error.message,
      });
    }
  }
}
