import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/";
const DB_NAME   = "ecommerce"; // change if your DB has a different name

async function seed() {
  await mongoose.connect(MONGO_URI + DB_NAME);
  console.log("Connected to MongoDB:", MONGO_URI + DB_NAME);

  const db = mongoose.connection.db;

  // ── 1. Create or update employee user ──
  const email    = "employee@test.com";
  const password = await bcrypt.hash("employee123", 12);

  const { value: user } = await db.collection("users").findOneAndUpdate(
    { email },
    {
      $set: {
        name:      "Test Employee",
        email,
        phone:     "9800000001",
        password,
        role:      "employee",
        isBlocked: false,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, returnDocument: "after" }
  );

  // findOneAndUpdate with upsert returns null value on insert in some drivers — re-fetch
  const finalUser = user || await db.collection("users").findOne({ email });
  console.log("✅ Employee user:", finalUser.email, "| role:", finalUser.role);

  // ── 2. Create or update employee profile ──
  await db.collection("employees").findOneAndUpdate(
    { user: finalUser._id },
    {
      $set: {
        user:            finalUser._id,
        shopName:        "Test Shop",
        shopDescription: "Dev test employee account",
        isVerified:      true,
        totalSales:      0,
        rating:          0,
        updatedAt:       new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );
  console.log("✅ Employee profile created/updated (isVerified: true)");

  console.log("\n─────────────────────────────────────");
  console.log("  Login credentials:");
  console.log("  Email   : employee@test.com");
  console.log("  Password: employee123");
  console.log("  URL     : http://localhost:3000/employee");
  console.log("─────────────────────────────────────\n");

  await mongoose.disconnect();
}

seed().catch(e => { console.error(e); process.exit(1); });
