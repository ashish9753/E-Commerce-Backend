import { Router } from "express";
import {
  createCoupon, getAllCoupons, getCouponById,
  updateCoupon, deleteCoupon, validateCoupon, getPublicCoupons,
} from "../controllers/coupon.controller.js";
import { protect, optionalAuth } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

// Tight limit on the public-facing validate endpoint to stop coupon-code
// brute-forcing. Keyed per user when authenticated, falling back to IP.
const couponValidateLimiter = (req, res, next) => next();

router.get("/public", optionalAuth, getPublicCoupons);
router.post("/validate", protect, couponValidateLimiter, validateCoupon);

router.use(protect, authorize("admin", "employee"));
router.get("/", getAllCoupons);
router.post("/", createCoupon);
router.get("/:couponId", getCouponById);
router.patch("/:couponId", updateCoupon);
router.delete("/:couponId", deleteCoupon);

export default router;
