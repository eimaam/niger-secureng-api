import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";

export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array().map((error) => ({
        path: (error as any)?.path,
        message: error?.msg
      }))
    });
    return;
    }
    next();
};
