import mongoose from "mongoose";

// Delivery serviceable areas. We're a Nepal-first store where city/area names
// are the primary identifier — pincodes are barely used so they're optional.
const deliveryAreaSchema = new mongoose.Schema({
  city:           { type: String, required: true, trim: true },
  state:          { type: String, default: "", trim: true },
  pincode:        { type: String, default: "", trim: true }, // optional, kept for invoices/legacy data
  deliveryCharge: { type: Number, required: true, min: 0, default: 0 },
  isActive:       { type: Boolean, default: true },
}, { timestamps: true });

// Case-insensitive uniqueness on city — Kathmandu / kathmandu / KATHMANDU all clash.
deliveryAreaSchema.index({ city: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

export default mongoose.model("DeliveryArea", deliveryAreaSchema);
