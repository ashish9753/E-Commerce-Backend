import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  register, login, logout, refreshToken,
  forgotPassword, resetPassword, getMe,
} from "../controllers/auth.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many auth attempts, please try again in 15 minutes." },
});

router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.post("/refresh-token", refreshToken);
router.post("/forgot-password", authLimiter, forgotPassword);
router.patch("/reset-password/:token", resetPassword);
router.post("/logout", protect, logout);
router.get("/me", protect, getMe);

export default router;
