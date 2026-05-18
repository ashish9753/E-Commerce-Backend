import crypto from "crypto";
import User from "../models/user.model.js";
import { generateTokenPair, verifyRefreshToken } from "../utils/jwt.utils.js";
import { sendEmail, passwordResetEmail } from "../utils/email.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

export const register = async (req, res, next) => {
  try {
    const { name, email, phone, password, role } = req.body;

    if (!name || !email || !phone || !password) {
      throw new ApiError(400, "All fields are required");
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) throw new ApiError(409, "Email already registered");

    const allowedRoles = ["user", "seller"];
    const user = await User.create({
      name,
      email,
      phone,
      password,
      role: allowedRoles.includes(role) ? role : "user",
    });

    const { accessToken, refreshToken } = generateTokenPair(user._id, user.role);
    await User.findByIdAndUpdate(user._id, { refreshToken });

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.refreshToken;

    res.status(201).json(
      new ApiResponse(201, { user: userObj, accessToken, refreshToken }, "Registration successful")
    );
  } catch (err) {
    next(err);
  }
};

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) throw new ApiError(400, "Email and password required");

    const user = await User.findOne({ email }).select("+password +refreshToken");
    if (!user || !(await user.comparePassword(password))) {
      throw new ApiError(401, "Invalid email or password");
    }
    if (user.isBlocked) throw new ApiError(403, "Your account has been blocked");

    const { accessToken, refreshToken } = generateTokenPair(user._id, user.role);
    user.refreshToken = refreshToken;
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.refreshToken;

    res.json(new ApiResponse(200, { user: userObj, accessToken, refreshToken }, "Login successful"));
  } catch (err) {
    next(err);
  }
};

export const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken: token } = req.body;
    if (!token) throw new ApiError(400, "Refresh token required");

    const decoded = verifyRefreshToken(token);
    const user = await User.findById(decoded._id).select("+refreshToken");

    if (!user || user.refreshToken !== token) {
      throw new ApiError(401, "Invalid or expired refresh token");
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokenPair(user._id, user.role);
    user.refreshToken = newRefreshToken;
    await user.save({ validateBeforeSave: false });

    res.json(new ApiResponse(200, { accessToken, refreshToken: newRefreshToken }, "Tokens refreshed"));
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      return next(new ApiError(401, "Invalid or expired refresh token"));
    }
    next(err);
  }
};

export const logout = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { refreshToken: null });
    res.json(new ApiResponse(200, null, "Logged out successfully"));
  } catch (err) {
    next(err);
  }
};

export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) throw new ApiError(400, "Email is required");

    const user = await User.findOne({ email });
    if (!user) throw new ApiError(404, "No user found with this email");

    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = crypto.createHash("sha256").update(resetToken).digest("hex");
    user.resetPasswordExpiry = new Date(Date.now() + 15 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;
    await sendEmail({ to: user.email, ...passwordResetEmail(user.name, resetUrl) });

    res.json(new ApiResponse(200, null, "Password reset email sent"));
  } catch (err) {
    next(err);
  }
};

export const resetPassword = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password) throw new ApiError(400, "New password is required");

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpiry: { $gt: Date.now() },
    });

    if (!user) throw new ApiError(400, "Invalid or expired reset token");

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiry = undefined;
    user.refreshToken = null;
    await user.save();

    res.json(new ApiResponse(200, null, "Password reset successful. Please log in."));
  } catch (err) {
    next(err);
  }
};

export const getMe = async (req, res, next) => {
  try {
    res.json(new ApiResponse(200, { user: req.user }));
  } catch (err) {
    next(err);
  }
};
