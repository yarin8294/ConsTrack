import mongoose from "mongoose";
/**
 * Establishes a connection to the MongoDB database using Mongoose.
 * 
 * This function retrieves the connection URI from the `MONGODB_URI` environment variable.
 * If the variable is missing, it throws an error to prevent starting without a database.
 * 
 * @returns {Promise<mongoose.Connection>} The active Mongoose connection object.
 * @throws {Error} If `MONGODB_URI` environment variable is not defined.
 */
export async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is required. Set it to your MongoDB Atlas connection string.");
  }
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  console.log("Connected to MongoDB Atlas");
  return mongoose.connection;
}
