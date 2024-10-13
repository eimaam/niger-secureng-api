import mongoose, { ClientSession } from "mongoose";

export const withMongoTransaction = async (
  callback: (session: ClientSession) => Promise<any>
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const result = await callback(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    // Check if transaction is active before aborting
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    session.endSession();
  }
};
