import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, uppercase: true, trim: true },
    discountType: { type: String, enum: ["PERCENTAGE", "FIXED"], required: true },
    discountValue: { type: Number, required: true, min: 0 },
    minimumAmount: { type: Number, default: 0 },
    maximumDiscount: { type: Number },
    expiryDate: { type: Date, required: true },
    usageLimit: { type: Number, default: null },
    usedCount: { type: Number, default: 0 },
    usedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

couponSchema.methods.isValid = function (orderAmount, userId) {
  const now = new Date();
  if (!this.isActive) return { valid: false, message: "Coupon is inactive" };
  if (this.expiryDate < now) return { valid: false, message: "Coupon has expired" };
  if (this.usageLimit && this.usedCount >= this.usageLimit) return { valid: false, message: "Coupon usage limit reached" };
  if (orderAmount < this.minimumAmount) return { valid: false, message: `Minimum order amount is ₹${this.minimumAmount}` };
  if (userId && this.usedBy.includes(userId.toString())) return { valid: false, message: "You have already used this coupon" };
  return { valid: true };
};

couponSchema.methods.calculateDiscount = function (orderAmount) {
  let discount = this.discountType === "PERCENTAGE"
    ? (orderAmount * this.discountValue) / 100
    : this.discountValue;

  if (this.maximumDiscount) discount = Math.min(discount, this.maximumDiscount);
  return Math.min(discount, orderAmount);
};

export default mongoose.model("Coupon", couponSchema);
