import { Request, Response } from "express";
import { AssociationModel } from "../../models/Association";
import { withMongoTransaction } from "../../utils/mongoTransaction";
import { PaymentTypeModel } from "../../models/PaymentType";
import { WalletService } from "../../services/wallet.service";
import { UserModel } from "../../models/User";
import { RoleName } from "../../types";
import { DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_PAGE } from "../../utils/constants";
import { isValid } from "date-fns";
import mongoose, { isValidObjectId } from "mongoose";
import { body, validationResult } from "express-validator";
import MonnifySupportedBankModel from "../../models/MonnifySupportedBank";
import { PaymentDetailsModel } from "../../models/PaymentDetail";

export class Associations {
  static async create(req: Request, res: Response) {
    const {
      name,
      code,
      phoneNumber,
      type, //tax type > paymentType model id
      email,
      accountName,
      accountNumber,
      bankCode,
    } = req.body;

    const userId = req.headers["userid"] as string;

    // validate inputs via express-validator
    const validationErrors = [
      body("name").notEmpty().withMessage("Name is required"),
      body("code").notEmpty().withMessage("Code is required"),
      body("phoneNumber").notEmpty().withMessage("Phone number is required"),
      body("type").notEmpty().withMessage("Tax type is required").isMongoId().withMessage("Invalid tax type id"),
      body("email").notEmpty().withMessage("Email is required").isEmail().withMessage("Invalid email"),
      body("accountName").notEmpty().withMessage("Account name is required"),
      body("accountNumber")
        .notEmpty()
        .withMessage("Account number is required")
        .isNumeric()
        .withMessage("Account number must be numeric"),
      body("bankCode").notEmpty().withMessage("Bank code is required"),
    ]
    
    await Promise.all(validationErrors.map((validationError) => validationError.run(req)));

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()?.[0]?.msg,
        errors: errors.array(),
      });
    }



    try {
      const result = await withMongoTransaction(async (session) => {
        const taxType = await PaymentTypeModel.findById(type).session(session);

        if (!taxType) {
          throw {
            code: 400,
            message: "Tax type does not exist",
          };
        }

        const existingAssociationUserAccount = await UserModel.findOne({
          $or: [{ email }, { phoneNumber }],
        }).session(session);

        const existingAssociation = await AssociationModel.findOne({
          $or: [{ name }, { phoneNumber }, { code }],
        });

        if (existingAssociationUserAccount || existingAssociation) {
          throw {
            code: 400,
            message: "Association already registered",
          };
        }

        const userAccountData = {
          fullName: name,
          email,
          phoneNumber,
          role: RoleName.Association,
          password: phoneNumber,
          createdBy: userId,
        };

        const newUserAccount = await UserModel.create([userAccountData], {
          session,
        });

        const wallet = await WalletService.createEarningsWallet(
          newUserAccount[0]._id,
          session
        );

        const associationData = {
          name,
          userId: newUserAccount[0]._id,
          phoneNumber,
          code,
          type,
          wallet: wallet?.[0]?._id,
          createdBy: userId,
        };

        const newAssociation = await AssociationModel.create(
          [associationData],
          {
            session,
          }
        );

        // create association payment details > save assoc bank details
        const selectedBank = await MonnifySupportedBankModel.findOne({
          code: bankCode
        }).session(session);

        if (!selectedBank) {
          throw {
            code: 400,
            message: "Invalid bank code",
          };
        }

        const paymentDetails = {
          accountName, 
          bankName: selectedBank?.name,
          accountNumber,
          bankCode,
          owner: newUserAccount[0]._id,
        }

        await PaymentDetailsModel.create([paymentDetails], { session });

        return newAssociation[0];
      });

      res.status(201).json({
        success: true,
        message: "Association created successfully",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "There was a problem creating association",
        error: error?.message,
      });
    }
  }

  static async getById(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const association = await AssociationModel.findById(id);

      if (!association) {
        return res
          .status(404)
          .json({ success: false, message: "Association Not Found" });
      }

      return res.status(200).json({
        success: true,
        message: "Association data fetched successfully",
        data: association,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "There was a problem getting association details",
      });
    }
  }

  static async getAllAssociations(req: Request, res: Response) {
    const {
      name,
      code,
      phoneNumber,
      type,
      email,
    }: {
      name?: string;
      code?: string;
      phoneNumber?: string;
      type?: string;
      email?: string;
    } = req.query;

    const page = parseInt(req.query.page as string) || DEFAULT_QUERY_PAGE;
    const limit = parseInt(req.query.limit as string) || DEFAULT_QUERY_LIMIT;
    const skip = (Number(page) - 1) * Number(limit);

    if (type && !isValidObjectId(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid type id",
      });
    }

    try {
      const result = await withMongoTransaction(async (session) => {
        const query: any = {};

        if (name) {
          query["name"] = new RegExp(name, "i");
        }

        if (code) {
          query["code"] = new RegExp(code, "i");
        }

        if (phoneNumber) {
          query["phoneNumber"] = phoneNumber;
        }

        if (type) {
          query["type"] = new mongoose.Types.ObjectId(type);
        }

        if (email) {
          query["email"] = new RegExp(email, "i");
        }

        const associations = await AssociationModel.find(query)
          .populate({
            path: "type",
            select: "name",
          })
          .populate({
            path: "createdBy",
            select: "fullName email",
          })
          .skip(skip)
          .limit(limit)
          .sort({ createdAt: -1 })
          .session(session);
        const totalAssociations = await AssociationModel.countDocuments(
          query
        ).session(session);

        return {
          associations,
          totalAssociations,
        };
      });

      return res.status(200).json({
        success: true,
        message: "Associations fetched successfully",
        page,
        total: result.totalAssociations,
        totalPages: Math.ceil(result.totalAssociations / limit),
        data: result.associations,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "There was a problem fetching associations list",
      });
    }
  }

  static async updateAssociation(req: Request, res: Response) {
    const { id } = req.params;
    const { name, code, phoneNumber, type } = req.body;

    if (type && !isValidObjectId(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid type id",
      });
    }




    try {

      const result = await withMongoTransaction(async (session) => {

        if (type) {
          const existingTaxType = await PaymentTypeModel.findOne({ _id: type }).session(session);

          if (!existingTaxType) {
            throw { code: 400, message: "Tax type does not exist" };
          }
        }

        const existingAssociation = await AssociationModel.findOne({
          _id: { $ne: id },
          $or: [{ name }, { phoneNumber }, { code }],
        }).session(session);

        if (existingAssociation) {
          throw { code: 400, message: "Association already registered" };
        }

        const association = await AssociationModel.findByIdAndUpdate(
          id,
          { name, code, phoneNumber, type },
          { new: true, runValidators: true, session }
        );

        if (!association) {
          throw { code: 404, message: "Association not found" };
        }

        return association;


      });

      res.status(200).json({
        success: true,
        message: "Association updated successfully",
        data: result
      });
     
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "There was a problem updating association info",
      });
    }
  }

  static async deleteAssociation(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const association = await AssociationModel.findByIdAndDelete(id);

      if (!association) {
        return res
          .status(404)
          .json({ success: false, message: "Association Not Found" });
      }

      const deletedAssociation = await AssociationModel.findByIdAndDelete(id);

      res.status(200).json({
        success: false,
        message: "Association deleted successfully",
        data: deletedAssociation,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "There was a problem executing delete action",
      });
    }
  }
}
