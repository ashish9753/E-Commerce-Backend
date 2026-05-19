import Seller from "../models/seller.model.js";
import User from "../models/user.model.js";
import { uploadToCloudinary } from "../utils/cloudinary.utils.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import { notify, notifyAdmins } from "../utils/notify.js";

export const registerSeller = async (req, res, next) => {
  try {
    const { shopName, gstNumber, businessAddress, bankAccountNumber, ifscCode, shopDescription } = req.body;
    if (!shopName) throw new ApiError(400, "Shop name is required");

    const existing = await Seller.findOne({ user: req.user._id });
    if (existing) throw new ApiError(409, "Seller profile already exists for this account");

    const seller = await Seller.create({
      user: req.user._id,
      shopName,
      gstNumber,
      businessAddress,
      bankAccountNumber,
      ifscCode,
      shopDescription,
    });

    await User.findByIdAndUpdate(req.user._id, { role: "seller" });

    // Notify the new seller
    await notify({
      userId:  req.user._id,
      title:   "Seller Registration Submitted 🏪",
      message: `Your seller account for "${shopName}" has been submitted and is pending admin verification. You'll be notified once approved.`,
      type:    "SYSTEM",
    });

    // Notify admins
    await notifyAdmins({
      title:   "New Seller Registration 🏪",
      message: `${req.user.name || "A user"} registered as a seller with shop "${shopName}". Please review and verify.`,
      type:    "SYSTEM",
      link:    "/admin",
    });

    res.status(201).json(new ApiResponse(201, { seller }, "Seller registered. Pending verification."));
  } catch (err) {
    next(err);
  }
};

export const getMySellerProfile = async (req, res, next) => {
  try {
    const seller = await Seller.findOne({ user: req.user._id }).populate("user", "name email phone");
    if (!seller) throw new ApiError(404, "Seller profile not found");
    res.json(new ApiResponse(200, { seller }));
  } catch (err) {
    next(err);
  }
};

export const updateSellerProfile = async (req, res, next) => {
  try {
    const { shopName, shopDescription, businessAddress, bankAccountNumber, ifscCode, gstNumber } = req.body;
    const seller = await Seller.findOneAndUpdate(
      { user: req.user._id },
      { shopName, shopDescription, businessAddress, bankAccountNumber, ifscCode, gstNumber },
      { new: true, runValidators: true }
    );
    if (!seller) throw new ApiError(404, "Seller profile not found");
    res.json(new ApiResponse(200, { seller }, "Profile updated"));
  } catch (err) {
    next(err);
  }
};

export const uploadShopLogo = async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, "No image provided");
    const result = await uploadToCloudinary(req.file.buffer, "ecommerce/shops");
    const seller = await Seller.findOneAndUpdate(
      { user: req.user._id },
      { shopLogo: result.secure_url },
      { new: true }
    );
    res.json(new ApiResponse(200, { shopLogo: seller.shopLogo }, "Logo updated"));
  } catch (err) {
    next(err);
  }
};

// Admin
export const getAllSellers = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const filter = {};
    if (req.query.isVerified !== undefined) filter.isVerified = req.query.isVerified === "true";

    const [sellers, total] = await Promise.all([
      Seller.find(filter).populate("user", "name email phone").skip(skip).limit(limit).sort({ createdAt: -1 }),
      Seller.countDocuments(filter),
    ]);

    res.json(new ApiResponse(200, buildPaginatedResponse(sellers, total, page, limit)));
  } catch (err) {
    next(err);
  }
};

export const verifySeller = async (req, res, next) => {
  try {
    const seller = await Seller.findByIdAndUpdate(
      req.params.sellerId,
      { isVerified: true },
      { new: true }
    );
    if (!seller) throw new ApiError(404, "Seller not found");

    // Notify the seller that their account is approved
    await notify({
      userId:  seller.user,
      title:   "Seller Account Approved! 🎉",
      message: `Congratulations! Your seller account for "${seller.shopName}" has been verified by admin. You can now list products and start selling.`,
      type:    "SYSTEM",
      link:    "/seller",
    });

    res.json(new ApiResponse(200, { seller }, "Seller verified"));
  } catch (err) {
    next(err);
  }
};

export const getSellerById = async (req, res, next) => {
  try {
    const seller = await Seller.findById(req.params.sellerId).populate("user", "name email");
    if (!seller) throw new ApiError(404, "Seller not found");
    res.json(new ApiResponse(200, { seller }));
  } catch (err) {
    next(err);
  }
};
