import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../src/models/user.model.js";
import Employee from "../src/models/employee.model.js";
import Category from "../src/models/category.model.js";
import Product from "../src/models/product.model.js";
import Order from "../src/models/order.model.js";
import InventoryLog from "../src/models/inventoryLog.model.js";
import Notification from "../src/models/notification.model.js";
import { generateTokenPair } from "../src/utils/jwt.utils.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/";
const DB_NAME = process.env.DB_NAME || "ecommerce";
const USER_COUNT = Number(process.env.LOAD_TEST_USERS || 1000);
const PRODUCT_STOCK = Number(process.env.LOAD_TEST_STOCK || 500);
const PASSWORD = "LoadTest@123";

const address = {
  fullName: "Load Test User",
  phone: "9999999999",
  pincode: "700001",
  state: "West Bengal",
  city: "Kolkata",
  houseNo: "1",
  area: "Load Test Area",
  landmark: "Load Test Landmark",
};

async function main() {
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const now = new Date();

  const employeeUser = await User.findOneAndUpdate(
    { email: "loadtest-employee@example.com" },
    {
      $set: {
        name: "Load Test Employee",
        email: "loadtest-employee@example.com",
        phone: "9000000000",
        password: passwordHash,
        role: "employee",
        isBlocked: false,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, new: true }
  );

  const employee = await Employee.findOneAndUpdate(
    { user: employeeUser._id },
    {
      $set: {
        shopName: "Load Test Shop",
        shopDescription: "Products used only for backend load testing",
        isVerified: true,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, new: true }
  );

  const category = await Category.findOneAndUpdate(
    { slug: "load-test" },
    {
      $set: {
        name: "Load Test",
        slug: "load-test",
        description: "Temporary category for load tests",
        isActive: true,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, new: true }
  );

  const product = await Product.findOneAndUpdate(
    { sku: "LOAD-TEST-FLASH-SALE" },
    {
      $set: {
        employee: employee._id,
        title: "Load Test Flash Sale Product",
        slug: "load-test-flash-sale-product",
        description: "Temporary product used to test 1000 concurrent buyers for 500 stock.",
        shortDescription: "Load test product",
        category: category._id,
        brand: "LoadTest",
        sku: "LOAD-TEST-FLASH-SALE",
        price: 100,
        discountPrice: 90,
        stock: PRODUCT_STOCK,
        sold: 0,
        images: [],
        tags: ["load-test"],
        isPublished: true,
        isDeleted: false,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, new: true }
  );

  const emails = Array.from({ length: USER_COUNT }, (_, index) => {
    const n = String(index + 1).padStart(4, "0");
    return `loadtest-user-${n}@example.com`;
  });

  await User.bulkWrite(
    emails.map((email, index) => ({
      updateOne: {
        filter: { email },
        update: {
          $set: {
            name: `Load Test User ${index + 1}`,
            email,
            phone: `98${String(index + 1).padStart(8, "0")}`,
            password: passwordHash,
            role: "user",
            addresses: [{ ...address, fullName: `Load Test User ${index + 1}` }],
            isBlocked: false,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    }))
  );

  const users = await User.find({ email: { $in: emails } }).sort({ email: 1 });
  const userIds = users.map((user) => user._id);

  await Order.deleteMany({
    $or: [
      { user: { $in: userIds } },
      { "orderItems.product": product._id },
    ],
  });
  await InventoryLog.deleteMany({ product: product._id });
  await Notification.deleteMany({ user: { $in: userIds } });

  const k6Users = users.map((user) => {
    const { accessToken } = generateTokenPair(user._id, user.role);
    return {
      id: user._id.toString(),
      email: user.email,
      addressId: user.addresses[0]._id.toString(),
      token: accessToken,
    };
  });

  const payload = {
    productId: product._id.toString(),
    stock: PRODUCT_STOCK,
    users: k6Users,
  };

  fs.writeFileSync("load-test-users.json", JSON.stringify(payload, null, 2));

  console.log("Load test data ready");
  console.log(`Product ID: ${product._id}`);
  console.log(`Product stock reset to: ${PRODUCT_STOCK}`);
  console.log(`Users ready: ${k6Users.length}`);
  console.log("Run: npm run load:test");

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
