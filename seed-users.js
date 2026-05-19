import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/";
const DB_NAME   = "ecommerce";

const users = [
  {
    name:  "Admin User",
    email: "admin@test.com",
    phone: "9800000000",
    password: "admin123",
    role: "admin",
  },
  {
    name:  "Test Employee",
    email: "employee@test.com",
    phone: "9800000001",
    password: "employee123",
    role: "employee",
  },
  {
    name:  "Test Customer",
    email: "user@test.com",
    phone: "9800000002",
    password: "user123",
    role: "user",
  },
];

async function seed() {
  await mongoose.connect(MONGO_URI + DB_NAME);
  console.log("Connected to MongoDB:", MONGO_URI + DB_NAME);
  const db = mongoose.connection.db;

  for (const u of users) {
    const hashed = await bcrypt.hash(u.password, 12);

    const { value: saved } = await db.collection("users").findOneAndUpdate(
      { email: u.email },
      {
        $set: {
          name:      u.name,
          email:     u.email,
          phone:     u.phone,
          password:  hashed,
          role:      u.role,
          isBlocked: false,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, returnDocument: "after" }
    );

    const finalUser = saved || await db.collection("users").findOne({ email: u.email });

    // Create employee profile for employee role
    if (u.role === "employee") {
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
    }

    console.log(`✅ ${u.role.toUpperCase().padEnd(8)} | ${u.email.padEnd(25)} | password: ${u.password}`);
  }

  console.log(`
──────────────────────────────────────────────────
  ADMIN      email: admin@test.com     pass: admin123
  EMPLOYEE   email: employee@test.com  pass: employee123
  USER       email: user@test.com      pass: user123

  Admin panel  : http://localhost:3000/admin
  Employee page: http://localhost:3000/employee
──────────────────────────────────────────────────
  `);

  await mongoose.disconnect();
}

seed().catch(e => { console.error(e); process.exit(1); });
