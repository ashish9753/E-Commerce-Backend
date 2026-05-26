import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  register, login, logout, refreshToken,
  forgotPassword, resetPassword, getMe,
  googleAuth, googleRegister,
} from "../controllers/auth.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = Router();

// All limits are PER-IP — `app.set('trust proxy', 1)` in app.js makes that
// work correctly behind Render's edge. Numbers are deliberately generous so
// real users (refresh, browser autofill retry, fat-finger password) never
// hit them; only abusive loops will.

// Brute-force-sensitive endpoints (password guessing, email enumeration).
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15-minute window
  max: 30,                     // 30 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts. Please try again in 15 minutes." },
});

// Signup-style endpoints — slightly more lenient because legitimate users
// sometimes fumble (typo email, retry Google flow, etc.).
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many sign-up attempts. Please try again later." },
});

// Token refresh fires in the background whenever the 15-min access token
// expires, so this needs a much higher ceiling than the others.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Refresh rate exceeded." },
});

router.post("/register",       signupLimiter,    register);
router.post("/login",          sensitiveLimiter, login);
router.post("/google",         signupLimiter,    googleAuth);
router.post("/google/complete",signupLimiter,    googleRegister);
router.post("/refresh-token",  refreshLimiter,   refreshToken);
router.post("/forgot-password",sensitiveLimiter, forgotPassword);
router.patch("/reset-password/:token", sensitiveLimiter, resetPassword);
router.post("/logout", protect, logout);
router.get("/me",      protect, getMe);

export default router;
