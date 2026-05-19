import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "./src/models/user.model.js";
import Seller from "./src/models/seller.model.js";
import Category from "./src/models/category.model.js";
import Product from "./src/models/product.model.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/";
const DB_NAME = "ecommerce";

const USERS = [
  { name: "Admin User", email: "admin@test.com", phone: "9800000001", password: "Admin@123", role: "admin" },
  { name: "Seller User", email: "seller@test.com", phone: "9800000002", password: "Seller@123", role: "seller" },
  { name: "Regular User", email: "user@test.com", phone: "9800000003", password: "User@123", role: "user" },
];

async function seed() {
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
  console.log("Connected to MongoDB");

  // Clear existing seed data
  await User.deleteMany({ email: { $in: USERS.map(u => u.email) } });

  // Create users (password hashed by pre-save hook)
  const createdUsers = [];
  for (const u of USERS) {
    const doc = await User.create(u);
    createdUsers.push(doc);
  }

  const sellerUser = createdUsers.find(u => u.email === "seller@test.com");

  // Create / find seller profile
  await Seller.findOneAndDelete({ user: sellerUser._id });
  const seller = await Seller.create({
    user: sellerUser._id,
    shopName: "Test Shop",
    shopDescription: "A test seller shop for local development",
    isVerified: true,
  });

  // Create / find category
  let category = await Category.findOne({ slug: "electronics" });
  if (!category) {
    category = await Category.create({
      name: "Electronics",
      slug: "electronics",
      description: "Electronic gadgets and devices",
      isActive: true,
    });
  }

  // Seed 5 sample products (skip if already exist)
  const sampleProducts = [
    { title: "Wireless Headphones", price: 2999, discountPrice: 1999, stock: 50, isFeatured: true },
    { title: "Smart Watch", price: 5999, discountPrice: 3999, stock: 30, isFeatured: true },
    { title: "Bluetooth Speaker", price: 1499, discountPrice: 999, stock: 100, isFeatured: false },
    { title: "USB-C Hub 7-in-1", price: 1999, discountPrice: 1299, stock: 75, isFeatured: false },
    { title: "Mechanical Keyboard", price: 3499, discountPrice: 2499, stock: 40, isFeatured: true },
  ];

  for (const p of sampleProducts) {
    const exists = await Product.findOne({ title: p.title, seller: seller._id });
    if (!exists) {
      await Product.create({
        seller: seller._id,
        category: category._id,
        title: p.title,
        slug: p.title.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now(),
        description: `${p.title} — high quality product for local testing.`,
        shortDescription: `${p.title} at a great price.`,
        brand: "TestBrand",
        price: p.price,
        discountPrice: p.discountPrice,
        stock: p.stock,
        images: [],
        isFeatured: p.isFeatured,
        isPublished: true,
        isDeleted: false,
        specifications: { Warranty: "1 year", Color: "Black" },
      });
    }
  }

  console.log("\n========== SEED COMPLETE ==========");
  console.log("Role     | Email               | Password");
  console.log("---------|---------------------|----------");
  console.log("admin    | admin@test.com       | Admin@123");
  console.log("seller   | seller@test.com      | Seller@123");
  console.log("user     | user@test.com        | User@123");
  console.log("====================================\n");
  console.log("5 sample products seeded under 'Electronics' category.");

  await mongoose.disconnect();
}

seed().catch(err => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
