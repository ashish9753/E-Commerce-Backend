import { Router } from "express";
import {
  getMyNotifications, markAsRead, markAllAsRead,
  deleteNotification, sendBroadcastNotification,
} from "../controllers/notification.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

router.use(protect);

router.get("/", getMyNotifications);
router.patch("/:notificationId/read", markAsRead);
router.patch("/read-all", markAllAsRead);
router.delete("/:notificationId", deleteNotification);

router.post("/broadcast", authorize("admin"), sendBroadcastNotification);

export default router;
