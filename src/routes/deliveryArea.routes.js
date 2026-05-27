import { Router } from "express";
import {
  checkLocation, getAll, getAllAdmin,
  create, update, remove, bulkImport,
} from "../controllers/deliveryArea.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { requirePermission } from "../middleware/permission.middleware.js";

const router = Router();

// Public — check by city/location name
router.get("/check/:location", checkLocation);
router.get("/check", checkLocation); // also accepts ?q=<location>
router.get("/", getAll);

// Protected — admin & employee
router.use(protect, authorize("admin", "employee"));
router.get("/admin/all", requirePermission("deliveryAreas"), getAllAdmin);
router.post("/", requirePermission("deliveryAreas.write"), create);
router.post("/bulk", requirePermission("deliveryAreas.write"), bulkImport);
router.patch("/:id", requirePermission("deliveryAreas.write"), update);
router.delete("/:id", requirePermission("deliveryAreas.write"), remove);

export default router;
