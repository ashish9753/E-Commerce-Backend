import mongoose from "mongoose";

const bannerSchema = new mongoose.Schema(
  {
    title:          { type: String, required: true },
    subtitle:       String,
    overlayText:    String,
    ctaLabel:       { type: String, default: "Shop Now" },
    textColor:      { type: String, default: "#ffffff" },
    textPosition:   { type: String, enum: ["left", "center", "right"], default: "left" },
    fontFamily:     { type: String, default: "Syne" },
    fontSize:       { type: Number, default: 48, min: 12, max: 120 },
    fontWeight:     { type: String, default: "800" },
    fontStyle:      { type: String, enum: ["normal", "italic"], default: "normal" },
    image:          { type: String, required: true },
    imagePublicId:  String,
    link:           String,
    product:        { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    position:       { type: Number, default: 0 },
    isActive:       { type: Boolean, default: true },
    startDate:      Date,
    endDate:        Date,
  },
  { timestamps: true }
);

export default mongoose.model("Banner", bannerSchema);
