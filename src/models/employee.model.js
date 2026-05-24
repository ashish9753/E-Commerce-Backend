import mongoose from "mongoose";

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
  },
  { timestamps: true }
);

export default mongoose.model("Employee", employeeSchema);
