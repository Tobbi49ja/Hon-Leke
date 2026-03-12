const mongoose = require("mongoose");

let isConnected = false;

async function connectDB() {
  if (isConnected) return;

  // Production DB (Atlas / hosted)
  const productionURI = process.env.MONGODB_URI;

  // Local MongoDB fallback
  const localURI = "mongodb://127.0.0.1:27017/hon-leke";

  // Choose DB based on environment
  const uri =
    process.env.NODE_ENV === "production"
      ? productionURI
      : productionURI || localURI;

  if (!uri) {
    console.error("❌ No MongoDB URI provided.");
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    isConnected = true;

    console.log(
      `✅ MongoDB connected (${process.env.NODE_ENV || "development"}):`,
      mongoose.connection.host
    );
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  }
}

module.exports = connectDB;