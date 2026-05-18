import { Router } from "express";
import {
  getCart, addToCart, updateCartItem, removeFromCart,
  clearCart, applyCoupon, removeCoupon,
} from "../controllers/cart.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = Router();

router.use(protect);

router.get("/", getCart);
router.post("/items", addToCart);
router.patch("/items", updateCartItem);
router.delete("/items/:productId", removeFromCart);
router.delete("/", clearCart);
router.post("/coupon", applyCoupon);
router.delete("/coupon", removeCoupon);

export default router;
