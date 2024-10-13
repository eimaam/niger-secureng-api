import mongoose, { ClientSession, isValidObjectId } from "mongoose";
import { UserModel } from "../models/User";
import { RoleName } from "../types";
import { withMongoTransaction } from "../utils/mongoTransaction";
import {
  Beneficiary,
  IBeneficiary,
  IPaymentType,
  PaymentTypeModel,
} from "../models/PaymentType";

export class BeneficiaryService {
  static async getMainBeneficiaries(
    associationId: string,
    session?: ClientSession
  ) {
    if (!isValidObjectId(associationId))
      throw new Error("Invalid association ID");

    const mongoSession = session ?? null;

    const [consultant, government, association, stakeholder] = await Promise.all([
      UserModel.findOne({ role: RoleName.SuperAdmin }).session(mongoSession),
      UserModel.findOne({ role: RoleName.Government }).session(mongoSession),
      // TODO: find a way to handle stakeholder role in the future > we do not have just a single stakeholder, accounts with stakeholder role might be several just like associations
      UserModel.findOne({ role: RoleName.Stakeholder }).session(mongoSession),
      UserModel.findById(associationId).session(mongoSession),
    ]);

    if (!consultant || !government || !association || !stakeholder) {
      throw new Error("Main beneficiaries not found");
    }

    return [consultant, government, association, stakeholder];
  }

  static async getBeneficiariesByPaymentType(
    paymentTypeId: string,
    session?: ClientSession
  ) {
    const mongoSession = session ?? null;

    if (!paymentTypeId || !isValidObjectId(paymentTypeId)) {
      throw new Error("Invalid payment type ID");
    }

    try {
      const paymentType = await PaymentTypeModel.findById(paymentTypeId)
        .populate("beneficiaries.beneficiary")
        .session(mongoSession);

      if (!paymentType) {
        throw new Error("Payment type not found");
      }

      const beneficiaryList = paymentType?.beneficiaries.map(
        (b) => b.beneficiary
      ) as Partial<IBeneficiary>[];

      const beneficiaryRoles = beneficiaryList?.map((b) => b.role);

      const beneficiaryAccounts = await UserModel.find({
        role: { $in: beneficiaryRoles },
      });

      await BeneficiaryService.validateBeneficiaryPercentages(
        beneficiaryAccounts,
        paymentType,
        session
      );

      let beneficiariesAndPercentages: {
        userId: mongoose.Types.ObjectId;
        percentage: number;
      }[] = [];

      for (const beneficiary of beneficiaryAccounts) {
        const beneficiaryInBeneficiaryDB = await Beneficiary.findOne({
          role: beneficiary.role,
          _id: { $in: paymentType.beneficiaries.map((b) => b.beneficiary) },
        }).session(mongoSession);

        if (!beneficiaryInBeneficiaryDB) {
          throw new Error(
            `Beneficiary with role ${beneficiary.role} not found in beneficiaries collection`
          );
        }

        beneficiariesAndPercentages.push({
          userId: beneficiary._id,
          percentage: beneficiaryInBeneficiaryDB.percentage,
        });
      }

      return beneficiariesAndPercentages;
    } catch (error: any) {
      console.error(
        "Error fetching beneficiaries by payment type:",
        error.message
      );
      throw new Error(error.message);
    }
  }
  // Helper to validate beneficiary percentages
  static async validateBeneficiaryPercentages(
    beneficiariesAccount: IBeneficiary[],
    // with populated beneficiaries
    // required that the payment type is sent with the beneficiary populated
    paymentType: IPaymentType,
    session?: ClientSession
  ) {
    const mongoSession = session ?? null;

    let totalPercentage = 0;

    // Extract beneficiary IDs from paymentType
    // get only the beneficiary types in the target payment type > this ensures the correct percentages are fetched for the roles
    const beneficiaryIds = paymentType.beneficiaries.map((b) => b.beneficiary);
    // Fetch the beneficiaries from the database
    const beneficiaries = await Beneficiary.find({
      _id: { $in: beneficiaryIds },
    }).session(mongoSession);

    // Create a map of fetched beneficiaries for quick lookup
    const beneficiaryMap = new Map<string, IBeneficiary>(
      beneficiaries.map((b) => [b._id.toString(), b])
    );

    if (beneficiaryIds.length !== beneficiaries.length) {
      throw new Error("Not all beneficiary IDs are valid");
    }

    for (const beneficiary of beneficiariesAccount) {
      // Look up the beneficiary by role
      const beneficiaryInBeneficiaryDB = [...beneficiaryMap.values()].find(
        (b) => b.role === beneficiary.role
      );

      if (!beneficiaryInBeneficiaryDB) {
        throw new Error(
          `Beneficiary with role ${beneficiary.role} not found in beneficiaries collection`
        );
      }

      const beneficiaryInPaymentType = paymentType.beneficiaries.find(
        (b: any) =>
          b.beneficiary.toString() ===
            (beneficiaryInBeneficiaryDB as any)._id.toString() ||
          (b.beneficiary._id &&
            b.beneficiary._id.toString() ===
              (beneficiaryInBeneficiaryDB as any)._id.toString())
      );

      if (!beneficiaryInPaymentType) {
        throw new Error(
          `Beneficiary with role ${beneficiary.role} is not a beneficiary in payment type`
        );
      }
      // Use the percentage from the payment type, not from the beneficiary DB
      const percentage = (beneficiaryInPaymentType.beneficiary as any)
        .percentage;
      if (percentage > 100) {
        throw new Error(
          `Invalid percentage value ${percentage} for role ${beneficiary.role}`
        );
      }
      // Accumulate the total percentage
      totalPercentage += percentage;
    }

    // Check if the total percentage sums up to 100
    if (totalPercentage !== 100) {
      throw new Error(
        `Total percentage of beneficiaries is ${totalPercentage}%, but should be exactly 100%`
      );
    }
  }


  // helper to revalidate beneficiaries > it ensures that the beneficiaries are valid and the percentages are correct
  // only checks the beneficiary ids and percentages from the beneficiary collection only 
  static async revalidateBeneficiaries(beneficiaryIds: string[], session?: any) {
    let totalPercentage = 0;
    const validatedBeneficiaries = [];

    for (const beneficiaryId of beneficiaryIds) {
      if (!isValidObjectId(beneficiaryId)) {
        throw new Error(`Invalid beneficiary ID: ${beneficiaryId}`);
      }

      const beneficiary = await Beneficiary.findById(beneficiaryId).session(session);
      if (!beneficiary) {
        throw new Error(`Beneficiary not found with ID: ${beneficiaryId}`);
      }

      totalPercentage += beneficiary.percentage;
      validatedBeneficiaries.push({ beneficiary: beneficiaryId, percentage: beneficiary.percentage });
    }

    if (totalPercentage !== 100) {
      throw new Error(`Total percentage of beneficiaries must be exactly 100%. Current total: ${totalPercentage}`);
    }

    return validatedBeneficiaries;
  }
}
