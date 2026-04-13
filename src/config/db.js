import mongoose from "mongoose";
import { ENV } from "./env.js";

export const connectDB = async () => {
  try {
    const conn = await mongoose.connect(ENV.DB_URL);
    // console.log("connected mmes", conn);
  } catch (error) {
    console.error("MongoDB Connection Error: ", error);
    process.exit(1);
  }
};
