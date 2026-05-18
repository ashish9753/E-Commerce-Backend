import { Router } from "express";
import {
  register, login, logout, refreshToken,
  forgotPassword, resetPassword, getMe,
} from "../controllers/auth.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/refresh-token", refreshToken);
router.post("/forgot-password", forgotPassword);
router.patch("/reset-password/:token", resetPassword);
router.post("/logout", protect, logout);
router.get("/me", protect, getMe);

export default router;
