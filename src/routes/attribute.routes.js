import { Router } from "express";
import { createAttribute, getAttributes, updateAttribute, deleteAttribute } from "../controllers/attribute.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { requirePermission } from "../middleware/permission.middleware.js";

const router = Router();

router.get("/", getAttributes);

router.use(protect, authorize("admin", "employee"));
router.post("/", requirePermission("catalog.write"), createAttribute);
router.patch("/:attributeId", requirePermission("catalog.write"), updateAttribute);
router.delete("/:attributeId", requirePermission("catalog.write"), deleteAttribute);

export default router;
