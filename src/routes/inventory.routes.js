import { Router } from "express";
import {
  restockProduct, adjustStock,
  getInventoryLogs, getLowStockProducts, getInventoryAnalytics,
} from "../controllers/inventory.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

router.use(protect);

router.post("/restock", authorize("employee", "admin"), restockProduct);
router.patch("/adjust", authorize("admin"), adjustStock);
router.get("/logs", authorize("employee", "admin"), getInventoryLogs);
router.get("/low-stock",  authorize("employee", "admin"), getLowStockProducts);
router.get("/analytics", authorize("admin"),              getInventoryAnalytics);

export default router;
