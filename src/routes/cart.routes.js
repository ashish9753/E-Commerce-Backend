import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  getCart, addToCart, updateCartItem, removeFromCart,
  clearCart, applyCoupon, removeCoupon,
} from "../controllers/cart.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = Router();

router.use(protect);

// Same protection as /coupons/validate — applying a coupon to the cart is
// the other code-guessing path, so it gets the same per-user budget.
const couponApplyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  message: { message: "Too many coupon attempts, please wait a minute." },
});

router.get("/", getCart);
router.post("/items", addToCart);
router.patch("/items", updateCartItem);
router.delete("/items/:productId", removeFromCart);
router.delete("/", clearCart);
router.post("/coupon", couponApplyLimiter, applyCoupon);
router.delete("/coupon", removeCoupon);

export default router;
