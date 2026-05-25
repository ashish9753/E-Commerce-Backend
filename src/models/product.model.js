import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    title: { type: String, required: true, trim: true },
    slug: { type: String, unique: true },
    description: { type: String, required: true },
    shortDescription: String,
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    brand: String,
    sku: { type: String, unique: true, sparse: true },
    price: { type: Number, required: true, min: 0 },
    discountPrice: { type: Number, min: 0 },
    stock: { type: Number, default: 0, min: 0 },
    sold: { type: Number, default: 0 },
    images: [String],
    rating: { type: Number, default: 0, min: 0, max: 5 },
    totalReviews: { type: Number, default: 0 },
    tags: [String],
    specifications: { type: Map, of: String },
    isFeatured:    { type: Boolean, default: false },
    isPublished:   { type: Boolean, default: true },
    isDeleted:     { type: Boolean, default: false },
    returnable:    { type: Boolean, default: true },
    returnWindow:  { type: Number, enum: [7, 10], default: 7 },
    // No tax by default — sellers explicitly opt in (e.g. GST 18%, VAT 5%) when
    // listing a taxable product. Avoids silently adding 18% to untaxed items.
    taxRate:       { type: Number, default: 0, min: 0, max: 100 },   // % e.g. 18 for GST 18%
    taxLabel:      { type: String, default: "No Tax" },                // shown on invoice
  },
  { timestamps: true }
);

productSchema.index({ title: "text", description: "text", tags: "text" });
productSchema.index({ category: 1, isDeleted: 1, isPublished: 1 });
productSchema.index({ price: 1 });

export default mongoose.model("Product", productSchema);
