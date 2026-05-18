import ApiError from "../utils/ApiError.js";
import { verifyAccessToken } from "../utils/jwt.utils.js";
import User from "../models/user.model.js";

export const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new ApiError(401, "Access token required");
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyAccessToken(token);

    const user = await User.findById(decoded._id).select("-password -refreshToken");
    if (!user) throw new ApiError(401, "User not found");
    if (user.isBlocked) throw new ApiError(403, "Your account has been blocked");

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "JsonWebTokenError") return next(new ApiError(401, "Invalid token"));
    if (err.name === "TokenExpiredError") return next(new ApiError(401, "Token expired"));
    next(err);
  }
};

export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const decoded = verifyAccessToken(token);
      const user = await User.findById(decoded._id).select("-password -refreshToken");
      if (user && !user.isBlocked) req.user = user;
    }
    next();
  } catch {
    next();
  }
};
