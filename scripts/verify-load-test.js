import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import mongoose from "mongoose";
import Product from "../src/models/product.model.js";
import Order from "../src/models/order.model.js";
import InventoryLog from "../src/models/inventoryLog.model.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/";
const DB_NAME = process.env.DB_NAME || "ecommerce";

async function main() {
  if (!fs.existsSync("load-test-users.json")) {
    throw new Error("load-test-users.json not found. Run npm run load:setup first.");
  }

  const fixture = JSON.parse(fs.readFileSync("load-test-users.json", "utf8"));
  const productId = fixture.productId;
  const startingStock = fixture.stock;

  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });

  const product = await Product.findById(productId).lean();
  if (!product) throw new Error(`Product not found: ${productId}`);

  const orderCount = await Order.countDocuments({ "orderItems.product": productId });
  const placedOrders = await Order.find({ "orderItems.product": productId })
    .select("orderItems orderStatus user")
    .lean();
  const orderedUnits = placedOrders.reduce((total, order) => {
    const item = order.orderItems.find((entry) => entry.product.toString() === productId);
    return total + (item?.quantity || 0);
  }, 0);
  const inventoryLogCount = await InventoryLog.countDocuments({ product: productId, changeType: "ORDER" });

  const expectedRemaining = startingStock - orderedUnits;
  const ok =
    product.stock >= 0 &&
    product.sold <= startingStock &&
    orderedUnits <= startingStock &&
    product.stock === expectedRemaining &&
    product.sold === orderedUnits;

  console.log("Load test verification");
  console.log(`Product ID: ${productId}`);
  console.log(`Starting stock: ${startingStock}`);
  console.log(`Orders created: ${orderCount}`);
  console.log(`Units ordered: ${orderedUnits}`);
  console.log(`Product stock now: ${product.stock}`);
  console.log(`Product sold now: ${product.sold}`);
  console.log(`Inventory ORDER logs: ${inventoryLogCount}`);
  console.log(`Oversell protected: ${ok ? "YES" : "NO"}`);

  await mongoose.disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
