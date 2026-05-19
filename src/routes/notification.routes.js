import { Router } from "express";
import {
  getMyNotifications, markAsRead, markAllAsRead,
  deleteNotification, sendBroadcastNotification,
  streamNotifications,
} from "../controllers/notification.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

// SSE stream — no protect middleware (auth handled inside via query token)
router.get("/stream", streamNotifications);

router.use(protect);

router.get("/", getMyNotifications);
// static routes before parameterized
router.patch("/read-all", markAllAsRead);
router.post("/broadcast", authorize("admin"), sendBroadcastNotification);
// parameterized routes last
router.patch("/:notificationId/read", markAsRead);
router.delete("/:notificationId", deleteNotification);

export default router;
