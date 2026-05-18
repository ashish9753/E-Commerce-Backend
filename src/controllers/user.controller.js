import User from "../models/user.model.js";
import { uploadToCloudinary } from "../utils/cloudinary.utils.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

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
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { ...(name && { name }), ...(phone && { phone }) },
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

export const addAddress = async (req, res, next) => {
  try {
    const { fullName, phone, pincode, state, city, houseNo, area, landmark } = req.body;
    if (!fullName || !phone || !pincode || !state || !city || !houseNo || !area) {
      throw new ApiError(400, "Required address fields missing");
    }
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $push: { addresses: { fullName, phone, pincode, state, city, houseNo, area, landmark } } },
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
    const updates = req.body;
    const user = await User.findOneAndUpdate(
      { _id: req.user._id, "addresses._id": addressId },
      { $set: { "addresses.$": { ...updates, _id: addressId } } },
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

// Admin controllers
export const getAllUsers = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const filter = {};
    if (req.query.role) filter.role = req.query.role;
    if (req.query.isBlocked !== undefined) filter.isBlocked = req.query.isBlocked === "true";

    const [users, total] = await Promise.all([
      User.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      User.countDocuments(filter),
    ]);

    res.json(new ApiResponse(200, buildPaginatedResponse(users, total, page, limit)));
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
