import { NextFunction, Request, Response } from "express";
import { UserModel } from "../models/User";

export const checkUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const { userId } = req.body;

  try {
    if (!userId) {
      return res.status(400).json({
        success: false,
        message:
          "Request body is either missing userId or incorrect userId is passed.",
      });
    }

    const user = await UserModel.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User Not Found" });
    }
  } catch (error) {
    console.log("There was a problem checking user", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error: Problem checking User",
    });
  }

  next();
};
