import { Router } from "express";
import {
  getMyNotifications, markAsRead, markAllAsRead,
  deleteNotification, sendBroadcastNotification,
  streamNotifications, issueStreamTicket, spendPreview,
} from "../controllers/notification.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

// SSE stream — auth via single-use ticket in query (issued by POST /stream-ticket)
router.get("/stream", streamNotifications);

router.use(protect);

// Authenticated endpoint that issues a short-lived ticket for opening the SSE stream
router.post("/stream-ticket", issueStreamTicket);

router.get("/", getMyNotifications);
// static routes before parameterized
router.patch("/read-all", markAllAsRead);
router.get("/spend-preview", authorize("admin"), spendPreview);
router.post("/broadcast", authorize("admin"), sendBroadcastNotification);
// parameterized routes last
router.patch("/:notificationId/read", markAsRead);
router.delete("/:notificationId", deleteNotification);

export default router;
