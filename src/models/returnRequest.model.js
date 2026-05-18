import mongoose from "mongoose";

const returnRequestSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, required: true },
    description: String,
    images: [String],
    status: {
      type: String,
      enum: ["REQUESTED", "APPROVED", "REJECTED", "COMPLETED"],
      default: "REQUESTED",
    },
    refundAmount: Number,
    adminNote: String,
    resolvedAt: Date,
  },
  { timestamps: true }
);

export default mongoose.model("ReturnRequest", returnRequestSchema);
