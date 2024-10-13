import { Request, Response } from "express";
import { IStakeholder, StakeholderModel } from "../../models/Stakeholder";
import { UserModel } from "../../models/User";
import { RoleName } from "../../types";
import { EarningsWalletModel } from "../../models/Wallet";
import { generatePassword } from "../../utils";
import mongoose from "mongoose";
import { withMongoTransaction } from "../../utils/mongoTransaction";

export class Stakeholder {
  static async create(req: Request, res: Response) {
    const { userId, name, description, email, phoneNumber } = req.body;

    try {
      const result = await withMongoTransaction(async (session) => {
        const existingStakeholder = await StakeholderModel.findOne({
          name,
        }).session(session);
        const existingUser = await UserModel.findOne({ email }).session(
          session
        );
        const existingWallet = await EarningsWalletModel.findOne({
          owner: userId,
        }).session(session);

        if (existingStakeholder || existingUser || existingWallet) {
          throw { code: 400, message: "Stakeholder already registered" };
        }

        const newUserData = {
          fullName: name,
          phoneNumber,
          email,
          role: RoleName.Stakeholder,
          password: phoneNumber,
          createdBy: userId,
        };

        const newUserAccount = await UserModel.create([newUserData], {
          session,
        });
        const newWallet = await EarningsWalletModel.create(
          [{ owner: newUserAccount[0]._id }],
          { session }
        );
        const newStakeholder = await StakeholderModel.create(
          [
            {
              name,
              description,
              email,
              userId: newUserAccount[0]._id,
              wallet: newWallet[0]._id,
              createdBy: userId,
            },
          ],
          { session }
        );

        return newStakeholder[0];
      });

      return res.status(201).json({
        success: true,
        message: "Stakeholder created successfully",
        data: result,
      });
    } catch (error: any) {
      const errorMessage = error.message || "Error creating stakeholder";
      return res.status(500).json({
        success: false,
        message: errorMessage,
        error,
      });
    }
  }

  static async getOne(req: Request, res: Response) {
    const { id } = req.params;
    try {
      const stakeholder = await StakeholderModel.findById(id).populate(
        "userId"
      );
      if (!stakeholder) {
        return res.status(404).json({
          success: false,
          message: "Stakeholder not found",
        });
      }
      return res.status(200).json({
        success: true,
        data: stakeholder,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching stakeholder",
        error,
      });
    }
  }

  static async getAll(_req: Request, res: Response) {
    try {
      const stakeholders = await StakeholderModel.find({}).populate("userId");
      return res.status(200).json({
        success: true,
        message: "Stakeholders fetched successfully",
        data: stakeholders,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching stakeholders",
        error,
      });
    }
  }

  static async updateOne(req: Request, res: Response) {
    const { id } = req.params;
    const updateData: Partial<IStakeholder> = req.body;
    try {
      const result = await withMongoTransaction(async (session) => {
        const stakeholder = await StakeholderModel.findByIdAndUpdate(
          id,
          updateData,
          {
            new: true,
            runValidators: true,
            session,
          }
        );

        if (!stakeholder) {
          throw { code: 404, message: "Stakeholder not found" };
        }

        const updatedUser = await UserModel.findByIdAndUpdate(
          stakeholder.userId,
          { ...updateData, fullName: updateData.name },
          { new: true, runValidators: true, session }
        );

        if (!updatedUser) {
          throw { code: 404, message: "User not found" };
        }

        return stakeholder[0];
      });

      return res.status(200).json({
        success: true,
        message: "Stakeholder updated successfully",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error updating stakeholder",
        error,
      });
    }
  }

  static async delete(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const result = await withMongoTransaction(async (session) => {
        const stakeholder = await StakeholderModel.findByIdAndDelete(id, {
          session,
        });

        if (!stakeholder) {
          throw { code: 404, message: "Stakeholder not found" };
        }

        const user = await UserModel.findByIdAndDelete(stakeholder.userId, {
          session,
        });

        if (!user) {
          throw { code: 404, message: "User not found" };
        }

        return { stakeholder, user };
      });

      return res.status(200).json({
        success: true,
        message: "Stakeholder and associated user deleted successfully",
        data: result,
      });
    } catch (error: any) {
      const errorCode = error.code || 500;
      const errorMessage = error.message || "Error deleting stakeholder";
      return res.status(errorCode).json({
        success: false,
        message: errorMessage,
        error,
      });
    }
  }
}
