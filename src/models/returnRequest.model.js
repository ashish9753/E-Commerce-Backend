import mongoose from "mongoose";

const timelineEventSchema = new mongoose.Schema({
  status: { type: String, required: true },
  note:   { type: String },
  by:     { type: String, enum: ["system", "seller", "admin", "customer"], default: "system" },
  at:     { type: Date, default: Date.now },
}, { _id: false });

const bankDetailsSchema = new mongoose.Schema({
  accountName:   String,
  accountNumber: String,
  ifscCode:      String,
  bankName:      String,
  upiId:         String,
}, { _id: false });

const returnRequestSchema = new mongoose.Schema(
  {
    order:       { type: mongoose.Schema.Types.ObjectId, ref: "Order",   required: true },
    user:        { type: mongoose.Schema.Types.ObjectId, ref: "User",    required: true },
    product:     { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    seller:      { type: mongoose.Schema.Types.ObjectId, ref: "Seller" },

    reason:      { type: String, required: true },
    description: String,
    resolution:  { type: String, enum: ["refund", "replacement", "store_credit"], default: "refund" },
    images:      [String],

    // Refund payment preference (for resolution=refund)
    refundMethod: {
      type: String,
      enum: ["original_payment", "bank_transfer", "upi"],
      default: "original_payment",
    },
    bankDetails: bankDetailsSchema,

    status: {
      type: String,
      enum: [
        "REQUESTED",        // customer submitted
        "SELLER_APPROVED",  // seller approved
        "SELLER_REJECTED",  // seller rejected (admin can override)
        "APPROVED",         // admin approved
        "REJECTED",         // admin rejected
        "PICKUP_SCHEDULED", // pickup arranged
        "ITEM_RECEIVED",    // item back at warehouse
        "REFUND_INITIATED", // refund in progress
        "REFUND_COMPLETED", // refund done
        "REPLACEMENT_SENT", // replacement shipped
        "COMPLETED",        // closed
      ],
      default: "REQUESTED",
    },

    refundAmount:   Number,
    adminNote:      String,
    sellerNote:     String,
    sellerActionAt: Date,
    resolvedAt:     Date,

    timeline: [timelineEventSchema],
  },
  { timestamps: true }
);

export default mongoose.model("ReturnRequest", returnRequestSchema);
