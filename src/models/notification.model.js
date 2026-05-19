import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: ["ORDER", "PAYMENT", "OFFER", "REFUND", "SYSTEM"],
      required: true,
    },
    link:       String,
    couponCode: String,
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, isRead: 1 });

export default mongoose.model("Notification", notificationSchema);
