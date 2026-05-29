import Employee from "../models/employee.model.js";
import User from "../models/user.model.js";
import SalaryRecord from "../models/salaryRecord.model.js";
import { uploadToCloudinary } from "../utils/cloudinary.utils.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import { notify, notifyAdmins } from "../utils/notify.js";
import { sanitizePermissions, DEFAULT_PERMISSIONS } from "../middleware/permission.middleware.js";
import { assertPhone } from "../utils/validators.utils.js";

const MONTH_NAMES = ["","January","February","March","April","May","June","July","August","September","October","November","December"];

export const registerEmployee = async (req, res, next) => {
  try {
    const { shopName, businessAddress, bankAccountNumber, ifscCode, shopDescription } = req.body;
    if (!shopName) throw new ApiError(400, "Shop name is required");

    const existing = await Employee.findOne({ user: req.user._id });
    if (existing) throw new ApiError(409, "Employee profile already exists for this account");

    const employee = await Employee.create({
      user: req.user._id,
      shopName,
      businessAddress,
      bankAccountNumber,
      ifscCode,
      shopDescription,
    });

    await User.findByIdAndUpdate(req.user._id, { role: "employee" });

    // Notify the new employee
    await notify({
      userId:  req.user._id,
      title:   "Employee Registration Submitted 🏪",
      message: `Your employee account for "${shopName}" has been submitted and is pending admin verification. You'll be notified once approved.`,
      type:    "SYSTEM",
    });

    // Notify admins
    await notifyAdmins({
      title:   "New Employee Registration 🏪",
      message: `${req.user.name || "A user"} registered as an employee with shop "${shopName}". Please review and verify.`,
      type:    "SYSTEM",
      link:    "/admin",
    });

    res.status(201).json(new ApiResponse(201, { employee }, "Employee registered. Pending verification."));
  } catch (err) {
    next(err);
  }
};

export const adminCreateEmployee = async (req, res, next) => {
  try {
    const { name, email, phone, password, designation, department, joiningDate, monthlySalary, businessAddress, shopDescription, permissions } = req.body;
    if (!name || !email || !phone || !password)
      throw new ApiError(400, "Name, email, phone and password are required");
    const phoneDigits = assertPhone(phone);

    const existing = await User.findOne({ email });
    if (existing) throw new ApiError(409, "Email already registered");

    const user = await User.create({ name, email, phone: phoneDigits, password, role: "employee" });

    const cleanPerms = sanitizePermissions(permissions);

    const employee = await Employee.create({
      user: user._id,
      shopName: name,
      businessAddress,
      shopDescription,
      designation,
      department,
      joiningDate: joiningDate || undefined,
      monthlySalary: monthlySalary ? Number(monthlySalary) : 0,
      isVerified: true,
      permissions: cleanPerms ?? DEFAULT_PERMISSIONS,
    });

    await notify({
      userId:  user._id,
      title:   "Welcome to the Team!",
      message: `Your employee account has been created and verified by admin. You can now log in.`,
      type:    "SYSTEM",
    });

    const populated = await Employee.findById(employee._id).populate("user", "name email phone");
    res.status(201).json(new ApiResponse(201, { employee: populated }, "Employee account created successfully"));
  } catch (err) {
    next(err);
  }
};

export const adminRegisterExistingUser = async (req, res, next) => {
  try {
    const { userId, shopName, businessAddress, shopDescription } = req.body;
    if (!userId || !shopName)
      throw new ApiError(400, "userId and shopName are required");

    const user = await User.findById(userId);
    if (!user) throw new ApiError(404, "User not found");

    const existing = await Employee.findOne({ user: userId });
    if (existing && !existing.isDeleted) {
      throw new ApiError(409, "This user already has an employee profile");
    }

    await User.findByIdAndUpdate(userId, { role: "employee" });

    let employee;
    if (existing && existing.isDeleted) {
      // Reactivate the archived employee record so all their historical
      // products, orders and salary records remain linked.
      existing.isDeleted       = false;
      existing.deletedAt       = undefined;
      existing.isBlocked       = false;
      existing.isVerified      = true;
      existing.shopName        = shopName        ?? existing.shopName;
      existing.businessAddress = businessAddress ?? existing.businessAddress;
      existing.shopDescription = shopDescription ?? existing.shopDescription;
      await existing.save();
      employee = existing;
    } else {
      employee = await Employee.create({
        user: userId,
        shopName,
        businessAddress,
        shopDescription,
        isVerified: true,
      });
    }

    await notify({
      userId,
      title:   "Welcome to the Team! 🏪",
      message: `Your employee account for "${shopName}" has been set up by admin. You can now access the Employee Panel.`,
      type:    "SYSTEM",
    });

    const populated = await Employee.findById(employee._id).populate("user", "name email phone");
    res.status(201).json(new ApiResponse(201, { employee: populated }, "Existing user registered as employee"));
  } catch (err) {
    next(err);
  }
};

