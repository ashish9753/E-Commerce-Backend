import Employee from "../models/seller.model.js";
import User from "../models/user.model.js";
import { uploadToCloudinary } from "../utils/cloudinary.utils.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import { notify, notifyAdmins } from "../utils/notify.js";

export const registerEmployee = async (req, res, next) => {
  try {
    const { shopName, gstNumber, businessAddress, bankAccountNumber, ifscCode, shopDescription } = req.body;
    if (!shopName) throw new ApiError(400, "Shop name is required");

    const existing = await Employee.findOne({ user: req.user._id });
    if (existing) throw new ApiError(409, "Employee profile already exists for this account");

    const employee = await Employee.create({
      user: req.user._id,
      shopName,
      gstNumber,
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
    const { shopName, shopDescription, businessAddress, bankAccountNumber, ifscCode, gstNumber } = req.body;
    const employee = await Employee.findOneAndUpdate(
      { user: req.user._id },
      { shopName, shopDescription, businessAddress, bankAccountNumber, ifscCode, gstNumber },
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
