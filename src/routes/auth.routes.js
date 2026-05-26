import { Router } from "express";
import {
  register, login, logout, refreshToken,
  forgotPassword, resetPassword, getMe,
  googleAuth, googleRegister,
} from "../controllers/auth.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = Router();

// Rate limiting intentionally disabled here. Behind Render's edge proxy every
// request appears to come from the same IP, so a per-IP limiter collapses to
// a single global bucket and locks everyone out. When you re-enable, make
// sure app.js sets `app.set('trust proxy', 1)` so the limiter sees the real
// client IP from X-Forwarded-For first.

router.post("/register", register);
router.post("/login", login);
router.post("/google", googleAuth);
router.post("/google/complete", googleRegister);
router.post("/refresh-token", refreshToken);
router.post("/forgot-password", forgotPassword);
router.patch("/reset-password/:token", resetPassword);
router.post("/logout", protect, logout);
router.get("/me", protect, getMe);

export default router;
