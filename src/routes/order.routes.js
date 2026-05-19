import { Router } from "express";
import {
  placeOrder, getMyOrders, getOrderById, cancelOrder,
  getAllOrders, updateOrderStatus, getOrderStats, getEmployeeOrders,
  employeeUpdateOrderStatus, adminForceRefund,
} from "../controllers/order.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

router.use(protect);

router.post("/", placeOrder);
router.get("/my", getMyOrders);
router.get("/:orderId", getOrderById);
router.patch("/:orderId/cancel", cancelOrder);

// Employee
router.get("/employee/my-orders",              authorize("employee", "admin"), getEmployeeOrders);
router.patch("/:orderId/employee-status",      authorize("employee"),          employeeUpdateOrderStatus);

// Admin
router.get("/", authorize("admin"), getAllOrders);
router.get("/admin/stats", authorize("admin"), getOrderStats);
router.patch("/:orderId/status", authorize("admin"), updateOrderStatus);
router.post("/:orderId/force-refund", authorize("admin"), adminForceRefund);

export default router;
