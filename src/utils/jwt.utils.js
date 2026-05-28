import jwt from "jsonwebtoken";
import crypto from "crypto";

// Session duration by role:
//   admin / employee → 1 day  (hard cap, single-session enforced)
//   regular user     → 30 days (multiple concurrent sessions allowed, no
//                                single-session restriction)
export const getRefreshTokenExpiry = (role) =>
  role === "admin" || role === "employee" ? "1d" : "30d";

export const getRefreshCookieMaxAge = (role) =>
  role === "admin" || role === "employee"
    ? 1  * 24 * 60 * 60 * 1000
    : 30 * 24 * 60 * 60 * 1000;

// Access-token lifetime — also lifted for regular users so they're not
// silently bounced to the login page after going idle for a few hours
// without making an API call (the refresh would still work, but skipping
// the round-trip when we don't need it is nicer UX).
//   admin / employee → 1 day  (matches refresh cap)
//   regular user     → 30 days
//   override via env ACCESS_TOKEN_EXPIRY only if you genuinely want shorter
const accessTokenExpiry = (role) => {
  if (role === "admin" || role === "employee") return "1d";
  return process.env.ACCESS_TOKEN_EXPIRY || "30d";
};

export const generateAccessToken = (payload, role) =>
  jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: accessTokenExpiry(role),
  });

export const generateRefreshToken = (payload, role) =>
  jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: getRefreshTokenExpiry(role),
  });

export const verifyAccessToken = (token) =>
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

export const verifyRefreshToken = (token) =>
  jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);

// `sid` is included in both tokens. For admin/employee it must match the
// user's `activeSessionId` on every authenticated request — otherwise the
// session is treated as revoked (because somebody else logged into the
// same account). Regular users get a sid too, but it's ignored.
export const generateSessionId = () => crypto.randomBytes(16).toString("hex");

export const generateTokenPair = (userId, role, sessionId) => {
  const sid = sessionId || generateSessionId();
  const accessToken  = generateAccessToken({ _id: userId, role, sid }, role);
  const refreshToken = generateRefreshToken({ _id: userId, sid }, role);
  return { accessToken, refreshToken, sessionId: sid };
};
