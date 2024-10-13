import { Request, Response, NextFunction } from "express";
import { UserService } from "../services/user.service";
import { RoleName } from "../types";
import mongoose from "mongoose";
import { UserModel } from "../models/User";

const DEFAULT_ALLOWED_ROLES: RoleName[] = [RoleName.SuperAdmin, RoleName.Developer];

export const checkRole = (allowedRoles?: RoleName[] | string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.headers["userid"] as string;

    if (!userId) {
      return res.status(400).json({ message: "userId is required." });
    }

    try {
      // Fetch the user using the userId
      const user = await UserModel.findById(userId);

      // Check if the user exists
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      // Combine allowed roles with default allowed roles
      const rolesToCheck = Array.isArray(allowedRoles)
        ? [...allowedRoles, ...DEFAULT_ALLOWED_ROLES]
        : [allowedRoles, ...DEFAULT_ALLOWED_ROLES];

      if (rolesToCheck.includes(user.role)) {
        next();
      } else {
        res.status(403).json({
          success: false,
          message:
            "Access denied. You do not have sufficient permissions to perform this action",
        });
      }
    } catch (error:any) {
      console.error("Error fetching user: ", error?.message);
      res.status(500).json({ success: false, message: "Error fetching user." });
    }
  };
};
