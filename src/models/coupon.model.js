import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, uppercase: true, trim: true },
    // FREEBIE        = add `freebieProduct` × `freebieQuantity` to the order at Rs. 0
    // FREE_SHIPPING  = waive shipping on this order (shippingPrice → 0)
    // discountValue is forced to 0 for both in pre-validate.
    discountType: { type: String, enum: ["PERCENTAGE", "FIXED", "FREEBIE", "FREE_SHIPPING"], required: true },
    discountValue: { type: Number, required: true, min: 0 },
    minimumAmount: { type: Number, default: 0 },
    maximumDiscount: { type: Number },
    expiryDate: { type: Date, required: true },
    usageLimit: { type: Number, default: null },
    usedCount: { type: Number, default: 0 },
    usedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    isActive: { type: Boolean, default: true },
    visibility: { type: String, enum: ['everyone', 'new_users', 'hidden'], default: 'hidden' },
    applicableBrands:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'Brand' }],
    applicableCategories:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    applicableSubcategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    // Freebie config — only used when discountType === "FREEBIE".
    freebieProduct:  { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    freebieQuantity: { type: Number, default: 1, min: 1, max: 10 },
  },
  { timestamps: true }
);

// FREEBIE coupons carry no cash discount — normalise the value to 0 so the
// math elsewhere (totals, refunds, eligibility) stays correct regardless of
// what was posted.
couponSchema.pre("validate", function (next) {
  if (this.discountType === "FREEBIE") {
    this.discountValue = 0;
    if (!this.freebieQuantity || this.freebieQuantity < 1) this.freebieQuantity = 1;
  }
  if (this.discountType === "FREE_SHIPPING") {
    this.discountValue = 0;
  }
  next();
});

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
  // FREEBIE and FREE_SHIPPING never produce a cash discount on items — they
  // act on a different part of the total (a free gift line or shipping=0).
  if (this.discountType === "FREEBIE" || this.discountType === "FREE_SHIPPING") return 0;
  if (!Number.isFinite(orderAmount) || orderAmount <= 0) return 0;
  let discount = this.discountType === "PERCENTAGE"
    ? (orderAmount * this.discountValue) / 100
    : this.discountValue;

  if (this.maximumDiscount) discount = Math.min(discount, this.maximumDiscount);
  discount = Math.min(discount, orderAmount);
  return Math.max(0, parseFloat(discount.toFixed(2)));
};

export default mongoose.model("Coupon", couponSchema);
