import { Router } from "express";

import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import employeeRoutes from "./employee.routes.js";
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
import supportRoutes from "./support.routes.js";
import brandRoutes from "./brand.routes.js";
import attributeRoutes from "./attribute.routes.js";
import eventRoutes from "./event.routes.js";
import settingsRoutes from "./settings.routes.js";
import deliveryAreaRoutes from "./deliveryArea.routes.js";
import upayaRoutes from "./upaya.routes.js";
import { ORDER_TIMEOUT_MIN } from "../jobs/orderTimeout.job.js";
import ApiResponse from "../utils/ApiResponse.js";

const router = Router();

// Public config endpoint — used by the customer Orders page countdown so it
// matches the server-side sweep interval. Kept inline because it's a single
// value with no controller/model behind it.
router.get("/config/order-timeout", (_req, res) => {
  res.json(new ApiResponse(200, { timeoutMinutes: ORDER_TIMEOUT_MIN }));
});

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/employees", employeeRoutes);
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
router.use("/support", supportRoutes);
router.use("/brands", brandRoutes);
router.use("/attributes", attributeRoutes);
router.use("/events", eventRoutes);
router.use("/settings", settingsRoutes);
router.use("/delivery-areas", deliveryAreaRoutes);
router.use("/upaya", upayaRoutes);

export default router;
