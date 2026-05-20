import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/";
const DB_NAME   = "ecommerce";

const CATEGORIES = [
  { name: "Electronics",       slug: "electronics",        description: "Electronic gadgets and devices" },
  { name: "Mobile Phones",     slug: "mobile-phones",      description: "Smartphones and accessories" },
  { name: "Laptops",           slug: "laptops",            description: "Laptops and notebooks" },
  { name: "Televisions",       slug: "televisions",        description: "Smart TVs and displays" },
  { name: "Air Conditioners",  slug: "air-conditioners",   description: "Split and window ACs" },
  { name: "Refrigerators",     slug: "refrigerators",      description: "Single and double door fridges" },
  { name: "Washing Machines",  slug: "washing-machines",   description: "Front and top load washers" },
  { name: "Clothing",          slug: "clothing",           description: "Men, women and kids clothing" },
  { name: "Shoes & Footwear",  slug: "shoes-footwear",     description: "All types of footwear" },
  { name: "Furniture",         slug: "furniture",          description: "Home and office furniture" },
  { name: "Kitchen",           slug: "kitchen",            description: "Kitchen appliances and cookware" },
  { name: "Sports & Fitness",  slug: "sports-fitness",     description: "Sports equipment and fitness gear" },
  { name: "Books",             slug: "books",              description: "Books and stationery" },
  { name: "Toys & Games",      slug: "toys-games",         description: "Toys for kids and board games" },
  { name: "Beauty & Health",   slug: "beauty-health",      description: "Skincare, haircare and health" },
];

const BRANDS = [
  { name: "Samsung",    slug: "samsung",    description: "Samsung Electronics" },
  { name: "Apple",      slug: "apple",      description: "Apple Inc." },
  { name: "Sony",       slug: "sony",       description: "Sony Corporation" },
  { name: "LG",         slug: "lg",         description: "LG Electronics" },
  { name: "Boat",       slug: "boat",       description: "Boat Lifestyle" },
  { name: "OnePlus",    slug: "oneplus",    description: "OnePlus Technology" },
  { name: "Xiaomi",     slug: "xiaomi",     description: "Xiaomi Inc." },
  { name: "HP",         slug: "hp",         description: "HP Inc." },
  { name: "Dell",       slug: "dell",       description: "Dell Technologies" },
  { name: "Lenovo",     slug: "lenovo",     description: "Lenovo Group" },
  { name: "Asus",       slug: "asus",       description: "ASUSTeK Computer" },
  { name: "Nike",       slug: "nike",       description: "Nike Inc." },
  { name: "Adidas",     slug: "adidas",     description: "Adidas AG" },
  { name: "Puma",       slug: "puma",       description: "Puma SE" },
  { name: "Whirlpool",  slug: "whirlpool",  description: "Whirlpool Corporation" },
  { name: "Bajaj",      slug: "bajaj",      description: "Bajaj Electricals" },
  { name: "Philips",    slug: "philips",    description: "Philips India" },
  { name: "Havells",    slug: "havells",    description: "Havells India" },
  { name: "Generic",    slug: "generic",    description: "Generic / Unbranded" },
];

async function seed() {
  await mongoose.connect(MONGO_URI + DB_NAME);
  console.log("Connected to MongoDB:", MONGO_URI + DB_NAME);

  const db = mongoose.connection.db;

  // ── Categories ──
  let catInserted = 0, catSkipped = 0;
  for (const cat of CATEGORIES) {
    const exists = await db.collection("categories").findOne({ slug: cat.slug });
    if (exists) { catSkipped++; continue; }
    await db.collection("categories").insertOne({ ...cat, isActive: true, createdAt: new Date(), updatedAt: new Date() });
    catInserted++;
  }
  console.log(`✅ Categories: ${catInserted} inserted, ${catSkipped} already existed`);

  // ── Brands ──
  let brandInserted = 0, brandSkipped = 0;
  for (const brand of BRANDS) {
    const exists = await db.collection("brands").findOne({ slug: brand.slug });
    if (exists) { brandSkipped++; continue; }
    await db.collection("brands").insertOne({ ...brand, isActive: true, createdAt: new Date(), updatedAt: new Date() });
    brandInserted++;
  }
  console.log(`✅ Brands: ${brandInserted} inserted, ${brandSkipped} already existed`);

  console.log("\n─────────────────────────────────────");
  console.log("  Catalog seeding complete!");
  console.log(`  ${CATEGORIES.length} categories, ${BRANDS.length} brands`);
  console.log("─────────────────────────────────────\n");

  await mongoose.disconnect();
}

seed().catch(e => { console.error(e); process.exit(1); });
