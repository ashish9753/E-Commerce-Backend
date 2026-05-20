import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/";
const DB_NAME   = "ecommerce";

// parentSlug -> subcategories
const SUBCATS = {
  "electronics":      ["Smartphones", "Laptops", "Tablets", "Cameras", "Audio & Headphones", "Gaming", "Smartwatches", "Printers"],
  "mobile-phones":    ["Android Phones", "iPhones", "Feature Phones", "Phone Accessories"],
  "televisions":      ["Smart TVs", "LED TVs", "OLED TVs", "Projectors"],
  "air-conditioners": ["Split AC", "Window AC", "Portable AC", "AC Accessories"],
  "refrigerators":    ["Single Door", "Double Door", "Side by Side", "Mini Fridge"],
  "washing-machines": ["Front Load", "Top Load", "Semi-Automatic", "Washer Dryer Combo"],
  "clothing":         ["Men's Clothing", "Women's Clothing", "Kids' Clothing", "Ethnic Wear", "Sportswear"],
  "shoes-footwear":   ["Sneakers", "Sandals", "Formal Shoes", "Boots", "Sports Shoes"],
  "furniture":        ["Sofas", "Beds", "Tables", "Chairs", "Wardrobes", "Storage"],
  "kitchen":          ["Cookware", "Mixers & Blenders", "Microwave Ovens", "Coffee Makers", "Kitchen Storage"],
  "sports-fitness":   ["Gym Equipment", "Yoga & Pilates", "Outdoor Sports", "Cricket", "Cycling"],
  "beauty-health":    ["Skincare", "Haircare", "Makeup", "Health Monitors", "Personal Care"],
  "toys-games":       ["Action Figures", "Board Games", "Educational Toys", "Outdoor Toys", "Video Games"],
  "books":            ["Fiction", "Non-Fiction", "Children's Books", "Textbooks", "Comics & Manga"],
};

async function seed() {
  await mongoose.connect(MONGO_URI + DB_NAME);
  console.log("Connected to MongoDB:", MONGO_URI + DB_NAME);

  const db = mongoose.connection.db;

  let inserted = 0, skipped = 0;

  for (const [parentSlug, subs] of Object.entries(SUBCATS)) {
    const parent = await db.collection("categories").findOne({ slug: parentSlug });
    if (!parent) {
      console.log(`⚠ Parent not found: ${parentSlug} — run seed-catalog.js first`);
      continue;
    }

    for (const name of subs) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const exists = await db.collection("categories").findOne({ slug });
      if (exists) { skipped++; continue; }

      await db.collection("categories").insertOne({
        name,
        slug,
        parent: parent._id,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      inserted++;
    }
  }

  console.log(`✅ Sub-categories: ${inserted} inserted, ${skipped} already existed`);
  console.log("\n─────────────────────────────────────");
  console.log("  Sub-category seeding complete!");
  console.log("─────────────────────────────────────\n");

  await mongoose.disconnect();
}

seed().catch(e => { console.error(e); process.exit(1); });
