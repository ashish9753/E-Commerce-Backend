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
    visibility: { type: String, enum: ['everyone', 'new_users', 'hidden'], default: 'everyone' },
  },
  { timestamps: true }
);

couponSchema.methods.isValid = function (orderAmount, userId) {
  const now = new Date();
  if (!this.isActive) return { valid: false, message: "Coupon is inactive" };
  if (this.expiryDate < now) return { valid: false, message: "Coupon has expired" };
  if (this.usageLimit && this.usedCount >= this.usageLimit) return { valid: false, message: "Coupon usage limit reached" };
  if (!Number.isFinite(orderAmount) || orderAmount <= 0) return { valid: false, message: "Invalid order amount" };
  if (orderAmount < this.minimumAmount) return { valid: false, message: `Minimum order amount is ₹${this.minimumAmount}` };
  // usedBy stores ObjectIds — compare via string form so we don't silently miss matches.
  if (userId && this.usedBy.some((id) => id.toString() === userId.toString())) {
    return { valid: false, message: "You have already used this coupon" };
  }
  return { valid: true };
};

couponSchema.methods.calculateDiscount = function (orderAmount) {
  if (!Number.isFinite(orderAmount) || orderAmount <= 0) return 0;
  let discount = this.discountType === "PERCENTAGE"
    ? (orderAmount * this.discountValue) / 100
    : this.discountValue;

  if (this.maximumDiscount) discount = Math.min(discount, this.maximumDiscount);
  discount = Math.min(discount, orderAmount);
  return Math.max(0, parseFloat(discount.toFixed(2)));
};

export default mongoose.model("Coupon", couponSchema);
