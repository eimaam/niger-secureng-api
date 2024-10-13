import { Request, Response, NextFunction } from "express";
import { UserService } from "../services/user.service";
import { IUser } from "../types";
import { unauthenticatedRoutes } from "../utils/constants";
import { UserModel } from "../models/User";

export const isUnauthenticatedRoute = (path: string): boolean => {
  return unauthenticatedRoutes.some(route => {
    if (typeof route === 'string') {
      return route === path;
    } else if (route instanceof RegExp) {
      return route.test(path);
    }
    return false;
  });
};

export const checkPasswordChanged = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (isUnauthenticatedRoute(req.path)) {
    return next();
  }

  const userId = req.headers["userid"] as string;

  if (!userId) {
    return res.status(400).json({ message: "userId is required." });
  }

  // Exclude the endpoint for changing the default password
  const changePasswordPath = `/api/v1/users/${userId}/password`;
  if (req.path === changePasswordPath) {
    return next();
  }

  try {
    const user: IUser | null = await UserModel.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    if (user.isDefaultPassword) {
      return res.status(403).json({
        message:
          "You must change your password from the default before you can perform this action.",
      });
    }

    next();
  } catch (error:any) {
   return res.status(500).json({
    success: false,
    message: "Internal Server Error",
    error: error?.message
   })
  }
};