export const getMyEmployeeProfile = async (req, res, next) => {
  try {
    const employee = await Employee.findOne({ user: req.user._id }).populate("user", "name email phone");
    if (!employee) throw new ApiError(404, "Employee profile not found");
    res.json(new ApiResponse(200, { employee }));
  } catch (err) {
    next(err);
  }
};

export const updateEmployeeProfile = async (req, res, next) => {
  try {
    const { shopName, shopDescription, businessAddress, bankAccountNumber, ifscCode } = req.body;
    const employee = await Employee.findOneAndUpdate(
      { user: req.user._id },
      { shopName, shopDescription, businessAddress, bankAccountNumber, ifscCode },
      { new: true, runValidators: true }
    );
    if (!employee) throw new ApiError(404, "Employee profile not found");
    res.json(new ApiResponse(200, { employee }, "Profile updated"));
  } catch (err) {
    next(err);
  }
};

export const uploadShopLogo = async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, "No image provided");
    const result = await uploadToCloudinary(req.file.buffer, "ecommerce/shops");
    const employee = await Employee.findOneAndUpdate(
      { user: req.user._id },
      { shopLogo: result.secure_url },
      { new: true }
    );
    res.json(new ApiResponse(200, { shopLogo: employee.shopLogo }, "Logo updated"));
  } catch (err) {
    next(err);
  }
};

// Admin
export const getAllEmployees = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const filter = {};
    if (req.query.isVerified !== undefined) filter.isVerified = req.query.isVerified === "true";
    // Archived (soft-deleted) employees are hidden by default. Admin can
    // pass ?includeDeleted=true to inspect them; ?onlyDeleted=true to view
    // only the archive.
    if (req.query.onlyDeleted === "true") {
      filter.isDeleted = true;
    } else if (req.query.includeDeleted !== "true") {
      filter.isDeleted = { $ne: true };
    }

    const [employees, total] = await Promise.all([
      Employee.find(filter).populate("user", "name email phone").skip(skip).limit(limit).sort({ createdAt: -1 }),
      Employee.countDocuments(filter),
    ]);

    res.json(new ApiResponse(200, buildPaginatedResponse(employees, total, page, limit)));
  } catch (err) {
    next(err);
  }
};

export const verifyEmployee = async (req, res, next) => {
  try {
    const employee = await Employee.findByIdAndUpdate(
      req.params.employeeId,
      { isVerified: true },
      { new: true }
    );
    if (!employee) throw new ApiError(404, "Employee not found");

    // Notify the employee that their account is approved
    await notify({
      userId:  employee.user,
      title:   "Employee Account Approved! 🎉",
      message: `Congratulations! Your employee account for "${employee.shopName}" has been verified by admin. You can now list products and start selling.`,
      type:    "SYSTEM",
      link:    "/employee",
    });

    res.json(new ApiResponse(200, { employee }, "Employee verified"));
  } catch (err) {
    next(err);
  }
};

export const getEmployeeById = async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.employeeId).populate("user", "name email");
    if (!employee) throw new ApiError(404, "Employee not found");
    res.json(new ApiResponse(200, { employee }));
  } catch (err) {
    next(err);
  }
};

// ── Admin: update employee details + account ────────────────────────
export const updateEmployee = async (req, res, next) => {
  try {
    const { name, email, phone, newPassword, designation, department, joiningDate, monthlySalary, businessAddress, shopDescription, permissions } = req.body;

    const employee = await Employee.findById(req.params.employeeId);
    if (!employee) throw new ApiError(404, "Employee not found");

    // Update User account fields
    const user = await User.findById(employee.user).select("+password");
    if (!user) throw new ApiError(404, "User account not found");
    if (name)  user.name  = name;
    if (phone) user.phone = assertPhone(phone);
    if (email && email !== user.email) {
      const taken = await User.findOne({ email: email.toLowerCase(), _id: { $ne: user._id } });
      if (taken) throw new ApiError(409, "Email is already in use by another account");
      user.email = email.toLowerCase();
    }
    if (newPassword) user.password = newPassword; // pre-save hook hashes it
    await user.save();

    // Update Employee document
    const update = {};
    if (designation    !== undefined) update.designation    = designation;
    if (department     !== undefined) update.department     = department;
    if (businessAddress!== undefined) update.businessAddress= businessAddress;
    if (shopDescription!== undefined) update.shopDescription= shopDescription;
    if (monthlySalary  !== undefined) update.monthlySalary  = monthlySalary ? Number(monthlySalary) : 0;
    if (joiningDate)                  update.joiningDate    = joiningDate;
    if (req.body.permissions !== undefined) {
      const cleaned = sanitizePermissions(req.body.permissions);
      if (cleaned) update.permissions = cleaned;
    }

    const updated = await Employee.findByIdAndUpdate(
      req.params.employeeId, update, { new: true }
    ).populate("user", "name email phone");

    res.json(new ApiResponse(200, { employee: updated }, "Employee updated"));
  } catch (err) { next(err); }
};

