import mongoose, { ClientSession, isValidObjectId } from "mongoose";
import {
  BeneficiaryModel,
  IBeneficiary,
  PaymentTypeModel,
} from "../models/PaymentType";

function hasCircularReference(obj: any): boolean {
  try {
    JSON.stringify(obj);
    return false; // If no error, then it's not circular
  } catch (err) {
    return true; // If JSON.stringify throws, it's circular
  }
}

export class BeneficiaryService {
/**
 * Fetch beneficiaries by payment type
 * @param paymentTypeId The payment type ID
 * @param query The query to filter the beneficiaries
 * @param session 
 * @returns The list of beneficiaries with their user IDs and percentages
 */
  static async getBeneficiariesByPaymentType(
    paymentTypeId: mongoose.Types.ObjectId,
    query?: any,
    session?: ClientSession
  ) {
    const mongoSession = session ?? null;
    if (!paymentTypeId || !isValidObjectId(paymentTypeId)) {
      throw new Error("Invalid payment type ID");
    }

    try {
      // Fetch the payment type with populated beneficiaries (user ids)
      const paymentType = await PaymentTypeModel.findById(paymentTypeId)
        .session(mongoSession);

      if (!paymentType) {
        throw new Error("Payment type not found");
      }
      const beneficiaryQuery = {
        paymentType: paymentTypeId,
        ...(query && !hasCircularReference(query) ? query : {}), 
      };
      
      // get the beneficiaries list and pass the query if it exists
      const beneficiariesList = await BeneficiaryModel.find(beneficiaryQuery).session(mongoSession);      

      if (!beneficiariesList || beneficiariesList.length === 0) {
        throw new Error("No beneficiaries found for the payment type");
      }

      // Validate percentages of the beneficiaries
      await BeneficiaryService.validateBeneficiaryPercentages(
        beneficiariesList,
      );

      const beneficiariesWithPercentages = beneficiariesList.map((b) => ({
        user: b.user,
        percentage: b.percentage,
        paymentType: b.paymentType,
      }));

      return beneficiariesWithPercentages;
    } catch (error: any) {
      console.error(
        "Error fetching beneficiaries by payment type:",
        error
      );
      throw new Error(error.message);
    }
  }

  // Validate that the total percentages sum up to 100%
  static async validateBeneficiaryPercentages(
    beneficiaries: Pick<IBeneficiary, "user" | "percentage">[]
  ) {
    const totalPercentage = beneficiaries.reduce((sum, b) => sum + b.percentage, 0);

    if (totalPercentage !== 100) {
      throw new Error("Total percentage of beneficiaries must sum up to 100%");
    }
  }

  // Revalidate beneficiaries based on user IDs, not roles
  static async revalidateBeneficiaries(
    beneficiaryIds: string[],
    session?: any
  ) {
    let totalPercentage = 0;
    const validatedBeneficiaries = [];

    for (const beneficiaryId of beneficiaryIds) {
      if (!isValidObjectId(beneficiaryId)) {
        throw new Error(`Invalid beneficiary ID: ${beneficiaryId}`);
      }

      const beneficiary = await BeneficiaryModel.findById(beneficiaryId).session(
        session
      );
      if (!beneficiary) {
        throw new Error(`Beneficiary not found with ID: ${beneficiaryId}`);
      }

      totalPercentage += beneficiary.percentage;
      validatedBeneficiaries.push({
        beneficiary: beneficiaryId,
        percentage: beneficiary.percentage,
      });
    }

    if (totalPercentage !== 100) {
      throw new Error(
        `Total percentage of beneficiaries must be exactly 100%. Current total: ${totalPercentage}`
      );
    }

    return validatedBeneficiaries;
  }
}
