import { Request, Response } from "express";
import { Beneficiary, PaymentTypeModel } from "../../models/PaymentType";
import { withMongoTransaction } from "../../utils/mongoTransaction";
import { body, validationResult } from "express-validator";
import { DEFAULT_QUERY_LIMIT, DEFAULT_QUERY_PAGE } from "../../utils/constants";
import { RoleName } from "../../types";

export class BeneficiaryController {
    // Create a new beneficiary
    static async createBeneficiary(req: Request, res: Response) {
        // Validation middleware
        const validateBeneficiary = [
          body('role')
            .isIn(Object.values(RoleName))
            .withMessage('Invalid role'),
          body('percentage')
            .isFloat({ min: 0, max: 100 })
            .withMessage('Percentage must be between 0 and 100'),
        ];
    
        // Run validation
        await Promise.all(validateBeneficiary.map(validation => validation.run(req)));
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
        }
    
        const { role, percentage } = req.body;
        const userId = req.headers["userid"] as string;
    
        try {
          // Check if beneficiary with same role and percentage exists
          const existingBeneficiary = await Beneficiary.findOne({ role, percentage });
          if (existingBeneficiary) {
            return res.status(400).json({
              success: false,
              message: "A beneficiary with the same role and percentage already exists",
            });
          }
    
          // Create new beneficiary if it doesn't exist
          const newBeneficiary = await Beneficiary.create({ role, percentage, createdBy: userId });
          
          return res.status(201).json({
            success: true,
            message: "Beneficiary created successfully",
            data: newBeneficiary,
          });
        } catch (error:any) {
          return res.status(500).json({ 
            success: false, 
            message: "Error creating beneficiary",
            error: error.message
          });
        }
      }
    
    //   get all beneficiaries 
    // apply filters if provided 
    static async getAllBeneficiaries(req: Request, res: Response) {
        const { role, percentage } = req.query;

        try {
            const page = parseInt(req.query.page as string);
            const limit = parseInt(req.query.limit as string);
            const skip = Number((page - 1) * limit);

            let query = Beneficiary.find();
            let totalBeneficiaries = 0;
            let result;

             // Apply filters if provided
        if (role) {
            query = query.where('role').equals(role);
        }
        if (percentage) {
            query = query.where('percentage').equals(parseFloat(percentage as string));
        }

            if (page && limit) {
                totalBeneficiaries = await Beneficiary.countDocuments(query);
                const skipAmount = skip !== undefined ? skip : (page - 1) * limit;
                query = query.skip(skipAmount).limit(limit);

                result = await query.exec();

                const totalPages = Math.ceil(totalBeneficiaries / limit);

                return res.status(200).json({
                    success: true,
                    message: "Beneficiaries Fetched Successfully",
                    data: result,
                    page,
                    totalPages,
                    total: totalBeneficiaries,
                });
            } else {
                // Fetch all beneficiaries without pagination
                result = await query.exec();
                totalBeneficiaries = result.length;

                return res.status(200).json({
                    success: true,
                    message: "All Beneficiaries Fetched Successfully",
                    data: result,
                    total: totalBeneficiaries,
                });
            }
        } catch (error:any) {
            return res
                .status(500)
                .json({ success: false, message: "Error Fetching Beneficiaries", error: error?.message });
        }
    }

    // Get beneficiary by ID
    static async getById(req: Request, res: Response) {
        const { id } = req.params;

        try {
            const beneficiary = await Beneficiary.findById(id);
            if (!beneficiary) {
                return res.status(404).json({ success: false, message: "Beneficiary not found" });
            }

            return res.status(200).json({
                success: true,
                data: beneficiary
            });
        } catch (error:any) {
            console.log("Get beneficiary by ID error: ", error);
            return res.status(500).json({ success: false, message: "Server error" });
        }
    }

    // Update a beneficiary
    static async update(req: Request, res: Response) {
        const { id } = req.params;
        const { percentage, paymentTypeId } = req.body;

        const validated = await body('percentage').isFloat({ min: 0, max: 100 }).run(req);
        if (!validated.isEmpty()) {
            return res.status(400).json({ success: false, message: "Invalid percentage" });
        }
    
        try {
          const result = await withMongoTransaction(async (session) => {
            // Find and update the beneficiary
            const updatedBeneficiary = await Beneficiary.findByIdAndUpdate(id, { percentage }, { new: true, session }).exec();
            if (!updatedBeneficiary) {
              throw new Error("Beneficiary not found");
            }
    
            // Update the total percentage for the associated PaymentType
            if (paymentTypeId) {
              // Find the PaymentType to which the beneficiary belongs
              const paymentType = await PaymentTypeModel.findById(paymentTypeId).session(session).exec();
              if (!paymentType) {
                throw new Error("Payment Type not found");
              }
    
              // Sum up the percentages of all beneficiaries in the payment type
              const beneficiaries = await Beneficiary.find({ _id: { $in: paymentType.beneficiaries.map(b => b.beneficiary) } }).exec();
              const totalPercentage = beneficiaries.reduce((sum, b) => sum + b.percentage, 0);
    
              if (totalPercentage > 100) {
                throw new Error("Total percentage of beneficiaries in Payment Type cannot exceed 100%");
              }
            }
    
            return {
              message: "Beneficiary updated successfully",
              data: updatedBeneficiary
            };
          });
    
          return res.status(200).json({
            success: true,
            ...result
          });
        } catch (error: any) {
          console.error("Update beneficiary error: ", error);
          return res.status(500).json({ success: false, message: error.message });
        }
      }

    // Delete a beneficiary
    static async delete(req: Request, res: Response) {
        const { id } = req.params;

        try {
            const result = await withMongoTransaction(async (session) => {

                const beneficiary = await Beneficiary.findById(id).session(session);
                if (!beneficiary) {
                    throw new Error("Beneficiary not found");
                }

                const existingPaymentType = await PaymentTypeModel.findOne({ beneficiaries: { $elemMatch: { beneficiary: id } } }).session(session);

                if (existingPaymentType) {
                    throw new Error("Beneficiary cannot be deleted as it is associated with a payment type. Remove the beneficiary from the payment type first.");
                }
                

                // Find and delete the beneficiary
                const deletedBeneficiary = await Beneficiary.findByIdAndDelete(id).session(session);
                if (!deletedBeneficiary) {
                    throw new Error("The beneficiary could not be deleted");
                }
               

               return deletedBeneficiary;
            });

            return res.status(200).json({
                success: true,
                message: "Beneficiary deleted successfully",
                data: result
            });
        } catch (error:any) {
            console.log("Delete beneficiary error: ", error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}
