import mongoose from "mongoose";

const reservationSchema = new mongoose.Schema(
  {
    product:  { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    user:     { type: mongoose.Schema.Types.ObjectId, ref: "User",    required: true },
    quantity: { type: Number, required: true, min: 1 },
    expiresAt:{ type: Date,   required: true },
  },
  { timestamps: true }
);

// MongoDB auto-deletes expired documents (TTL index)
reservationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// One reservation per user per product
reservationSchema.index({ product: 1, user: 1 }, { unique: true });

// Fast lookup of all reservations for a product
reservationSchema.index({ product: 1, expiresAt: 1 });

export default mongoose.model("InventoryReservation", reservationSchema);
