import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import User from "../models/user.model.js";
import { generateTokenPair, generateSessionId, verifyRefreshToken, getRefreshCookieMaxAge } from "../utils/jwt.utils.js";
import { sendEmail, passwordResetEmail } from "../utils/email.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import { assertPhone } from "../utils/validators.utils.js";

// Single OAuth2Client used to verify Google ID tokens against our client_id.
// Re-uses Google's public keys cache so we don't refetch JWKS on every request.
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const verifyGoogleIdToken = async (idToken) => {
  if (!idToken) throw new ApiError(400, "Google ID token is required");
  if (!process.env.GOOGLE_CLIENT_ID) {
    throw new ApiError(500, "Google sign-in is not configured on the server");
  }
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email_verified) {
      throw new ApiError(401, "Google account email is not verified");
    }
    return {
      googleId: payload.sub,
      email: payload.email.toLowerCase(),
      name: payload.name || payload.email.split("@")[0],
      picture: payload.picture,
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(401, "Invalid or expired Google token");
  }
};

const issueSessionForUser = async (req, res, user) => {
  if (user.isBlocked) throw new ApiError(403, "Your account has been blocked");
  // Mint a fresh sessionId on every login. For admin/employee this is what
  // forces any previously-open browser/tab to lose access on its next API
  // call (auth middleware compares the token's `sid` to `activeSessionId`).
  const sessionId = generateSessionId();
  const { accessToken, refreshToken } = generateTokenPair(user._id, user.role, sessionId);
  user.refreshToken = refreshToken;
  user.activeSessionId = sessionId;
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });
  const userObj = user.toObject();
  delete userObj.password;
  delete userObj.refreshToken;
  delete userObj.activeSessionId;
  setRefreshCookie(req, res, refreshToken, user.role);
  return { user: userObj, accessToken };
};

const REFRESH_COOKIE = "refreshToken";

// Cookie attributes are derived from the live request, not NODE_ENV, so the
// cookie always matches the connection. Why this matters:
//
//   * Cross-site fetch (frontend on Render, backend on Render — different
//     hostnames) only carries cookies if SameSite=None AND Secure.
//   * Modern browsers reject Secure cookies on plain http:// (except
//     localhost), so we must NOT set Secure on http requests.
//
// `req.secure` works correctly because app.js sets `trust proxy: 1` — the
// flag reads `X-Forwarded-Proto` from Render's edge. If env var slips out of
// sync (no NODE_ENV=production set) cookies still work.
const refreshCookieOptions = (req, role) => {
  const isHttps = !!(req?.secure || process.env.NODE_ENV === "production");
  return {
    httpOnly: true,                          // not readable from JS — XSS-safe
    secure: isHttps,                         // browser will reject otherwise
    sameSite: isHttps ? "none" : "lax",      // None+Secure for cross-site
    maxAge: getRefreshCookieMaxAge(role),
    path: "/api/v1/auth",
  };
};

const setRefreshCookie = (req, res, token, role) => {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions(req, role));
};

const clearRefreshCookie = (req, res) => {
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(req, "user"), maxAge: undefined });
};

export const register = async (req, res, next) => {
  try {
    const { name, email, phone, password, role } = req.body;

    if (!name || !email || !phone || !password) {
      throw new ApiError(400, "All fields are required");
    }
    if (password.length < 8) throw new ApiError(400, "Password must be at least 8 characters");
    const phoneDigits = assertPhone(phone);

    const existingUser = await User.findOne({ email });
    if (existingUser) throw new ApiError(409, "Email already registered");

    const user = await User.create({
      name,
      email,
      phone: phoneDigits,
      password,
      role: "user",
    });

    const sessionId = generateSessionId();
    const { accessToken, refreshToken } = generateTokenPair(user._id, user.role, sessionId);
    await User.findByIdAndUpdate(user._id, { refreshToken, activeSessionId: sessionId });

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.refreshToken;

    setRefreshCookie(req, res, refreshToken, user.role);
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

    const sessionId = generateSessionId();
    const { accessToken, refreshToken } = generateTokenPair(user._id, user.role, sessionId);
    user.refreshToken = refreshToken;
    user.activeSessionId = sessionId;
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.refreshToken;

    setRefreshCookie(req, res, refreshToken, user.role);
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
    const user = await User.findById(decoded._id).select("+refreshToken +activeSessionId");

    if (!user || user.refreshToken !== token) {
      clearRefreshCookie(req, res);
      throw new ApiError(401, "Invalid or expired refresh token");
    }

    // Single-session enforcement: if admin/employee logged in on another
    // device after this refresh token was issued, activeSessionId will have
    // rotated and this refresh attempt must fail with a recognisable code.
    const isStaff = user.role === "admin" || user.role === "employee";
    if (isStaff && user.activeSessionId && decoded.sid !== user.activeSessionId) {
      clearRefreshCookie(req, res);
      return next(new ApiError(401, "SESSION_REPLACED: signed in from another location"));
    }

    // Reuse the existing sid — refresh keeps the same session, doesn't fork it.
    const { accessToken, refreshToken: newRefreshToken } = generateTokenPair(
      user._id, user.role, decoded.sid || user.activeSessionId
    );
    user.refreshToken = newRefreshToken;
    await user.save({ validateBeforeSave: false });

    setRefreshCookie(req, res, newRefreshToken, user.role);
    res.json(new ApiResponse(200, { accessToken }, "Tokens refreshed"));
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      clearRefreshCookie(req, res);
      return next(new ApiError(401, "Invalid or expired refresh token"));
    }
    next(err);
  }
};

