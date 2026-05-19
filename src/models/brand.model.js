import mongoose from "mongoose";

const brandSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, unique: true, trim: true },
    slug:     { type: String, unique: true },
    logo:     String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Brand", brandSchema);
