import { Router } from "express";
import { getCodSettings, updateCodSettings } from "../controllers/settings.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

router.get("/cod", getCodSettings);                              // public — needed at checkout
router.patch("/cod", protect, authorize("admin", "employee"), updateCodSettings);

export default router;
