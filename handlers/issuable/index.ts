import { Request, Response } from "express";
import { Issuable } from "../../models/Issuable";
import { DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_PAGE } from "../../utils/constants";
import { withMongoTransaction } from "../../utils/mongoTransaction";

export class Issuables {
  static async create(req: Request, res: Response) {
    const { name, description } = req.body;

    try {
      // Check if an issuable with the same name already exists
      const existingIssuable = await Issuable.findOne({ name });
      if (existingIssuable) {
        return res.status(400).json({
          success: false,
          message: "An issuable with this name already exists",
        });
      }

      // If no duplicate found, create the new issuable
      const newIssuable = await Issuable.create({ name, description });

      return res.status(201).json({
        success: true,
        message: "Issuable created successfully",
        issuable: newIssuable,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error creating Issuable",
        error: error.message,
      });
    }
  }

  static async getAll(req: Request, res: Response) {
    const {
      page = DEFAULT_QUERY_PAGE,
      limit = DEFAULT_QUERY_LIMIT,
      name,
      description,
    } = req.query;

    const query: any = {};

    if (name) {
      query.name = { $regex: name, $options: "i" };
    }

    if (description) {
      query.description = { $regex: description, $options: "i" };
    }

    try {
      const result = await withMongoTransaction(async (session) => {
        const allIssuables = await Issuable.find(query)
          .skip((Number(page) - 1) * Number(limit))
          .limit(Number(limit))
          .session(session);
        const totalItems = await Issuable.countDocuments(query).session(
          session
        );

        return {
          allIssuables,
          totalItems,
        };
      });

      return res.status(200).json({
        success: true,
        message: "All Issuables fetched successfully",
        total: result.totalItems,
        page,
        totalPages: Math.ceil(result.totalItems / Number(limit)),
        data: result.allIssuables,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving Issuables",
        error: error.message,
      });
    }
  }

  static async getById(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const issuable = await Issuable.findById(id);

      if (!issuable) {
        return res.status(404).json({
          success: false,
          message: "Issuable not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Issuable fetched successfully",
        issuable,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving Issuable",
        error: error.message,
      });
    }
  }

  static async update(req: Request, res: Response) {
    const { id } = req.params;
    const { name, description } = req.body;

    const updateQuery: any = {};

    if (name) {
      updateQuery.name = name;
    }

    if (description) {
      updateQuery.description = description;
    }

    try {
      const updatedIssuable = await Issuable.findByIdAndUpdate(
        id,
        { ...updateQuery },
        { new: true, runValidators: true }
      );

      if (!updatedIssuable) {
        return res.status(404).json({
          success: false,
          message: "Issuable not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Issuable updated successfully",
        issuable: updatedIssuable,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error updating Issuable",
        error: error.message,
      });
    }
  }

  static async delete(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const deletedIssuable = await Issuable.findByIdAndDelete(id);

      if (!deletedIssuable) {
        return res.status(404).json({
          success: false,
          message: "Issuable not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Issuable deleted successfully",
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error deleting Issuable",
        error: error.message,
      });
    }
  }
}
