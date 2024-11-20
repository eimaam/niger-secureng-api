import mongoose, { ClientSession, isValidObjectId } from "mongoose";
import { UserModel } from "../models/User";
import { IUser, RoleName } from "../types";
import { generatePassword, hashData } from "../utils";

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

  static async resetUserPassword(userId: mongoose.Types.ObjectId | string, session?: ClientSession) {

    const mongoSession = session ?? null;

    try {
      if (!isValidObjectId(userId)) {
        throw new Error("Invalid user ID");
      }

      const newPassword = generatePassword();

      // hash the new password
      const hashedPassword = await hashData(newPassword);

      // update the user password and set the isDefaultPassword to true to allow for user to change to their desired password after login
      const user = await UserModel.findByIdAndUpdate(
        userId,
        { password: hashedPassword, 
          isDefaultPassword: true,
        },
        { session: mongoSession, runValidators: true, new: true }
      );

      const data = {
        ...user?.toObject(),
        // returning the new password to be sent to the user
        password: newPassword,
      }

      return data;
    } catch (error) {
      console.error("Error resetting user password: ", error);
      throw new Error("Error resetting user password");
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
