import mongoose from "mongoose";

const chatSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    message: { type: String, required: true, trim: true },
    messageType: { type: String, enum: ["TEXT", "IMAGE", "FILE"], default: "TEXT" },
    fileUrl: String,
    isSeen: { type: Boolean, default: false },
    seenAt: Date,
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

chatSchema.index({ sender: 1, receiver: 1, createdAt: -1 });

export default mongoose.model("Chat", chatSchema);
