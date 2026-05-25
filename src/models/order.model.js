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
    taxLabel: { type: String, default: "GST" },
    discountAmount: { type: Number, default: 0 },
    totalPrice: Number,
    coupon: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", default: null },
    trackingId: String,
    estimatedDeliveryDate: Date,
    deliveredAt: Date,
    paidAt: Date,
    codBookingAmount:  { type: Number, default: 0 },
    codBookingUtr:     { type: String, default: "" },   // UPI transaction ref
    codBookingStatus:  { type: String, enum: ["NOT_REQUIRED", "PENDING", "PAID"], default: "NOT_REQUIRED" },
    cancellationRefundMethod: { type: String, enum: ['bank_transfer', 'upi'] },
    cancellationBankDetails:  { type: mongoose.Schema.Types.Mixed, default: {} },
    cancellationRefundProof:  [{
      url:        { type: String, required: true },
      publicId:   String,
      uploadedBy: { type: String, enum: ['employee', 'admin'], default: 'admin' },
      uploadedAt: { type: Date, default: Date.now },
    }],
    // Halfway-mark payment reminder for unpaid ONLINE orders. Tracked so the
    // sweeper sends exactly one reminder per order before auto-cancellation.
    paymentReminderSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });

orderSchema.pre("save", function (next) {
  if (!this.orderNumber) {
    this.orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }
  next();
});

export default mongoose.model("Order", orderSchema);
