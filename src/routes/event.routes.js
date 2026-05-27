import { Router } from "express";
import { createEvent, getAllEvents, updateEvent, deleteEvent } from "../controllers/event.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { requirePermission } from "../middleware/permission.middleware.js";
import { uploadSingle } from "../middleware/upload.middleware.js";

const router = Router();

router.get("/", getAllEvents);

router.use(protect, authorize("admin", "employee"));
router.post("/", requirePermission("catalog.write"), uploadSingle("image"), createEvent);
router.patch("/:eventId", requirePermission("catalog.write"), uploadSingle("image"), updateEvent);
router.delete("/:eventId", requirePermission("catalog.write"), deleteEvent);

export default router;
