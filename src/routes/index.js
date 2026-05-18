import { Router } from "express";

import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import sellerRoutes from "./seller.routes.js";
import categoryRoutes from "./category.routes.js";
import productRoutes from "./product.routes.js";
import cartRoutes from "./cart.routes.js";
import couponRoutes from "./coupon.routes.js";
import orderRoutes from "./order.routes.js";
import paymentRoutes from "./payment.routes.js";
import reviewRoutes from "./review.routes.js";
import notificationRoutes from "./notification.routes.js";
import returnRequestRoutes from "./returnRequest.routes.js";
import inventoryRoutes from "./inventory.routes.js";
import chatRoutes from "./chat.routes.js";
import bannerRoutes from "./banner.routes.js";
import recentlyViewedRoutes from "./recentlyViewed.routes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/sellers", sellerRoutes);
router.use("/categories", categoryRoutes);
router.use("/products", productRoutes);
router.use("/cart", cartRoutes);
router.use("/coupons", couponRoutes);
router.use("/orders", orderRoutes);
router.use("/payments", paymentRoutes);
router.use("/reviews", reviewRoutes);
router.use("/notifications", notificationRoutes);
router.use("/returns", returnRequestRoutes);
router.use("/inventory", inventoryRoutes);
router.use("/chat", chatRoutes);
router.use("/banners", bannerRoutes);
router.use("/recently-viewed", recentlyViewedRoutes);

export default router;
