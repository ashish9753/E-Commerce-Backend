import mongoose from "mongoose";

const deliveryAreaSchema = new mongoose.Schema({
  pincode:        { type: String, required: true, unique: true, trim: true },
  city:           { type: String, default: "" },
  state:          { type: String, default: "" },
  deliveryCharge: { type: Number, required: true, min: 0, default: 0 },
  isActive:       { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.model("DeliveryArea", deliveryAreaSchema);
