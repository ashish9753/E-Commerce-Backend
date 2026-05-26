import { Router } from "express";
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
const sensitiveLimiter = (req, res, next) => next();

// Signup-style endpoints — slightly more lenient because legitimate users
// sometimes fumble (typo email, retry Google flow, etc.).
const signupLimiter = (req, res, next) => next();

// Token refresh fires in the background whenever the 15-min access token
// expires, so this needs a much higher ceiling than the others.
const refreshLimiter = (req, res, next) => next();

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
