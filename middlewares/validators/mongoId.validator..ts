import { check } from "express-validator";
export const validateMongoId = (field: string) =>
  check(field)
    .exists()
    .withMessage(`${field} is required`)
    .isMongoId()
    .withMessage(`${field} is not a valid mongo id`)
    .bail();
