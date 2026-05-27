// Shared field validators. Keep them small and dependency-free so they can be
// reused from any controller.

// Accepts only a 10-digit mobile number. Allows the caller to pass anything
// with surrounding spaces / dashes / plus signs — we strip non-digits before
// counting, but the resulting digit count must equal 10.
export const PHONE_RE = /^\d{10}$/;

export const cleanPhone = (v) => String(v ?? "").replace(/\D/g, "");

export const isValidPhone = (v) => PHONE_RE.test(cleanPhone(v));

// Throws an ApiError(400) with the field-specific message if the phone is set
// but invalid. `required` controls whether an empty/undefined value is OK.
import ApiError from "./ApiError.js";
export const assertPhone = (phone, { required = true } = {}) => {
  const trimmed = phone == null ? "" : String(phone).trim();
  if (!trimmed) {
    if (required) throw new ApiError(400, "Phone number is required");
    return "";
  }
  const digits = cleanPhone(trimmed);
  if (!PHONE_RE.test(digits)) {
    throw new ApiError(400, "Phone number must be exactly 10 digits");
  }
  return digits;
};
