import mongoose from "mongoose";

const salaryRecordSchema = new mongoose.Schema(
  {
    employee:    { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    month:       { type: Number, required: true, min: 1, max: 12 },
    year:        { type: Number, required: true },
    baseSalary:  { type: Number, required: true, min: 0 },
    deductions:  [{ reason: { type: String, required: true }, amount: { type: Number, required: true, min: 0 } }],
    bonuses:     [{ reason: { type: String, required: true }, amount: { type: Number, required: true, min: 0 } }],
    netSalary:   { type: Number, default: 0 },
    status:      { type: String, enum: ["PENDING", "PAID"], default: "PENDING" },
    paidAt:      Date,
    notes:       String,
  },
  { timestamps: true }
);

salaryRecordSchema.pre("save", function (next) {
  const dedTotal = this.deductions.reduce((s, d) => s + (d.amount || 0), 0);
  const bonTotal = this.bonuses.reduce((s, b)   => s + (b.amount || 0), 0);
  this.netSalary = Math.max(0, this.baseSalary - dedTotal + bonTotal);
  next();
});

export default mongoose.model("SalaryRecord", salaryRecordSchema);
