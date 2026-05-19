import { Router } from "express";
import {
  createTicket,
  getMyTickets,
  getTicketById,
  replyToTicket,
  getAllTickets,
  updateTicketStatus,
} from "../controllers/support.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

router.use(protect);

// User routes
router.post("/", createTicket);
router.get("/my", getMyTickets);

// Admin route
router.get("/", authorize("admin"), getAllTickets);

// Shared (ownership check inside controller)
router.get("/:ticketId", getTicketById);
router.post("/:ticketId/reply", replyToTicket);

// Admin only
router.patch("/:ticketId/status", authorize("admin"), updateTicketStatus);

export default router;
