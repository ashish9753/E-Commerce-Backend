import { Router } from "express";
import {
  createCoupon, getAllCoupons, getCouponById,
  updateCoupon, deleteCoupon, validateCoupon,
} from "../controllers/coupon.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

router.post("/validate", protect, validateCoupon);

router.use(protect, authorize("admin", "employee"));
router.get("/", getAllCoupons);
router.post("/", createCoupon);
router.get("/:couponId", getCouponById);
router.patch("/:couponId", updateCoupon);
router.delete("/:couponId", deleteCoupon);

export default router;
