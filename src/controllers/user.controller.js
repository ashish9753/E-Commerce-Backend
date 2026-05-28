import User from "../models/user.model.js";
import { uploadToCloudinary } from "../utils/cloudinary.utils.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import { assertPhone, cleanPhone, isValidPhone } from "../utils/validators.utils.js";

export const getProfile = async (req, res, next) => {
  try {
    res.json(new ApiResponse(200, { user: req.user }));
  } catch (err) {
    next(err);
  }
};

export const updateProfile = async (req, res, next) => {
  try {
    const { name, phone } = req.body;
    if (name && (typeof name !== "string" || name.length > 100)) {
      throw new ApiError(400, "Invalid name");
    }
    const phoneDigits = phone ? assertPhone(phone, { required: false }) : undefined;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { ...(name && { name: name.trim() }), ...(phoneDigits && { phone: phoneDigits }) },
      { new: true, runValidators: true }
    );
    res.json(new ApiResponse(200, { user }, "Profile updated"));
  } catch (err) {
    next(err);
  }
};

export const uploadProfileImage = async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, "No image provided");
    const result = await uploadToCloudinary(req.file.buffer, "ecommerce/profiles");
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { profileImage: result.secure_url },
      { new: true }
    );
    res.json(new ApiResponse(200, { profileImage: user.profileImage }, "Profile image updated"));
  } catch (err) {
    next(err);
  }
};

export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) throw new ApiError(400, "Both passwords are required");

    const user = await User.findById(req.user._id).select("+password");
    if (!(await user.comparePassword(currentPassword))) {
      throw new ApiError(401, "Current password is incorrect");
    }

    user.password = newPassword;
    await user.save();
    res.json(new ApiResponse(200, null, "Password changed successfully"));
  } catch (err) {
    next(err);
  }
};

// Format validators kept here so add + update apply the same rules. Pincode
// is optional (Nepal-first), phone must be a 10-digit number.
const PINCODE_RE = /^\d{6}$/;
const validateAddressFormats = ({ pincode, phone }) => {
  if (pincode !== undefined && pincode !== "" && !PINCODE_RE.test(String(pincode))) {
    throw new ApiError(400, "Pincode must be exactly 6 digits");
  }
  if (phone !== undefined && !isValidPhone(phone)) {
    throw new ApiError(400, "Phone number must be exactly 10 digits");
  }
};

export const addAddress = async (req, res, next) => {
  try {
    const { fullName, phone, pincode, state, city, houseNo, area, landmark, upayaLocationId, upayaAreaId } = req.body;
    if (!fullName || !phone || !state || !city || !houseNo || !area) {
      throw new ApiError(400, "Required address fields missing");
    }
    validateAddressFormats({ pincode, phone });
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $push: { addresses: {
        fullName, phone: cleanPhone(phone), pincode: pincode || "", state, city, houseNo, area, landmark,
        upayaLocationId: upayaLocationId != null ? Number(upayaLocationId) : null,
        upayaAreaId:     upayaAreaId     != null ? Number(upayaAreaId)     : null,
      } } },
      { new: true }
    );
    res.status(201).json(new ApiResponse(201, { addresses: user.addresses }, "Address added"));
  } catch (err) {
    next(err);
  }
};

export const updateAddress = async (req, res, next) => {
  try {
    const { addressId } = req.params;
    // Whitelist allowed fields — prevents mass assignment and _id tampering
    const ALLOWED = ["fullName", "phone", "pincode", "state", "city", "houseNo", "area", "landmark"];
    const NUMERIC = ["upayaLocationId", "upayaAreaId"];
    const sanitized = {};
    for (const k of ALLOWED) {
      if (typeof req.body?.[k] === "string") sanitized[k] = req.body[k].trim();
    }
    for (const k of NUMERIC) {
      if (req.body?.[k] !== undefined) sanitized[k] = req.body[k] === null ? null : Number(req.body[k]);
    }
    validateAddressFormats(sanitized);
    if (sanitized.phone) sanitized.phone = cleanPhone(sanitized.phone);
    const setObj = {};
    for (const [k, v] of Object.entries(sanitized)) {
      setObj[`addresses.$.${k}`] = v;
    }
    if (!Object.keys(setObj).length) {
      throw new ApiError(400, "No valid fields to update");
    }
    const user = await User.findOneAndUpdate(
      { _id: req.user._id, "addresses._id": addressId },
      { $set: setObj },
      { new: true }
    );
    if (!user) throw new ApiError(404, "Address not found");
    res.json(new ApiResponse(200, { addresses: user.addresses }, "Address updated"));
  } catch (err) {
    next(err);
  }
};

