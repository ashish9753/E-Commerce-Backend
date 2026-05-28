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

    // Include activeSessionId so we can do the single-session check below.
    const user = await User.findById(decoded._id).select("-password -refreshToken +activeSessionId");
    if (!user) throw new ApiError(401, "User not found");
    if (user.isBlocked) throw new ApiError(403, "Your account has been blocked");

    // Single-session enforcement for admin/employee. If the user logs in
    // somewhere else, activeSessionId rotates and any older token's `sid`
    // stops matching → instant force-logout on the next request. The error
    // code "SESSION_REPLACED" is recognised by the frontend interceptor so
    // it can show the right message and skip the normal refresh attempt.
    const isStaff = user.role === "admin" || user.role === "employee";
    if (isStaff && user.activeSessionId && decoded.sid !== user.activeSessionId) {
      throw new ApiError(401, "SESSION_REPLACED: signed in from another location");
    }

    // Strip the session field before exposing the user — controllers don't
    // need it and we never want it leaking into a JSON response.
    user.activeSessionId = undefined;
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
      const user = await User.findById(decoded._id).select("-password -refreshToken +activeSessionId");
      const isStaff = user && (user.role === "admin" || user.role === "employee");
      if (user && !user.isBlocked && !(isStaff && user.activeSessionId && decoded.sid !== user.activeSessionId)) {
        user.activeSessionId = undefined;
        req.user = user;
      }
    }
    next();
  } catch {
    next();
  }
};
