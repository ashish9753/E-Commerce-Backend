import { Router } from "express";
import { createAttribute, getAttributes, updateAttribute, deleteAttribute } from "../controllers/attribute.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

router.get("/", getAttributes);

router.use(protect, authorize("admin"));
router.post("/", createAttribute);
router.patch("/:attributeId", updateAttribute);
router.delete("/:attributeId", deleteAttribute);

export default router;
