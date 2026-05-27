import mongoose from "mongoose";
import { DEFAULT_PERMISSIONS } from "../middleware/permission.middleware.js";

const employeeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    shopName: { type: String, trim: true, default: "" },
    shopDescription: String,
    shopLogo: String,
    gstNumber: String,
    businessAddress: String,
    bankAccountNumber: String,
    ifscCode: String,
    isVerified: { type: Boolean, default: false },
    isBlocked:  { type: Boolean, default: false },
    totalSales: { type: Number, default: 0 },
    rating:     { type: Number, default: 0 },
    // Employment details (admin-managed)
    designation:    String,
    department:     String,
    joiningDate:    Date,
    monthlySalary:  { type: Number, default: 0 },
    // Per-employee permission keys controlling sidebar tabs and write actions.
    // Default = full access so existing employees keep working.
    permissions:    { type: [String], default: () => DEFAULT_PERMISSIONS },
  },
  { timestamps: true }
);

export default mongoose.model("Employee", employeeSchema);
