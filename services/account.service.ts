import { isValidObjectId } from "mongoose";
import { withMongoTransaction } from "../utils/mongoTransaction";
import { UserModel } from "../models/User";

export class AccountService {
  static async deleteAccount(userId: string) {
    if (!userId || !isValidObjectId(userId)) {
      throw new Error("Invalid user ID");
    }

    const result = await withMongoTransaction(async (session) => {
      // Delete user account
      const user = await UserModel.findByIdAndDelete(userId).session(session);

      if (!user) {
        throw new Error("User not found");
      }
    });
  }
}