export const logout = async (req, res, next) => {
  try {
    // Wipe the session pointer too — guarantees any leftover access token
    // (admin/employee) immediately fails the sid check.
    await User.findByIdAndUpdate(req.user._id, { refreshToken: null, activeSessionId: null });
    clearRefreshCookie(req, res);
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

/**
 * Step 1 of Google sign-in. Verify the ID token from the client.
 *  - If a user with this email/googleId already exists → log them in directly.
 *  - Otherwise return the verified profile so the frontend can show a
 *    "complete your profile" form. We do NOT create the user here, because
 *    we still need phone/password from them before the account is usable.
 */
export const googleAuth = async (req, res, next) => {
  try {
    const { idToken } = req.body;
    const profile = await verifyGoogleIdToken(idToken);

    // Match by googleId first, then by verified email (handles users who
    // originally signed up with email/password and are now linking Google).
    let user = await User.findOne({
      $or: [{ googleId: profile.googleId }, { email: profile.email }],
    }).select("+refreshToken");

    if (user) {
      // Link Google if it wasn't linked before. Email coming from Google is
      // verified, so we can mark emailVerified=true on existing accounts too.
      let dirty = false;
      if (!user.googleId) { user.googleId = profile.googleId; dirty = true; }
      if (!user.emailVerified) { user.emailVerified = true; dirty = true; }
      if (!user.profileImage && profile.picture) { user.profileImage = profile.picture; dirty = true; }
      if (dirty) await user.save({ validateBeforeSave: false });

      const session = await issueSessionForUser(req, res, user);
      return res.json(new ApiResponse(200, { ...session, needsRegistration: false }, "Logged in with Google"));
    }

    // New user — frontend will show the completion form. We send back the
    // verified profile (and echo the idToken so the next call can re-verify
    // server-side; we never trust the email coming straight from req.body).
    return res.json(new ApiResponse(200, {
      needsRegistration: true,
      profile: { email: profile.email, name: profile.name, picture: profile.picture },
    }, "Google verified. Please complete your profile."));
  } catch (err) {
    next(err);
  }
};

/**
 * Step 2 of Google sign-in for new users. Re-verifies the idToken so we never
 * trust the email field from req.body, then creates the user with the
 * profile fields they filled in (phone + optional password).
 */
export const googleRegister = async (req, res, next) => {
  try {
    const { idToken, name, phone, password } = req.body;
    const profile = await verifyGoogleIdToken(idToken);

    if (!name || !name.trim()) throw new ApiError(400, "Name is required");
    const phoneDigits = assertPhone(phone);
    if (password && password.length < 8) {
      throw new ApiError(400, "Password must be at least 8 characters");
    }

    // Guard against the race where a user signed up between googleAuth and
    // googleRegister — fall back to logging them in.
    const existing = await User.findOne({
      $or: [{ googleId: profile.googleId }, { email: profile.email }],
    }).select("+refreshToken");
    if (existing) {
      if (!existing.googleId) existing.googleId = profile.googleId;
      existing.emailVerified = true;
      const session = await issueSessionForUser(req, res, existing);
      return res.json(new ApiResponse(200, { ...session, needsRegistration: false }, "Logged in with Google"));
    }

    const user = await User.create({
      name: name.trim(),
      email: profile.email,            // verified — comes from the Google token, not the body
      phone: phoneDigits,
      password: password || undefined, // optional; Google-only users can leave it blank
      googleId: profile.googleId,
      emailVerified: true,
      profileImage: profile.picture,
      role: "user",
    });

    const session = await issueSessionForUser(req, res, user);
    res.status(201).json(new ApiResponse(201, { ...session, needsRegistration: false }, "Registration successful"));
  } catch (err) {
    next(err);
  }
};
