import jwt from "jsonwebtoken";

// Session duration by role: admins and employees get 1 day, regular users get 7 days.
export const getRefreshTokenExpiry = (role) =>
  role === "admin" || role === "employee" ? "1d" : "7d";

export const getRefreshCookieMaxAge = (role) =>
  role === "admin" || role === "employee"
    ? 1 * 24 * 60 * 60 * 1000
    : 7 * 24 * 60 * 60 * 1000;

export const generateAccessToken = (payload) =>
  jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: process.env.ACCESS_TOKEN_EXPIRY || "15m",
  });

export const generateRefreshToken = (payload, role) =>
  jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: getRefreshTokenExpiry(role),
  });

export const verifyAccessToken = (token) =>
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

export const verifyRefreshToken = (token) =>
  jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);

export const generateTokenPair = (userId, role) => {
  const accessToken = generateAccessToken({ _id: userId, role });
  const refreshToken = generateRefreshToken({ _id: userId }, role);
  return { accessToken, refreshToken };
};
