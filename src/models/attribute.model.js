import mongoose from "mongoose";

const attributeSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true },
    unit:        { type: String, trim: true },           // e.g. "kg", "ton", "L"
    subcategory: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    options:     [{ type: String, trim: true }],          // e.g. ["5 kg", "7 kg", "8 kg"]
    isActive:    { type: Boolean, default: true },
  },
  { timestamps: true }
);

attributeSchema.index({ subcategory: 1 });

export default mongoose.model("Attribute", attributeSchema);
