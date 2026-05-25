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

// Staff route — admin + employee can both view all tickets
router.get("/", authorize("admin", "employee"), getAllTickets);

// Shared (ownership check inside controller)
router.get("/:ticketId", getTicketById);
router.post("/:ticketId/reply", replyToTicket);

// Staff only — admin + employee can update status
router.patch("/:ticketId/status", authorize("admin", "employee"), updateTicketStatus);

export default router;
