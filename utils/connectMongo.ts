import mongoose from "mongoose";
import dotenv from "dotenv";

type NodeEnv = "development" | "production" | "test";

const NODE_ENV = process.env.NODE_ENV as NodeEnv;
const PROD_DB = process.env.PROD_MONGODB_URI as string;
const DEV_DB = process.env.DEV_MONGODB_URI as string;

const MONGODB_URI = NODE_ENV === "production" ? PROD_DB : DEV_DB;

export const connectMongoDB = async () => {
  try {
    if (!MONGODB_URI) {
      throw new Error("Missing db URI");
    }

    await mongoose.connect(MONGODB_URI, { connectTimeoutMS: 15000 });

    console.log("Connected to MongoDB > ", NODE_ENV);
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    // Exit the process if unable to connect
    process.exit(1);
  }

  // Handle disconnect events
  mongoose.connection.on("disconnected", () => {
    console.log("Disconnected from MongoDB. Reconnecting...");
    connectMongoDB();
  });

  // Handle connection error events
  mongoose.connection.on("error", (err) => {
    console.error("MongoDB connection error:", err);
  });
};
