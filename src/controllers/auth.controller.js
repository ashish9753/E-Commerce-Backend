import crypto from "crypto";
import User from "../models/user.model.js";
import { generateTokenPair, verifyRefreshToken } from "../utils/jwt.utils.js";
import { sendEmail, passwordResetEmail } from "../utils/email.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

const REFRESH_COOKIE = "refreshToken";
// 7 days, matches REFRESH_TOKEN_EXPIRY default in jwt.utils.js.
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

// httpOnly so XSS can't read the refresh token from JS. sameSite=lax is enough
// in dev (frontend proxies through the same origin); in prod over HTTPS the
// `secure` flag flips on automatically.
const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  maxAge: REFRESH_COOKIE_MAX_AGE,
  path: "/api/v1/auth",
});

const setRefreshCookie = (res, token) => {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions());
};

const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
};

export const register = async (req, res, next) => {
  try {
    const { name, email, phone, password, role } = req.body;

    if (!name || !email || !phone || !password) {
      throw new ApiError(400, "All fields are required");
    }
    if (password.length < 8) throw new ApiError(400, "Password must be at least 8 characters");

    const existingUser = await User.findOne({ email });
    if (existingUser) throw new ApiError(409, "Email already registered");

    const user = await User.create({
      name,
      email,
      phone,
      password,
      role: "user",
    });

    const { accessToken, refreshToken } = generateTokenPair(user._id, user.role);
    await User.findByIdAndUpdate(user._id, { refreshToken });

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.refreshToken;

    setRefreshCookie(res, refreshToken);
    res.status(201).json(
      new ApiResponse(201, { user: userObj, accessToken }, "Registration successful")
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

    setRefreshCookie(res, refreshToken);
    res.json(new ApiResponse(200, { user: userObj, accessToken }, "Login successful"));
  } catch (err) {
    next(err);
  }
};

export const refreshToken = async (req, res, next) => {
  try {
    // Only accept the refresh token from the httpOnly cookie — never from a
    // header or request body. That closes the XSS exfiltration path.
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token || typeof token !== "string") throw new ApiError(401, "Refresh token required");

    const decoded = verifyRefreshToken(token);
    const user = await User.findById(decoded._id).select("+refreshToken");

    if (!user || user.refreshToken !== token) {
      clearRefreshCookie(res);
      throw new ApiError(401, "Invalid or expired refresh token");
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokenPair(user._id, user.role);
    user.refreshToken = newRefreshToken;
    await user.save({ validateBeforeSave: false });

    setRefreshCookie(res, newRefreshToken);
    res.json(new ApiResponse(200, { accessToken }, "Tokens refreshed"));
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      clearRefreshCookie(res);
      return next(new ApiError(401, "Invalid or expired refresh token"));
    }
    next(err);
  }
};

export const logout = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { refreshToken: null });
    clearRefreshCookie(res);
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
    if (!user) {
      // Return same message whether email exists or not — prevents email enumeration
      return res.json(new ApiResponse(200, null, "If this email is registered, a reset link has been sent"));
    }

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
    if (password.length < 8) throw new ApiError(400, "Password must be at least 8 characters");

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
