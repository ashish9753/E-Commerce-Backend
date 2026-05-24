import mongoose from "mongoose";

const timelineEventSchema = new mongoose.Schema({
  status: { type: String, required: true },
  note:   { type: String },
  by:     { type: String, enum: ["system", "employee", "admin", "customer"], default: "system" },
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
    employee:    { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },

    reason:      { type: String, required: true },
    description: String,
    resolution:  { type: String, enum: ["refund", "replacement", "store_credit"], default: "refund" },
    evidence: [{
      url:      { type: String, required: true },
      publicId: String,
      type:     { type: String, enum: ["image", "video"], default: "image" },
    }],

    // Refund payment preference (for resolution=refund)
    refundMethod: {
      type: String,
      enum: ["original_payment", "bank_transfer", "upi"],
      default: "bank_transfer",
    },
    bankDetails: bankDetailsSchema,

    status: {
      type: String,
      enum: [
        "REQUESTED",           // customer submitted
        "EMPLOYEE_APPROVED",   // employee approved
        "EMPLOYEE_REJECTED",   // employee rejected (admin can override)
        "APPROVED",            // admin approved
        "REJECTED",            // admin rejected
        "PICKUP_SCHEDULED",    // pickup arranged
        "ITEM_RECEIVED",       // item back at warehouse
        "REFUND_INITIATED",    // refund in progress
        "REFUND_COMPLETED",    // refund done
        "REPLACEMENT_SENT",    // replacement shipped
        "COMPLETED",           // closed
      ],
      default: "REQUESTED",
    },

    refundAmount:    Number,
    adminNote:       String,
    employeeNote:    String,
    employeeActionAt: Date,
    resolvedAt:      Date,

    // Proof uploaded by employee/admin when processing refund
    refundProof: [{
      url:        { type: String, required: true },
      publicId:   String,
      uploadedBy: { type: String, enum: ['employee', 'admin'], default: 'admin' },
      uploadedAt: { type: Date, default: Date.now },
    }],

    timeline: [timelineEventSchema],
  },
  { timestamps: true }
);

export default mongoose.model("ReturnRequest", returnRequestSchema);
