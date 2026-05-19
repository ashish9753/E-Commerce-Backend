import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  sender:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  senderRole:{ type: String, enum: ["user","admin"], required: true },
  text:      { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now },
});

const supportTicketSchema = new mongoose.Schema(
  {
    user:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    order:    { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    subject:  { type: String, required: true, trim: true },
    status:   { type: String, enum: ["OPEN","IN_PROGRESS","RESOLVED","CLOSED"], default: "OPEN" },
    priority: { type: String, enum: ["LOW","MEDIUM","HIGH"], default: "MEDIUM" },
    messages: [messageSchema],
    assignedAdmin: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolvedAt:    Date,
  },
  { timestamps: true }
);

supportTicketSchema.index({ user: 1, status: 1 });
supportTicketSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("SupportTicket", supportTicketSchema);
