import { check } from "express-validator";

export const resetPasswordValidator = [
    check("password")
        .exists()
        .withMessage("Password is required")
        .isLength({ min: 6 })
        .withMessage("Password must be at least 6 characters"),
    check("token")
        .exists()
        .withMessage("Token is required")
        .isString()
        .withMessage("Token must be a string"),
]