export const deleteAddress = async (req, res, next) => {
  try {
    const { addressId } = req.params;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $pull: { addresses: { _id: addressId } } },
      { new: true }
    );
    res.json(new ApiResponse(200, { addresses: user.addresses }, "Address removed"));
  } catch (err) {
    next(err);
  }
};

export const getWishlist = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: "wishlist",
      select: "title price discountPrice images rating stock isDeleted",
      match: { isDeleted: false },
    });
    res.json(new ApiResponse(200, { wishlist: user.wishlist }));
  } catch (err) {
    next(err);
  }
};

export const toggleWishlist = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const user = await User.findById(req.user._id);
    const isInWishlist = user.wishlist.includes(productId);

    await User.findByIdAndUpdate(
      req.user._id,
      isInWishlist
        ? { $pull: { wishlist: productId } }
        : { $addToSet: { wishlist: productId } }
    );

    res.json(new ApiResponse(200, { inWishlist: !isInWishlist }, isInWishlist ? "Removed from wishlist" : "Added to wishlist"));
  } catch (err) {
    next(err);
  }
};

/* ─── Saved refund details (bank / UPI) ─── */
export const getSavedRefundDetails = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select("savedRefundDetails");
    res.json(new ApiResponse(200, { savedRefundDetails: user?.savedRefundDetails || {} }));
  } catch (err) { next(err); }
};

export const updateSavedRefundDetails = async (req, res, next) => {
  try {
    const { method, bankTransfer, upi } = req.body;
    const valid = ["bank_transfer", "upi"];
    if (method && !valid.includes(method)) throw new ApiError(400, "Invalid method");

    const update = {};
    if (method) update["savedRefundDetails.lastRefundMethod"] = method;
    if (bankTransfer) {
      if (bankTransfer.accountName)   update["savedRefundDetails.bankTransfer.accountName"]   = bankTransfer.accountName;
      if (bankTransfer.accountNumber) update["savedRefundDetails.bankTransfer.accountNumber"] = bankTransfer.accountNumber;
      if (bankTransfer.ifscCode)      update["savedRefundDetails.bankTransfer.ifscCode"]      = bankTransfer.ifscCode;
      if (bankTransfer.bankName)      update["savedRefundDetails.bankTransfer.bankName"]      = bankTransfer.bankName;
    }
    if (upi?.upiId) update["savedRefundDetails.upi.upiId"] = upi.upiId;

    const user = await User.findByIdAndUpdate(req.user._id, { $set: update }, { new: true }).select("savedRefundDetails");
    res.json(new ApiResponse(200, { savedRefundDetails: user?.savedRefundDetails || {} }, "Refund details saved"));
  } catch (err) { next(err); }
};

// Admin controllers
export const getAllUsers = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const filter = {};
    if (req.query.role) filter.role = req.query.role;
    if (req.query.isBlocked !== undefined) filter.isBlocked = req.query.isBlocked === "true";
    if (req.query.search) {
      const s = req.query.search.trim();
      filter.$or = [
        { name:  { $regex: s, $options: "i" } },
        { email: { $regex: s, $options: "i" } },
        { phone: { $regex: s, $options: "i" } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      User.countDocuments(filter),
    ]);

    res.json(new ApiResponse(200, buildPaginatedResponse(users, total, page, limit)));
  } catch (err) {
    next(err);
  }
};

export const getUserById = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) throw new ApiError(404, "User not found");
    res.json(new ApiResponse(200, { user }));
  } catch (err) {
    next(err);
  }
};

export const toggleBlockUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (userId === req.user._id.toString()) throw new ApiError(400, "Cannot block yourself");
    const user = await User.findById(userId);
    if (!user) throw new ApiError(404, "User not found");
    user.isBlocked = !user.isBlocked;
    await user.save({ validateBeforeSave: false });
    res.json(new ApiResponse(200, { isBlocked: user.isBlocked }, `User ${user.isBlocked ? "blocked" : "unblocked"}`));
  } catch (err) {
    next(err);
  }
};

export const deleteUser = async (req, res, next) => {
  try {
    await User.findByIdAndDelete(req.params.userId);
    res.json(new ApiResponse(200, null, "User deleted"));
  } catch (err) {
    next(err);
  }
};
