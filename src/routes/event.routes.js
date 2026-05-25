import { Router } from "express";
import { createEvent, getAllEvents, updateEvent, deleteEvent } from "../controllers/event.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { uploadSingle } from "../middleware/upload.middleware.js";

const router = Router();

router.get("/", getAllEvents);

router.use(protect, authorize("admin", "employee"));
router.post("/", uploadSingle("image"), createEvent);
router.patch("/:eventId", uploadSingle("image"), updateEvent);
router.delete("/:eventId", deleteEvent);

export default router;
