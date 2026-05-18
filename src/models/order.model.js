import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
  title: String,
  image: String,
  quantity: Number,
  price: Number,
}, { _id: false });

const shippingAddressSchema = new mongoose.Schema({
  fullName: String,
  phone: String,
  pincode: String,
  state: String,
  city: String,
  houseNo: String,
  area: String,
  landmark: String,
}, { _id: false });

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    orderNumber: { type: String, unique: true },
    orderItems: [orderItemSchema],
    shippingAddress: shippingAddressSchema,
    paymentMethod: { type: String, enum: ["COD", "ONLINE"], required: true },
    paymentStatus: {
      type: String,
      enum: ["PENDING", "PAID", "FAILED", "REFUNDED"],
      default: "PENDING",
    },
    orderStatus: {
      type: String,
      enum: ["PLACED", "CONFIRMED", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "RETURNED"],
      default: "PLACED",
    },
    statusHistory: [
      {
        status: String,
        timestamp: { type: Date, default: Date.now },
        note: String,
      },
    ],
    cancellationReason: String,
    refundStatus: {
      type: String,
      enum: ["PENDING", "PROCESSING", "COMPLETED", "REJECTED", "NOT_APPLICABLE"],
      default: "NOT_APPLICABLE",
    },
    refundAmount: { type: Number, default: 0 },
    refundReason: String,
    itemsPrice: Number,
    shippingPrice: { type: Number, default: 0 },
    taxPrice: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    totalPrice: Number,
    coupon: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", default: null },
    trackingId: String,
    estimatedDeliveryDate: Date,
    deliveredAt: Date,
    paidAt: Date,
  },
  { timestamps: true }
);

orderSchema.pre("save", function (next) {
  if (!this.orderNumber) {
    this.orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }
  next();
});

export default mongoose.model("Order", orderSchema);
