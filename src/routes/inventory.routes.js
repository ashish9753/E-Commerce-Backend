import { Router } from "express";
import {
  restockProduct, adjustStock,
  getInventoryLogs, getLowStockProducts,
} from "../controllers/inventory.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

router.use(protect);

router.post("/restock", authorize("seller", "admin"), restockProduct);
router.patch("/adjust", authorize("admin"), adjustStock);
router.get("/logs", authorize("seller", "admin"), getInventoryLogs);
router.get("/low-stock", authorize("seller", "admin"), getLowStockProducts);

export default router;
