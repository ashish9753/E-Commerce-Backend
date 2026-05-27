import Employee from "../models/employee.model.js";
import ApiError from "../utils/ApiError.js";

// Mirrors `src/utils/permissions.js` on the frontend.
export const PERMISSION_KEYS = [
  "overview",
  "products", "products.write",
  "orders",   "orders.write",
  "returns",  "returns.write",
  "cancellations", "cancellations.write",
  "deliveryAreas", "deliveryAreas.write",
  "coupons",  "coupons.write",
  "support",  "support.write",
  "salary",
  "catalog",  "catalog.write",
  "banners",  "banners.write",
  "settings", "settings.write",
];

export const DEFAULT_PERMISSIONS = PERMISSION_KEYS;

// Filter an incoming permissions array down to the known keys. Anything else
// is silently dropped so the request can't grant unknown perms.
export const sanitizePermissions = (incoming) => {
  if (!Array.isArray(incoming)) return undefined;
  const set = new Set(PERMISSION_KEYS);
  const cleaned = [...new Set(incoming.filter((p) => typeof p === "string" && set.has(p)))];
  return cleaned;
};

// Middleware: require that an employee has every listed permission key.
// Admins always pass. Anonymous users are rejected by `protect` upstream, so
// at this point we have a logged-in user.
export const requirePermission = (...required) => async (req, res, next) => {
  try {
    if (!req.user) throw new ApiError(401, "Authentication required");
    if (req.user.role === "admin") return next();
    if (req.user.role !== "employee") throw new ApiError(403, "Forbidden");

    const employee = await Employee.findOne({ user: req.user._id }).select("permissions isBlocked");
    if (!employee) throw new ApiError(403, "Employee profile not found");
    if (employee.isBlocked) throw new ApiError(403, "Account blocked");

    // Legacy employees without a permissions array are treated as fully privileged
    // so existing behaviour doesn't break the day this ships.
    const perms = Array.isArray(employee.permissions) && employee.permissions.length
      ? employee.permissions
      : PERMISSION_KEYS;

    const missing = required.find((k) => !perms.includes(k));
    if (missing) throw new ApiError(403, `You don't have permission: ${missing}`);
    next();
  } catch (err) {
    next(err);
  }
};
