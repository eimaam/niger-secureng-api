import { check } from "express-validator";

export const emailValidator = [
    check("email")
        .exists()
        .withMessage("Email is required")
        .isEmail()
        .withMessage("Invalid email address"),
];