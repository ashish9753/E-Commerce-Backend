import mongoose from "mongoose";

const inventoryLogSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    changeType: {
      type: String,
      enum: ["ORDER", "RESTOCK", "CANCEL", "RETURN", "ADJUSTMENT"],
      required: true,
    },
    quantityChanged: { type: Number, required: true },
    oldStock: { type: Number, required: true },
    newStock: { type: Number, required: true },
    note: String,
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

inventoryLogSchema.index({ product: 1, createdAt: -1 });

export default mongoose.model("InventoryLog", inventoryLogSchema);
