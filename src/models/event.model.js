import mongoose from "mongoose";

const eventSchema = new mongoose.Schema(
  {
    name:            { type: String, required: true, trim: true },
    badge:           { type: String, trim: true },          // e.g. "DASHAIN50"
    description:     String,
    discountPercent: { type: Number, min: 0, max: 100, default: 0 },
    startDate:       { type: Date, required: true },
    endDate:         { type: Date, required: true },
    image:           String,
    isActive:        { type: Boolean, default: true },
    coupon:          { type: mongoose.Schema.Types.ObjectId, ref: "Coupon" },
  },
  { timestamps: true }
);

export default mongoose.model("Event", eventSchema);
