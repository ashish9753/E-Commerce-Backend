import mongoose from "mongoose";

const cartItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  quantity: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true },
}, { _id: false });

const cartSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", unique: true, required: true },
    items: [cartItemSchema],
    coupon: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", default: null },
    totalItems: { type: Number, default: 0 },
    totalPrice: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    finalPrice: { type: Number, default: 0 },
  },
  { timestamps: true }
);

cartSchema.methods.recalculate = function () {
  this.totalItems = this.items.reduce((sum, i) => sum + i.quantity, 0);
  this.totalPrice = this.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  this.finalPrice = this.totalPrice - this.discountAmount;
};

export default mongoose.model("Cart", cartSchema);