// ── Admin: block / unblock employee ─────────────────────────────────
export const blockEmployee = async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.employeeId);
    if (!employee) throw new ApiError(404, "Employee not found");
    const blocked = !employee.isBlocked;
    await Promise.all([
      Employee.findByIdAndUpdate(req.params.employeeId, { isBlocked: blocked }),
      User.findByIdAndUpdate(employee.user, { isBlocked: blocked }),
    ]);
    res.json(new ApiResponse(200, { isBlocked: blocked }, `Employee ${blocked ? "blocked" : "unblocked"}`));
  } catch (err) { next(err); }
};

// ── Admin: remove employee (soft-delete) ─────────────────────────────
// Archives the employee instead of hard-deleting so all referenced data
// (products, orders, return requests, salary history) stays intact and
// remains visible to admin reports. The linked User.role reverts to
// "user", so the employee loses access to the employee panel immediately.
export const deleteEmployee = async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.employeeId);
    if (!employee) throw new ApiError(404, "Employee not found");
    if (employee.isDeleted) throw new ApiError(400, "Employee is already archived");

    employee.isDeleted = true;
    employee.deletedAt = new Date();
    employee.isBlocked = true;
    await employee.save();

    await User.findByIdAndUpdate(employee.user, { role: "user" });

    res.json(new ApiResponse(200, null, "Employee archived — their products, orders and salary history are preserved"));
  } catch (err) { next(err); }
};

// ── Admin: get salary records for an employee ────────────────────────
export const getEmployeeSalary = async (req, res, next) => {
  try {
    const records = await SalaryRecord.find({ employee: req.params.employeeId }).sort({ year: -1, month: -1 });
    const employee = await Employee.findById(req.params.employeeId).select("monthlySalary shopName designation");
    res.json(new ApiResponse(200, { records, employee }));
  } catch (err) { next(err); }
};

// ── Admin: add monthly salary record ────────────────────────────────
export const addSalaryRecord = async (req, res, next) => {
  try {
    const { month, year, baseSalary, deductions, bonuses, status, notes } = req.body;
    if (!month || !year || baseSalary == null)
      throw new ApiError(400, "month, year, and baseSalary are required");

    const exists = await SalaryRecord.findOne({ employee: req.params.employeeId, month: Number(month), year: Number(year) });
    if (exists) throw new ApiError(409, `Salary record for ${MONTH_NAMES[month]} ${year} already exists`);

    const record = new SalaryRecord({
      employee: req.params.employeeId,
      month: Number(month), year: Number(year),
      baseSalary: Number(baseSalary),
      deductions: deductions || [],
      bonuses:    bonuses    || [],
      status:     status     || "PENDING",
      notes,
    });
    await record.save();

    const employee = await Employee.findById(req.params.employeeId);
    if (employee) {
      await notify({
        userId:  employee.user,
        title:   "Salary Record Added 💰",
        message: `Your salary for ${MONTH_NAMES[month]} ${year} has been recorded. Net: ₹${record.netSalary.toLocaleString("en-IN")}.`,
        type:    "PAYMENT",
      });
    }

    res.status(201).json(new ApiResponse(201, { record }, "Salary record added"));
  } catch (err) { next(err); }
};

// ── Admin: update salary record ──────────────────────────────────────
export const updateSalaryRecord = async (req, res, next) => {
  try {
    const { baseSalary, deductions, bonuses, status, notes, paidAt } = req.body;
    const record = await SalaryRecord.findById(req.params.recordId);
    if (!record) throw new ApiError(404, "Salary record not found");

    if (baseSalary != null)   record.baseSalary  = Number(baseSalary);
    if (deductions)           record.deductions  = deductions;
    if (bonuses)              record.bonuses     = bonuses;
    if (status)               { record.status = status; if (status === "PAID") record.paidAt = paidAt || new Date(); }
    if (notes !== undefined)  record.notes       = notes;

    await record.save();
    res.json(new ApiResponse(200, { record }, "Salary record updated"));
  } catch (err) { next(err); }
};

// ── Admin: delete salary record ──────────────────────────────────────
export const deleteSalaryRecord = async (req, res, next) => {
  try {
    const record = await SalaryRecord.findByIdAndDelete(req.params.recordId);
    if (!record) throw new ApiError(404, "Salary record not found");
    res.json(new ApiResponse(200, null, "Salary record deleted"));
  } catch (err) { next(err); }
};

// ── Employee: view own salary records ───────────────────────────────
export const getMySalary = async (req, res, next) => {
  try {
    const employee = await Employee.findOne({ user: req.user._id }).select("monthlySalary designation joiningDate");
    if (!employee) throw new ApiError(404, "Employee profile not found");
    const records = await SalaryRecord.find({ employee: employee._id }).sort({ year: -1, month: -1 });
    res.json(new ApiResponse(200, { records, monthlySalary: employee.monthlySalary, designation: employee.designation, joiningDate: employee.joiningDate }));
  } catch (err) { next(err); }
};
