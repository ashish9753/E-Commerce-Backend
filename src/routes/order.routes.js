import { Router } from "express";
import {
  placeOrder, getMyOrders, getOrderById, cancelOrder,
  getAllOrders, updateOrderStatus, getOrderStats, getEmployeeOrders,
  employeeUpdateOrderStatus, adminForceRefund, processCancellationRefund,
  retryUpayaDispatch, getUpayaTracking,
} from "../controllers/order.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { uploadRefundProof } from "../middleware/upload.middleware.js";

const router = Router();

router.use(protect);

router.post("/", placeOrder);
router.get("/my", getMyOrders);

// Employee — static routes MUST come before /:orderId
router.get("/employee/my-orders",         authorize("employee", "admin"), getEmployeeOrders);

// Admin — static routes MUST come before /:orderId
router.get("/", authorize("admin"), getAllOrders);
router.get("/admin/stats", authorize("admin"), getOrderStats);

// Parameterized routes last
router.get("/:orderId", getOrderById);
router.patch("/:orderId/cancel", cancelOrder);
router.patch("/:orderId/employee-status", authorize("employee"), employeeUpdateOrderStatus);
router.patch("/:orderId/status", authorize("admin"), updateOrderStatus);
router.post("/:orderId/force-refund", authorize("admin"), adminForceRefund);
router.patch("/:orderId/process-refund", authorize("admin", "employee"), uploadRefundProof, processCancellationRefund);

// Upaya — retry dispatch (admin/employee), live tracking (any signed-in user
// can read their own order; controller enforces ownership)
router.post("/:orderId/upaya/retry", authorize("admin", "employee"), retryUpayaDispatch);
router.get("/:orderId/upaya/tracking", getUpayaTracking);

export default router;
