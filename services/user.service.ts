import mongoose, { ClientSession, isValidObjectId } from "mongoose";
import { UserModel } from "../models/User";
import { IUser, RoleName } from "../types";

export class UserService {
  static async getUserById(userId: mongoose.Types.ObjectId | string, session?: ClientSession) {
    if (!isValidObjectId(userId)) {
      throw new Error("Invalid user ID");
    }

    try {
      const mongoSession = session ?? null;
      const user = await UserModel.findById(userId, null, {
        session: mongoSession,
      });

      if (!user) {
        throw new Error("User not found");
      }

      return user;
    } catch (error) {
      console.error("Error fetching user: ", error);
      throw new Error("Error fetching user");
    }
  }

  static async getSuperAdmin(session?: ClientSession) {
    try {
      const mongoSession = session ?? null;

      const superAdmin: IUser = (await UserModel.findOne(
        { role: RoleName.SuperAdmin },
        null,
        { session: mongoSession }
      )) as IUser;

      if (!superAdmin) {
        throw new Error("Super Admin Account Not Found");
      }

      return superAdmin;
    } catch (error) {
      throw new Error("Error fetching super admin");
    }
  }
}
